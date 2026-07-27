/**
 * Google Data Manager API client (events:ingest) with service-account auth.
 *
 * Auth (decision D2): a Google service-account key (GOOGLE_ADS_SA_KEY — the JSON
 * key, raw or base64) is used to build a signed JWT assertion (RS256 via Node
 * `crypto`, no SDK dependency), exchanged at the OAuth token endpoint for a
 * short-lived access token that is cached in `google_ads_tokens` and reused
 * until near expiry — the same persisted-token + self-heal-on-401 pattern as
 * lib/realcomp.ts. Per-request AbortController timeout so a hung call can't wedge
 * the worker; a 401 forces one token re-mint + retry.
 *
 * This file touches the network + DB; the pure request-body builder lives in
 * lib/googleAdsOutbox.ts. Relative imports (vitest `@/` trap, lessons §17).
 */
import { createSign } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { resolveDatabaseUrl } from './dbUrl';
import { googleAdsTokens } from '../drizzle/schema';

const TOKEN_PROVIDER = 'google_datamanager';
const SCOPE = 'https://www.googleapis.com/auth/datamanager';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const INGEST_URL = 'https://datamanager.googleapis.com/v1/events:ingest';
const TOKEN_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** Parse GOOGLE_ADS_SA_KEY (raw JSON or base64-encoded JSON). Null if absent/invalid. */
export function loadServiceAccountKey(): ServiceAccountKey | null {
  const raw = (process.env.GOOGLE_ADS_SA_KEY || '').trim();
  if (!raw) return null;
  let text = raw;
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  try {
    const key = JSON.parse(text) as ServiceAccountKey;
    if (!key.client_email || !key.private_key) return null;
    return key;
  } catch {
    return null;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Build a signed JWT bearer assertion for the service account. Exported for tests. */
export function buildAssertion(key: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = key.token_uri || DEFAULT_TOKEN_URI;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = base64url(signer.sign(key.private_key));
  return `${signingInput}.${signature}`;
}

interface MintedToken {
  accessToken: string;
  expiresAt: Date;
}

/** Exchange the JWT assertion for an access token. Pure HTTP — no DB. */
async function mintToken(key: ServiceAccountKey): Promise<MintedToken> {
  const tokenUri = key.token_uri || DEFAULT_TOKEN_URI;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: buildAssertion(key),
      }).toString(),
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Google token request failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Google token response missing access_token.');
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
  };
}

/** Cached access token, minted from the SA key. Mirrors getValidRealcompToken. */
export async function getValidAccessToken(key: ServiceAccountKey, forceRefresh = false): Promise<string> {
  // No DB (e.g. a CI/verify context): mint per call — caching is only an
  // optimization to share one token across serverless invocations.
  if (!resolveDatabaseUrl()) {
    return (await mintToken(key)).accessToken;
  }
  if (!forceRefresh) {
    const rows = await db
      .select()
      .from(googleAdsTokens)
      .where(eq(googleAdsTokens.provider, TOKEN_PROVIDER))
      .limit(1);
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
    if (rows[0] && rows[0].expiresAt > fiveMinFromNow) {
      return rows[0].accessToken;
    }
  }
  const { accessToken, expiresAt } = await mintToken(key);
  await db
    .insert(googleAdsTokens)
    .values({ provider: TOKEN_PROVIDER, accessToken, expiresAt, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: googleAdsTokens.provider,
      set: { accessToken, expiresAt, updatedAt: new Date() },
    });
  return accessToken;
}

export interface IngestResult {
  ok: boolean;
  status: number;
  requestId?: string;
  /** True for transport/5xx/429/408/timeout — the caller should retry with backoff. */
  retryable: boolean;
  error?: string;
  raw?: unknown;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * POST an events:ingest body (built by buildIngestRequest). Handles auth, a
 * single 401 re-mint+retry, and a per-request timeout. Never logs the payload
 * (it carries hashed identifiers). Returns a structured result — the worker
 * decides how to persist it.
 */
export async function dataManagerIngest(body: Record<string, unknown>): Promise<IngestResult> {
  const key = loadServiceAccountKey();
  if (!key) return { ok: false, status: 0, retryable: false, error: 'not-configured' };

  let token: string;
  try {
    token = await getValidAccessToken(key);
  } catch (err) {
    return { ok: false, status: 0, retryable: true, error: `auth: ${(err as Error).message}` };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(INGEST_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      // Network error / abort (timeout) — retryable transport failure.
      return { ok: false, status: 0, retryable: true, error: `fetch: ${(err as Error).name}` };
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 && attempt === 0) {
      try {
        token = await getValidAccessToken(key, true); // force re-mint, then retry once
      } catch (err) {
        return { ok: false, status: 401, retryable: true, error: `re-auth: ${(err as Error).message}` };
      }
      continue;
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        retryable: isRetryableStatus(res.status),
        error: text ? text.slice(0, 500) : `HTTP ${res.status}`,
        raw: json,
      };
    }

    const requestId =
      (json as { requestId?: string; request_id?: string } | undefined)?.requestId ??
      (json as { request_id?: string } | undefined)?.request_id;
    return { ok: true, status: res.status, requestId, retryable: false, raw: json };
  }

  return { ok: false, status: 401, retryable: true, error: 'auth-failed-after-retry' };
}
