/**
 * Neon-backed fixed-window rate limiting.
 *
 * The upsert is atomic, so concurrent requests cannot bypass the counter.
 * One compact row is retained per rate-limit scope and client IP.
 */
import { sql } from 'drizzle-orm';
import { db } from './db';
import { rateLimits } from '../drizzle/schema';

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: Date;
}

export async function checkRateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const nextReset = new Date(now.getTime() + windowMs);
  const key = `${scope}:${identifier}`.slice(0, 255);

  const rows = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: nextReset, updatedAt: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.resetAt} <= ${now} then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${rateLimits.resetAt} <= ${now} then ${nextReset} else ${rateLimits.resetAt} end`,
        updatedAt: now,
      },
    })
    .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });

  const row = rows[0];
  return {
    success: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    resetAt: row.resetAt,
  };
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip') ?? '127.0.0.1';
}

export function valuationRateLimit(identifier: string) {
  return checkRateLimit('valuation', identifier, 30, 60 * 60 * 1000);
}

export function webhookRateLimit(identifier: string) {
  return checkRateLimit('webhook', identifier, 20, 15 * 60 * 1000);
}
