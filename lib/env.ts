/**
 * Environment variable validation (Section 13.3).
 * Validates that all required vars exist at startup and throws a descriptive
 * error if any are missing. Import this module once from a server entry point
 * (lib/db.ts imports it) so the check runs early.
 *
 * We intentionally do NOT import zod here so this can run in any context cheaply.
 */

const REQUIRED_VARS = [
  'DATABASE_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD_HASH',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'RESEND_FROM_NAME',
  'RESEND_ADMIN_EMAIL',
  'RENTCAST_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  'SITE_URL',
  'CRON_SECRET',
  'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
] as const;

type RequiredVar = (typeof REQUIRED_VARS)[number];

let validated = false;

/**
 * Throws a descriptive error listing every missing required env var.
 * Skipped during `next build`/lint (NEXT_PHASE) so CI can compile without secrets,
 * and skipped in test runs.
 */
export function validateEnv(): void {
  if (validated) return;
  if (process.env.NODE_ENV === 'test') return;
  // Allow `next build` to run without secrets — they are injected at runtime on Vercel.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.SKIP_ENV_VALIDATION === '1') return;

  const missing = REQUIRED_VARS.filter((key) => {
    const v = process.env[key];
    return v === undefined || v === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n` +
        missing.map((m) => `  - ${m}`).join('\n') +
        `\n\nCopy .env.example to .env and fill in every value. See SETUP.md.`,
    );
  }
  validated = true;
}

/** Read a required env var, asserting it is present (after validateEnv). */
export function requireEnv(key: RequiredVar): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    throw new Error(`Environment variable ${key} is not set.`);
  }
  return v;
}

export const env = {
  get DATABASE_URL() {
    return requireEnv('DATABASE_URL');
  },
  get SITE_URL() {
    return process.env.SITE_URL ?? 'https://remax-platinumonline.com';
  },
  get RESEND_ADMIN_EMAIL() {
    return requireEnv('RESEND_ADMIN_EMAIL');
  },
};
