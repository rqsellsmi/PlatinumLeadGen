/**
 * Environment variable validation (Spec Section 13 / 14.3).
 * Throws a descriptive error if any required var is missing. Imported by
 * lib/db.ts so the check runs early. Skipped at build/lint/test time.
 */

import { DATABASE_URL_CANDIDATES, resolveDatabaseUrl } from './dbUrl';

/** Each entry is satisfied if ANY of its names is set (supports legacy aliases). */
const REQUIRED_GROUPS: { label: string; anyOf: string[] }[] = [
  // Accept any Vercel/Neon integration variable name for the connection string.
  { label: 'DATABASE_URL', anyOf: DATABASE_URL_CANDIDATES },
  { label: 'NEXTAUTH_SECRET', anyOf: ['NEXTAUTH_SECRET'] },
  { label: 'NEXTAUTH_URL', anyOf: ['NEXTAUTH_URL'] },
  { label: 'ADMIN_USERNAME', anyOf: ['ADMIN_USERNAME'] },
  { label: 'ADMIN_PASSWORD_HASH', anyOf: ['ADMIN_PASSWORD_HASH'] },
  { label: 'MS_GRAPH_CLIENT_ID', anyOf: ['MS_GRAPH_CLIENT_ID', 'MICROSOFT_CLIENT_ID'] },
  { label: 'MS_GRAPH_CLIENT_SECRET', anyOf: ['MS_GRAPH_CLIENT_SECRET', 'MICROSOFT_CLIENT_SECRET'] },
  { label: 'MS_GRAPH_TENANT_ID', anyOf: ['MS_GRAPH_TENANT_ID', 'MICROSOFT_TENANT_ID'] },
  { label: 'MS_GRAPH_FROM_EMAIL', anyOf: ['MS_GRAPH_FROM_EMAIL', 'MICROSOFT_SENDER_EMAIL'] },
  { label: 'MS_GRAPH_ADMIN_EMAIL', anyOf: ['MS_GRAPH_ADMIN_EMAIL', 'EMAIL_ADMIN_EMAIL'] },
  { label: 'RENTCAST_API_KEY', anyOf: ['RENTCAST_API_KEY'] },
  { label: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', anyOf: ['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'] },
  { label: 'SITE_URL', anyOf: ['SITE_URL'] },
  { label: 'CRON_SECRET', anyOf: ['CRON_SECRET'] },
  { label: 'REVALIDATE_SECRET', anyOf: ['REVALIDATE_SECRET'] },
];

let validated = false;

export function validateEnv(): void {
  if (validated) return;
  if (process.env.NODE_ENV === 'test') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.SKIP_ENV_VALIDATION === '1') return;

  const missing = REQUIRED_GROUPS.filter(
    (g) => !g.anyOf.some((k) => process.env[k] !== undefined && process.env[k] !== ''),
  ).map((g) => g.label);

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
export function requireEnv(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') throw new Error(`Environment variable ${key} is not set.`);
  return v;
}

export const env = {
  get DATABASE_URL() {
    return resolveDatabaseUrl();
  },
  get SITE_URL() {
    return process.env.SITE_URL ?? 'https://remax-platinumonline.com';
  },
  get ADMIN_EMAIL() {
    return process.env.MS_GRAPH_ADMIN_EMAIL ?? process.env.EMAIL_ADMIN_EMAIL ?? '';
  },
};
