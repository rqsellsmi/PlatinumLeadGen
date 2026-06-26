/**
 * Neon + Drizzle client (Section 3.1).
 * Uses the neon-http adapter — works in Vercel serverless functions without
 * connection-pool issues (no WebSocket).
 */
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { validateEnv } from './env';
import * as schema from '../drizzle/schema';

validateEnv();

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });

export { schema };
