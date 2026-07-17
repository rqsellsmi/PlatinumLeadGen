/**
 * Realcomp RAPI v2.4 client — OAuth 2.0 client-credentials + OData fetch.
 *
 * Token reliability (IDX spec §1.1/§1.3): the OAuth access token is persisted to
 * Neon (realcomp_tokens, single row keyed by provider) so every Vercel
 * serverless invocation shares it instead of re-authenticating on each call —
 * the same pattern as the MS Graph email token (lib/email.ts).
 *
 * realcompFetch() handles auth, URL construction, and @odata.nextLink pagination
 * automatically (IDX spec §1.4).
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { resolveDatabaseUrl } from './dbUrl';
import { realcompTokens } from '../drizzle/schema';

const TOKEN_PROVIDER = 'realcomp';

// Max CONSECUTIVE 401 re-mints before giving up (reset after any success). Lets a
// long backfill ride through repeated token expiries while still failing fast on
// a genuine auth misconfiguration.
const MAX_AUTH_RETRIES = 3;

// Transient-error resilience: a long backfill will hit the occasional network
// blip (headers/body timeout, connection reset) or 5xx from the upstream. Retry
// those with backoff instead of failing the whole run; give each request its own
// abort timeout so a hung connection becomes a retry, not a dead run.
const MAX_NET_RETRIES = 4;
const REQUEST_TIMEOUT_MS = 300_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// The auth endpoint gets its own (short) timeout so a slow/hung token mint can't
// wedge the whole sync — mintRealcompToken had NO timeout, so on a stalled auth
// response the sync hung silently for minutes (confirmed via the runner logs).
const TOKEN_TIMEOUT_MS = 30_000;
// A freshly-issued Realcomp token is NOT accepted by the data API for ~1-2s: the
// first request returns 401 "Token failed validation", the next (seconds later)
// returns 200 (confirmed via preflight). Wait after minting so the caller's first
// request doesn't 401 — which the fetch loop would otherwise "fix" by force-re-
// minting ANOTHER un-propagated token, churning or hanging on the auth call.
const TOKEN_PROPAGATION_MS = 3_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);

/** One fetch with a per-request abort timeout (so a hung request can be retried). */
async function fetchWithTimeout(url: string, token: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function clientId(): string {
  return process.env.REALCOMP_CLIENT_ID ?? '';
}
function clientSecret(): string {
  return process.env.REALCOMP_CLIENT_SECRET ?? '';
}
// NOTE: use `||`, not `??` — an env var set to an EMPTY string (e.g. a GitHub
// Actions secret that isn't configured is passed through as "") must fall back
// to the default, not override it with blank.
function authUrl(): string {
  return process.env.REALCOMP_AUTH_URL || 'https://auth.realcomp.com/Token';
}
// The token `audience` is account-specific (Realcomp support: rcapi.realcomp.com,
// NOT rapi.realcomp.com). Overridable so a future change is an env edit, not code.
function audience(): string {
  return process.env.REALCOMP_AUDIENCE || 'rcapi.realcomp.com';
}
function baseUrl(): string {
  // Data API host per Realcomp support: idxapi.realcomp.com. Override via
  // REALCOMP_BASE_URL if your account differs.
  return (process.env.REALCOMP_BASE_URL || 'https://idxapi.realcomp.com/odata').replace(/\/+$/, '');
}

/** True when the minimum credentials to talk to Realcomp are configured. */
export function isRealcompConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface MintedToken {
  accessToken: string;
  expiresAt: Date;
}

/**
 * Mint a fresh access token via client-credentials. Pure HTTP — no database.
 * JSON body, exactly three fields.
 */
async function mintRealcompToken(): Promise<MintedToken> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(authUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId(),
        client_secret: clientSecret(),
        audience: audience(),
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Realcomp token request failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error('Realcomp token response missing access_token.');

  // Let the just-issued token propagate before it's used (see TOKEN_PROPAGATION_MS).
  await sleep(TOKEN_PROPAGATION_MS);

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
  };
}

// ---------------------------------------------------------------------------
// Token management — persisted to Neon (IDX spec §1.3)
// ---------------------------------------------------------------------------
export async function getValidRealcompToken(forceRefresh = false): Promise<string> {
  if (!isRealcompConfigured()) {
    throw new Error('Realcomp is not configured (REALCOMP_CLIENT_ID / REALCOMP_CLIENT_SECRET).');
  }

  // No database configured (e.g. the idx:verify CI script, which only needs a
  // token to fetch $metadata): skip the persistence layer entirely and mint a
  // fresh token per call. Token caching is purely an optimization to share one
  // token across serverless invocations — the app is fully correct without it.
  if (!resolveDatabaseUrl()) {
    return (await mintRealcompToken()).accessToken;
  }

  // Reuse the cached token unless a forced refresh is requested (e.g. after a
  // 401 — a persisted token minted with a bad audience must not wedge the sync).
  if (!forceRefresh) {
    const rows = await db
      .select()
      .from(realcompTokens)
      .where(eq(realcompTokens.provider, TOKEN_PROVIDER))
      .limit(1);
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
    if (rows[0] && rows[0].expiresAt > fiveMinFromNow) {
      return rows[0].accessToken;
    }
  }

  const { accessToken, expiresAt } = await mintRealcompToken();
  // Upsert — only ever one row per provider.
  await db
    .insert(realcompTokens)
    .values({
      provider: TOKEN_PROVIDER,
      accessToken,
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: realcompTokens.provider,
      set: { accessToken, expiresAt, updatedAt: new Date() },
    });

  return accessToken;
}

// ---------------------------------------------------------------------------
// OData fetch with automatic @odata.nextLink pagination (IDX spec §1.4)
// ---------------------------------------------------------------------------
interface ODataResponse<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

/**
 * Fetch an OData collection, following @odata.nextLink until exhausted. For
 * small targeted queries (Similar Homes, Market Report) nextLink never appears
 * and the loop exits after one request; for sync operations that exceed 1000
 * records it pages through the whole set.
 */
export async function realcompFetch<T = Record<string, unknown>>(
  path: string,
  params?: Record<string, string>,
): Promise<T[]> {
  let token = await getValidRealcompToken();
  const url = new URL(`${baseUrl()}/${path.replace(/^\/+/, '')}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const results: T[] = [];
  let nextUrl: string | null = url.toString();
  let authRetries = 0;
  let netRetries = 0;

  while (nextUrl) {
    let res: Response;
    try {
      res = await fetchWithTimeout(nextUrl, token);
    } catch (err) {
      // Network error / abort timeout — retry with backoff before giving up.
      if (netRetries < MAX_NET_RETRIES) {
        netRetries += 1;
        await sleep(backoffMs(netRetries));
        continue;
      }
      throw err;
    }
    // A 401 means the token is stale/expired — re-mint and retry every time.
    if (res.status === 401 && authRetries < MAX_AUTH_RETRIES) {
      authRetries += 1;
      token = await getValidRealcompToken(true);
      continue;
    }
    // Transient upstream error — back off and retry.
    if (RETRYABLE_STATUS.has(res.status) && netRetries < MAX_NET_RETRIES) {
      netRetries += 1;
      await sleep(backoffMs(netRetries));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Realcomp API error: ${res.status} ${await res.text()}`);
    }
    authRetries = 0; // recovered — reset so a later expiry gets its own retries
    netRetries = 0;
    const data = (await res.json()) as ODataResponse<T>;
    if (data.value) results.push(...data.value);
    nextUrl = data['@odata.nextLink'] ?? null;
  }
  return results;
}

/**
 * Like realcompFetch, but invokes `onPage` for each OData page instead of
 * accumulating everything in memory. Used by the initial backfill so it can
 * upsert page-by-page and print progress on very large result sets.
 */
export async function realcompFetchPages<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string>,
  onPage: (page: T[]) => Promise<void>,
  opts: { timeoutMs?: number } = {},
): Promise<number> {
  let token = await getValidRealcompToken();
  const url = new URL(`${baseUrl()}/${path.replace(/^\/+/, '')}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let total = 0;
  let nextUrl: string | null = url.toString();
  let authRetries = 0;
  let netRetries = 0;
  while (nextUrl) {
    let res: Response;
    try {
      res = await fetchWithTimeout(nextUrl, token, opts.timeoutMs);
    } catch (err) {
      // Network error / abort timeout — a single blip (or Realcomp intermittently
      // hanging on a request, which it does) must not kill the run. Retry with
      // backoff; only give up after several in a row. With a SHORT opts.timeoutMs
      // (the incremental sync), a stalled request aborts fast and the retry
      // usually succeeds, instead of freezing for the full default timeout.
      if (netRetries < MAX_NET_RETRIES) {
        netRetries += 1;
        await sleep(backoffMs(netRetries));
        continue;
      }
      throw err;
    }
    // A 401 means the token is stale/expired — re-mint and retry every time.
    if (res.status === 401 && authRetries < MAX_AUTH_RETRIES) {
      authRetries += 1;
      token = await getValidRealcompToken(true);
      continue;
    }
    // Transient upstream error (5xx / 429 / 408) — back off and retry.
    if (RETRYABLE_STATUS.has(res.status) && netRetries < MAX_NET_RETRIES) {
      netRetries += 1;
      await sleep(backoffMs(netRetries));
      continue;
    }
    if (!res.ok) throw new Error(`Realcomp API error: ${res.status} ${await res.text()}`);
    authRetries = 0; // recovered — reset so a later expiry gets its own retries
    netRetries = 0;
    const data = (await res.json()) as ODataResponse<T>;
    const page = data.value ?? [];
    total += page.length;
    if (page.length) await onPage(page);
    nextUrl = data['@odata.nextLink'] ?? null;
  }
  return total;
}

/** Fetch the raw $metadata document (used by scripts/idx-verify-metadata.ts). */
export async function fetchMetadata(): Promise<string> {
  const token = await getValidRealcompToken();
  const res = await fetch(`${baseUrl()}/$metadata`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Realcomp $metadata error: ${res.status} ${await res.text()}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Diagnostic preflight (scripts/idx-incremental-sync.ts)
// ---------------------------------------------------------------------------
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

/** GET a URL with a hard timeout, logging status + latency (or the abort). */
async function probe(label: string, url: string, token: string, ms: number): Promise<void> {
  console.error(`[preflight] ${label}: GET ${url} (${ms / 1000}s timeout)…`);
  const t = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await res.text();
    console.error(`[preflight] ${label}: HTTP ${res.status} in ${Date.now() - t}ms, ${body.length} bytes`);
    if (!res.ok) console.error(`[preflight] ${label} body: ${body.slice(0, 600)}`);
  } catch (err) {
    console.error(`[preflight] ${label}: FAILED/aborted in ${Date.now() - t}ms:`, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire ONE Property request with the given OData params and a hard timeout,
 * logging status/latency/bytes. Used to replicate the sync's EXACT query so a
 * hang is caught red-handed (and bounded) instead of running for minutes.
 */
export async function realcompProbe(label: string, params: Record<string, string>, ms: number): Promise<void> {
  const token = await getValidRealcompToken();
  const url = new URL(`${baseUrl()}/Property`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  await probe(label, url.toString(), token, ms);
}

/**
 * Preflight probe: time the token fetch, then two identical 1-record requests —
 * one WITHOUT media, one WITH the same `$expand=Media` the sync uses — each with a
 * short timeout. If the no-media request returns fast but the media one hangs,
 * the Media expand is the culprit (not connectivity/row-count). Logs to stderr
 * (unbuffered → survives a process kill); never throws (diagnostic only).
 */
export async function realcompPreflight(): Promise<void> {
  const t0 = Date.now();
  console.error(`[preflight] fetching token…`);
  let token: string;
  try {
    token = await withTimeout(getValidRealcompToken(), 25_000, 'token fetch');
  } catch (err) {
    console.error(`[preflight] token FAILED in ${Date.now() - t0}ms:`, err);
    return;
  }
  console.error(`[preflight] token OK in ${Date.now() - t0}ms (len ${token.length})`);

  const base = baseUrl();
  await probe('no-media', `${base}/Property?$top=1&$select=ListingKey`, token, 20_000);
  await probe(
    'with-media',
    `${base}/Property?$top=1&$select=ListingKey&$expand=Media($select=MediaURL,Order,MediaCategory)`,
    token,
    20_000,
  );
}
