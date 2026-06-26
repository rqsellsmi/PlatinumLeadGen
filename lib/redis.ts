/**
 * Upstash Redis client, rate-limiter presets, and cache helpers (Section 1.2 / 4.7).
 */
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// ---------------------------------------------------------------------------
// Rate limiter presets
// ---------------------------------------------------------------------------
/** RentCast valuation proxy: 30 requests / hour / IP (Section 4.7). */
export const valuationRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 h'),
  prefix: 'rl:valuation',
  analytics: false,
});

/** External webhook: 20 requests / 15 minutes / IP (Section 7.2). */
export const webhookRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '15 m'),
  prefix: 'rl:webhook',
  analytics: false,
});

/**
 * Extract the client IP from a Next.js request's headers.
 * Falls back to a constant so rate limiting still functions locally.
 */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return headers.get('x-real-ip') ?? '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Cache helpers (public page data)
// ---------------------------------------------------------------------------
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour — matches city page ISR window

export function locationCacheKey(slug: string): string {
  return `cache:location:${slug}`;
}

/** Read a cached JSON value, or null on miss/parse error. */
export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const value = await redis.get<T>(key);
    return value ?? null;
  } catch {
    return null;
  }
}

/** Write a JSON value to cache with the default TTL. */
export async function setCached<T>(key: string, value: T, ttlSeconds = CACHE_TTL_SECONDS): Promise<void> {
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch {
    // Cache failures must never break a page render.
  }
}

/** Invalidate the cache for a single location (called from the SEO/stats editors). */
export async function invalidateLocationCache(slug: string): Promise<void> {
  try {
    await redis.del(locationCacheKey(slug));
  } catch {
    // ignore
  }
}
