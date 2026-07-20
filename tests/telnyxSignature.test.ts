import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign, KeyObject } from 'node:crypto';
import { verifyTelnyxSignature } from '../lib/telnyxSignature';

/** Export the raw 32-byte Ed25519 public key as base64 (what Telnyx publishes). */
function rawPublicKeyB64(pub: KeyObject): string {
  const der = pub.export({ type: 'spki', format: 'der' }) as Buffer;
  return der.subarray(der.length - 32).toString('base64');
}

describe('verifyTelnyxSignature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyB64 = rawPublicKeyB64(publicKey);
  const payload = '{"data":{"event_type":"message.received"}}';
  const timestamp = '1785100000';
  const signatureB64 = cryptoSign(null, Buffer.from(`${timestamp}|${payload}`), privateKey).toString('base64');

  it('accepts a valid signature within tolerance', () => {
    expect(verifyTelnyxSignature({ payload, signatureB64, timestamp, publicKeyB64, nowSec: 1785100010 })).toBe(true);
  });
  it('rejects a tampered payload', () => {
    expect(verifyTelnyxSignature({ payload: payload + 'x', signatureB64, timestamp, publicKeyB64, nowSec: 1785100010 })).toBe(false);
  });
  it('rejects a stale timestamp', () => {
    expect(verifyTelnyxSignature({ payload, signatureB64, timestamp, publicKeyB64, nowSec: 1785100000 + 999999, toleranceSec: 300 })).toBe(false);
  });
  it('rejects garbage signature without throwing', () => {
    expect(verifyTelnyxSignature({ payload, signatureB64: 'notbase64!!', timestamp, publicKeyB64, nowSec: 1785100010 })).toBe(false);
  });
  it('rejects a future timestamp beyond tolerance', () => {
    const futureTimestamp = '1785100300';
    expect(verifyTelnyxSignature({ payload, signatureB64, timestamp: futureTimestamp, publicKeyB64, nowSec: 1785100000, toleranceSec: 300 })).toBe(false);
  });
  it('rejects a wrong-length-but-valid-base64 signature', () => {
    const wrongLengthSig = Buffer.alloc(32).toString('base64');
    expect(verifyTelnyxSignature({ payload, signatureB64: wrongLengthSig, timestamp, publicKeyB64, nowSec: 1785100010 })).toBe(false);
  });
  it('rejects a non-digit timestamp string', () => {
    expect(verifyTelnyxSignature({ payload, signatureB64, timestamp: '123garbage', publicKeyB64, nowSec: 1785100010 })).toBe(false);
  });
});
