import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createVerify } from 'crypto';
import { loadServiceAccountKey, buildAssertion } from '../lib/googleAdsClient';

function b64urlToJson(seg: string): any {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

describe('loadServiceAccountKey', () => {
  const original = process.env.GOOGLE_ADS_SA_KEY;

  it('parses raw JSON and base64-encoded JSON, rejects garbage', () => {
    const key = { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: 'PK' };
    process.env.GOOGLE_ADS_SA_KEY = JSON.stringify(key);
    expect(loadServiceAccountKey()?.client_email).toBe('svc@proj.iam.gserviceaccount.com');

    process.env.GOOGLE_ADS_SA_KEY = Buffer.from(JSON.stringify(key)).toString('base64');
    expect(loadServiceAccountKey()?.client_email).toBe('svc@proj.iam.gserviceaccount.com');

    process.env.GOOGLE_ADS_SA_KEY = 'not json at all';
    expect(loadServiceAccountKey()).toBeNull();

    process.env.GOOGLE_ADS_SA_KEY = JSON.stringify({ client_email: 'x' }); // missing private_key
    expect(loadServiceAccountKey()).toBeNull();

    delete process.env.GOOGLE_ADS_SA_KEY;
    expect(loadServiceAccountKey()).toBeNull();

    if (original === undefined) delete process.env.GOOGLE_ADS_SA_KEY;
    else process.env.GOOGLE_ADS_SA_KEY = original;
  });
});

describe('buildAssertion', () => {
  it('produces a verifiable RS256 JWT with the right claims', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const jwt = buildAssertion({
      client_email: 'svc@proj.iam.gserviceaccount.com',
      private_key: privateKey,
      token_uri: 'https://oauth2.googleapis.com/token',
    });
    const [header, claims, signature] = jwt.split('.');
    expect(header && claims && signature).toBeTruthy();

    // Header is RS256.
    expect(b64urlToJson(header)).toEqual({ alg: 'RS256', typ: 'JWT' });

    // Claims carry issuer, datamanager scope, and audience.
    const c = b64urlToJson(claims);
    expect(c.iss).toBe('svc@proj.iam.gserviceaccount.com');
    expect(c.scope).toBe('https://www.googleapis.com/auth/datamanager');
    expect(c.aud).toBe('https://oauth2.googleapis.com/token');
    expect(c.exp).toBe(c.iat + 3600);

    // Signature verifies against the public key over "header.claims".
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${claims}`);
    const sigBuf = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(verifier.verify(publicKey, sigBuf)).toBe(true);
  });
});
