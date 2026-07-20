/**
 * Environment variable validation (Spec Section 13 / 14.3).
 * Throws a descriptive error if any required var is missing. Imported by
 * lib/db.ts so the check runs early. Skipped at build/lint/test time.
 */

import { siteUrl } from './siteUrl';
import { DATABASE_URL_CANDIDATES, resolveDatabaseUrl } from './dbUrl';

type Group = { label: string; anyOf: string[] };

/**
 * CRITICAL vars — the app cannot render without these, so a miss throws.
 * Kept intentionally small (DB + admin auth) so a missing *feature* key never
 * takes down the whole site/admin.
 */
const CRITICAL_GROUPS: Group[] = [
  // Accept any Vercel/Neon integration variable name for the connection string.
  { label: 'DATABASE_URL', anyOf: DATABASE_URL_CANDIDATES },
  { label: 'NEXTAUTH_SECRET', anyOf: ['NEXTAUTH_SECRET'] },
  { label: 'NEXTAUTH_URL', anyOf: ['NEXTAUTH_URL'] },
  { label: 'ADMIN_USERNAME', anyOf: ['ADMIN_USERNAME'] },
  { label: 'ADMIN_PASSWORD_HASH', anyOf: ['ADMIN_PASSWORD_HASH'] },
];

/**
 * RECOMMENDED vars — features degrade if missing (email, valuation, maps,
 * cron/revalidate auth), but the app still boots. We warn once rather than
 * crash, so a partially-configured preview/staging deploy stays usable.
 */
const RECOMMENDED_GROUPS: Group[] = [
  { label: 'MS_GRAPH_CLIENT_ID', anyOf: ['MS_GRAPH_CLIENT_ID', 'MICROSOFT_CLIENT_ID'] },
  { label: 'MS_GRAPH_CLIENT_SECRET', anyOf: ['MS_GRAPH_CLIENT_SECRET', 'MICROSOFT_CLIENT_SECRET'] },
  { label: 'MS_GRAPH_TENANT_ID', anyOf: ['MS_GRAPH_TENANT_ID', 'MICROSOFT_TENANT_ID'] },
  { label: 'MS_GRAPH_FROM_EMAIL', anyOf: ['MS_GRAPH_FROM_EMAIL', 'MICROSOFT_SENDER_EMAIL'] },
  { label: 'MS_GRAPH_ADMIN_EMAIL', anyOf: ['MS_GRAPH_ADMIN_EMAIL', 'EMAIL_ADMIN_EMAIL'] },
  { label: 'RENTCAST_API_KEY', anyOf: ['RENTCAST_API_KEY'] },
  // ATTOM is the alternate valuation provider (VALUATION_PROVIDER=attom). Only
  // needed when that flag is set; RentCast covers the default case.
  { label: 'ATTOM_API_KEY', anyOf: ['ATTOM_API_KEY'] },
  { label: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', anyOf: ['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'] },
  // Realcomp IDX feed — optional; IDX features (Similar Homes, Market Report,
  // IDX-driven metrics) disable cleanly if absent. See IDX spec §1.2 / §2.4.
  { label: 'REALCOMP_CLIENT_ID', anyOf: ['REALCOMP_CLIENT_ID'] },
  { label: 'REALCOMP_CLIENT_SECRET', anyOf: ['REALCOMP_CLIENT_SECRET'] },
  { label: 'REALCOMP_BASE_URL', anyOf: ['REALCOMP_BASE_URL'] },
  { label: 'REALCOMP_AUTH_URL', anyOf: ['REALCOMP_AUTH_URL'] },
  { label: 'REALCOMP_OFFICE_KEYS', anyOf: ['REALCOMP_OFFICE_KEYS'] },
  // Telnyx SMS — agent texting. Optional; email still sends without it.
  { label: 'TELNYX_API_KEY', anyOf: ['TELNYX_API_KEY'] },
  { label: 'TELNYX_PUBLIC_KEY', anyOf: ['TELNYX_PUBLIC_KEY'] },
  { label: 'SITE_URL', anyOf: ['SITE_URL'] },
  { label: 'CRON_SECRET', anyOf: ['CRON_SECRET'] },
  { label: 'REVALIDATE_SECRET', anyOf: ['REVALIDATE_SECRET'] },
];

function missingOf(groups: Group[]): string[] {
  return groups
    .filter((g) => !g.anyOf.some((k) => process.env[k] !== undefined && process.env[k] !== ''))
    .map((g) => g.label);
}

let validated = false;

export function validateEnv(): void {
  if (validated) return;
  if (process.env.NODE_ENV === 'test') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.SKIP_ENV_VALIDATION === '1') return;

  const missingCritical = missingOf(CRITICAL_GROUPS);
  if (missingCritical.length > 0) {
    throw new Error(
      `Missing required environment variables:\n` +
        missingCritical.map((m) => `  - ${m}`).join('\n') +
        `\n\nThese are required for the app to run (database + admin auth). See SETUP.md.`,
    );
  }

  const missingRecommended = missingOf(RECOMMENDED_GROUPS);
  if (missingRecommended.length > 0) {
    console.warn(
      `[env] Missing recommended environment variables (related features are disabled):\n` +
        missingRecommended.map((m) => `  - ${m}`).join('\n'),
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
    return siteUrl();
  },
  get ADMIN_EMAIL() {
    return process.env.MS_GRAPH_ADMIN_EMAIL ?? process.env.EMAIL_ADMIN_EMAIL ?? '';
  },
};
