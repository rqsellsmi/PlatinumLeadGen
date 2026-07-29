/**
 * Neon-backed rate limiting — background fixed-window pattern (Spec Section 8).
 *
 * The upsert increments a per-(ip, endpoint, window) counter atomically. The
 * check is "fail open": if the DB hiccups, the request is allowed. Thresholds
 * per Section 8.3. A daily cron purges windows older than 24h (Section 8.4).
 */
import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { rateLimits } from '../drizzle/schema';

/**
 * Returns true if the request is allowed, false if it exceeds the limit.
 * windowStart is floored to the window boundary so all hits in a window share a row.
 */
export async function checkRateLimit(
  ip: string,
  endpoint: string,
  limit: number,
  windowMinutes: number,
): Promise<boolean> {
  const windowMs = windowMinutes * 60 * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  try {
    const result = await db
      .insert(rateLimits)
      .values({ ip: ip.slice(0, 64), endpoint, windowStart, hitCount: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.ip, rateLimits.endpoint, rateLimits.windowStart],
        set: { hitCount: sql`${rateLimits.hitCount} + 1` },
      })
      .returning({ hitCount: rateLimits.hitCount });
    return (result[0]?.hitCount ?? 1) <= limit;
  } catch {
    // Fail open — better to let one through than block everyone on a DB blip.
    return true;
  }
}

/** Extract the client IP from request headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip') ?? 'unknown';
}

// Threshold presets (Section 8.3).
export const RATE_LIMITS = {
  lead_submit: { limit: 20, windowMinutes: 15 },
  valuation: { limit: 30, windowMinutes: 60 },
  agent_login: { limit: 10, windowMinutes: 15 },
  offer: { limit: 20, windowMinutes: 60 },
  webhook: { limit: 20, windowMinutes: 15 },
  // P0.3 / D5. Both endpoints were previously unlimited.
  //
  // `appointment` is tight because a genuine visitor books once. `partial`
  // is loose because it fires on address entry and a single indecisive
  // homeowner legitimately triggers several while typing and re-selecting.
  appointment: { limit: 5, windowMinutes: 60 },
  partial: { limit: 40, windowMinutes: 15 },
} as const;

export type RateLimitEndpoint = keyof typeof RATE_LIMITS;

/** Convenience: check by named preset. Returns true if allowed. */
export function checkPreset(ip: string, endpoint: RateLimitEndpoint): Promise<boolean> {
  const { limit, windowMinutes } = RATE_LIMITS[endpoint];
  return checkRateLimit(ip, endpoint, limit, windowMinutes);
}

/**
 * Per-CAPABILITY limit (D5): throttle by the report token as well as by IP, so
 * one leaked or shared capability cannot be hammered from many addresses. The
 * token is hashed into the key rather than stored raw — the rate_limits table
 * should never become a second place a live capability sits in plaintext.
 */
export function checkCapabilityLimit(
  token: string,
  endpoint: RateLimitEndpoint,
): Promise<boolean> {
  const { limit, windowMinutes } = RATE_LIMITS[endpoint];
  const key = createHash('sha256').update(token).digest('hex').slice(0, 32);
  return checkRateLimit(`cap:${key}`, endpoint, limit, windowMinutes);
}
