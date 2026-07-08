/**
 * Load env vars for CLI scripts / drizzle-kit. Reads BOTH `.env.local` (Next.js
 * convention, and where `vercel env pull` writes) and `.env`, with `.env.local`
 * taking precedence — dotenv does not override already-set keys, so we load the
 * higher-priority file first. Import this before anything that reads process.env.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });
config(); // .env
