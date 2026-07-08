import './scripts/loadEnv';
import { defineConfig } from 'drizzle-kit';
import { resolveDatabaseUrl } from './lib/dbUrl';

export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Accept DATABASE_URL or any Vercel/Neon integration variable name.
    url: resolveDatabaseUrl(),
  },
  verbose: true,
  strict: true,
});
