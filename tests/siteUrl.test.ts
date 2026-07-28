import { describe, it, expect } from 'vitest';
import { requestOrigin } from '../lib/siteUrl';

const h = (obj: Record<string, string>) => new Headers(obj);

describe('requestOrigin', () => {
  it('uses the forwarded host + proto (the deployment the user is on)', () => {
    expect(requestOrigin(h({ 'x-forwarded-host': 'app-git-feature.vercel.app', 'x-forwarded-proto': 'https' }))).toBe(
      'https://app-git-feature.vercel.app',
    );
  });
  it('falls back to the host header, defaulting to https', () => {
    expect(requestOrigin(h({ host: 'remax-platinumonline.com' }))).toBe('https://remax-platinumonline.com');
  });
  it('takes the first proto when forwarded as a list', () => {
    expect(requestOrigin(h({ host: 'x.vercel.app', 'x-forwarded-proto': 'https, http' }))).toBe('https://x.vercel.app');
  });
  it('falls back to siteUrl() when no host header is present', () => {
    // No SITE_URL set in tests → the default production domain.
    expect(requestOrigin(h({}))).toBe('https://remax-platinumonline.com');
  });
});
