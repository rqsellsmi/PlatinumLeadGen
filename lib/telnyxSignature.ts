/**
 * Verify a Telnyx webhook Ed25519 signature (design spec §6.1).
 * Signed message is `${timestamp}|${payload}`. The public key arrives as
 * base64 of the raw 32-byte key; we wrap it in the fixed Ed25519 SPKI prefix.
 * Never throws — returns false on any malformed input.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

// DER prefix for an Ed25519 SubjectPublicKeyInfo (12 bytes), then the 32-byte key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function publicKeyFromRawB64(b64: string) {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) throw new Error('bad ed25519 key length');
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

export function verifyTelnyxSignature(o: {
  payload: string;
  signatureB64: string;
  timestamp: string;
  publicKeyB64: string;
  toleranceSec?: number;
  nowSec?: number;
}): boolean {
  try {
    const tolerance = o.toleranceSec ?? 5 * 60;
    const now = o.nowSec ?? Math.floor(Date.now() / 1000);
    if (!/^\d+$/.test(o.timestamp)) return false;
    const ts = parseInt(o.timestamp, 10);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false;

    const key = publicKeyFromRawB64(o.publicKeyB64);
    const signed = Buffer.from(`${o.timestamp}|${o.payload}`);
    const sig = Buffer.from(o.signatureB64, 'base64');
    if (sig.length !== 64) return false;
    return cryptoVerify(null, signed, key, sig);
  } catch {
    return false;
  }
}
