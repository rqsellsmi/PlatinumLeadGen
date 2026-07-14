/**
 * Neon + Drizzle client (Section 3.1).
 * Uses the neon-http adapter — works in Vercel serverless functions without
 * connection-pool issues (no WebSocket).
 */
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { validateEnv } from './env';
import { resolveDatabaseUrl } from './dbUrl';
import * as schema from '../drizzle/schema';

/**
 * Lazily-initialized Drizzle client. We defer creating the neon() connection
 * until the first query so that `next build` page-data collection (which imports
 * modules without a DATABASE_URL available) does not throw at import time.
 */
let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  validateEnv();
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      'No database connection string found. Set DATABASE_URL (or a Vercel/Neon ' +
        'integration variable like POSTGRES_URL / STORAGE_URL).',
    );
  }
  // `cache: 'no-store'` is load-bearing: the neon-http driver issues queries via
  // fetch(), and Next.js's Data Cache will otherwise cache those responses during
  // a Server Component render — serving STALE query results on pages even when the
  // route is force-dynamic (the homepage "recent sales" froze on old data because
  // of this; Route Handlers weren't affected, which is how we caught it). Forcing
  // no-store makes every DB read hit the database.
  const sql = neon(url, { fetchOptions: { cache: 'no-store' } });
  _db = drizzle(sql, { schema });
  return _db;
}

/**
 * Proxy that forwards all Drizzle method access to the lazily-created client.
 * Lets callers keep using `db.select()...` while init stays deferred.
 */
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export { schema };
