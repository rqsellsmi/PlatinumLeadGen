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
import { realcompTokens } from '../drizzle/schema';

const TOKEN_PROVIDER = 'realcomp';
// Realcomp requires EXACTLY these three fields — extra params fail the request
// (IDX spec §1.1, and the Realcomp "Getting Started" guide, Step 1).
const AUDIENCE = 'rapi.realcomp.com';

function clientId(): string {
  return process.env.REALCOMP_CLIENT_ID ?? '';
}
function clientSecret(): string {
  return process.env.REALCOMP_CLIENT_SECRET ?? '';
}
function authUrl(): string {
  return process.env.REALCOMP_AUTH_URL ?? 'https://auth.realcomp.com/Token';
}
function baseUrl(): string {
  // Per the Realcomp account setup sheet the data API is fullapi.realcomp.com;
  // override via REALCOMP_BASE_URL if your account differs.
  return (process.env.REALCOMP_BASE_URL ?? 'https://fullapi.realcomp.com/odata').replace(/\/+$/, '');
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

// ---------------------------------------------------------------------------
// Token management — persisted to Neon (IDX spec §1.3)
// ---------------------------------------------------------------------------
export async function getValidRealcompToken(): Promise<string> {
  if (!isRealcompConfigured()) {
    throw new Error('Realcomp is not configured (REALCOMP_CLIENT_ID / REALCOMP_CLIENT_SECRET).');
  }

  const rows = await db
    .select()
    .from(realcompTokens)
    .where(eq(realcompTokens.provider, TOKEN_PROVIDER))
    .limit(1);

  // Reuse if it expires more than 5 minutes from now (IDX spec §1.3).
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (rows[0] && rows[0].expiresAt > fiveMinFromNow) {
    return rows[0].accessToken;
  }

  // Fetch a fresh token via client-credentials. JSON body, exactly three fields.
  const res = await fetch(authUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId(),
      client_secret: clientSecret(),
      audience: AUDIENCE,
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Realcomp token request failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error('Realcomp token response missing access_token.');

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
  // Upsert — only ever one row per provider.
  await db
    .insert(realcompTokens)
    .values({
      provider: TOKEN_PROVIDER,
      accessToken: data.access_token,
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: realcompTokens.provider,
      set: { accessToken: data.access_token, expiresAt, updatedAt: new Date() },
    });

  return data.access_token;
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
  const token = await getValidRealcompToken();
  const url = new URL(`${baseUrl()}/${path.replace(/^\/+/, '')}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const results: T[] = [];
  let nextUrl: string | null = url.toString();

  while (nextUrl) {
    const res: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`Realcomp API error: ${res.status} ${await res.text()}`);
    }
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
): Promise<number> {
  const token = await getValidRealcompToken();
  const url = new URL(`${baseUrl()}/${path.replace(/^\/+/, '')}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let total = 0;
  let nextUrl: string | null = url.toString();
  while (nextUrl) {
    const res: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Realcomp API error: ${res.status} ${await res.text()}`);
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
