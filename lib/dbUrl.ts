/**
 * Resolve the Postgres connection string from the env.
 *
 * The Vercel↔Neon (and legacy Vercel Postgres) integrations inject the
 * connection string under different names depending on the chosen
 * "Environment Variable Prefix" (e.g. DATABASE_URL, POSTGRES_URL, or a custom
 * prefix like STORAGE_URL). We accept the common ones so the app connects no
 * matter which prefix was selected. Prefer the pooled URL.
 */
const CANDIDATES = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'STORAGE_URL',
  'STORAGE_DATABASE_URL',
  'STORAGE_POSTGRES_URL',
];

export function resolveDatabaseUrl(): string {
  for (const key of CANDIDATES) {
    const value = process.env[key];
    if (value && value.trim()) return value;
  }
  return '';
}

export const DATABASE_URL_CANDIDATES = CANDIDATES;
