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
  // NO `cache: 'no-store'` here — deliberately. Each route's own config decides
  // whether its reads are cached, which is what makes ISR possible at all.
  //
  // The neon-http driver issues queries via fetch(), so Next patches them. With no
  // explicit cache option a query inherits the ROUTE's revalidate
  // (next/dist/server/lib/patch-fetch.js — the "auto cache" branch):
  //   force-dynamic route  → revalidate 0     → never cached (admin, agent, /api/*,
  //                                             the homepage: always live)
  //   ISR route            → revalidate N     → cached alongside the page, and both
  //                                             refresh together (app/sell/[slug])
  //
  // This previously forced `no-store`, on the theory that the Data Cache was serving
  // stale reads and had frozen the homepage's "recent sales". That turned out to be a
  // SYNC problem, not a render-caching one. The cost of the workaround was severe and
  // silent: `no-store` sets a fetch's own revalidate to 0, and Next lowers the route's
  // revalidate to any smaller fetch value — so a single DB read dragged an entire ISR
  // page back to per-request rendering. `export const revalidate` was simply ignored,
  // with no warning. That is why a cold city page cost ~12.7s TTFB against a ~0.47s
  // static floor.
  //
  // BEFORE ADDING A PAGE THAT READS THE DB: give it an explicit `dynamic` or
  // `revalidate` export. A route with neither leaves the store's revalidate undefined,
  // which the same branch reads as `false` — cache forever. Every current route is
  // explicit, or does not touch the DB while rendering (privacy/terms render no
  // header or footer; the root layout makes no queries).
  const sql = neon(url);
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
