/**
 * External webhook API key auth (Section 7.2).
 * Raw keys are shown once on creation; only bcrypt hashes are stored.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { apiKeys } from '../drizzle/schema';

const KEY_BYTES = 24;
const BCRYPT_COST = 12;

export interface GeneratedApiKey {
  raw: string; // shown once
  prefix: string;
  hash: string;
}

/** Generate a new API key: returns the raw key (show once), prefix, and bcrypt hash. */
export async function generateApiKey(): Promise<GeneratedApiKey> {
  const raw = `rpk_${crypto.randomBytes(KEY_BYTES).toString('hex')}`;
  const prefix = raw.slice(0, 12);
  const hash = await bcrypt.hash(raw, BCRYPT_COST);
  return { raw, prefix, hash };
}

/**
 * Verify a raw API key against the active keys table.
 * Returns the matching key id, or null if none match.
 * Updates lastUsedAt on success.
 */
export async function verifyApiKey(rawKey: string | null | undefined): Promise<number | null> {
  if (!rawKey) return null;
  const active = await db.select().from(apiKeys).where(eq(apiKeys.isActive, true));
  for (const key of active) {
    // Quick prefix gate before the expensive bcrypt compare.
    if (key.keyPrefix && !rawKey.startsWith(key.keyPrefix)) continue;
    const ok = await bcrypt.compare(rawKey, key.keyHash);
    if (ok) {
      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, key.id));
      return key.id;
    }
  }
  return null;
}
