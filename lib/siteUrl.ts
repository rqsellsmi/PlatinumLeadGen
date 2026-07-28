/**
 * Canonical site origin, normalized.
 *
 * `SITE_URL` is set by hand in the dashboard, so it's easy to enter a bare
 * hostname ("remax-platinumonline.com") without a scheme. `new URL()` throws
 * `ERR_INVALID_URL` on a scheme-less value, and metadataBase (app/layout.tsx)
 * runs that during `next build` → the whole production build fails. This helper
 * tolerates the common mistakes so a config typo can never take the build down:
 *   - missing scheme        → prepend https://
 *   - leading/trailing space → trimmed
 *   - trailing slash(es)     → stripped (callers concatenate `${siteUrl()}/path`)
 * Falls back to the production domain when unset.
 */
const DEFAULT_SITE_URL = 'https://remax-platinumonline.com';

export function siteUrl(): string {
  const raw = (process.env.SITE_URL ?? DEFAULT_SITE_URL).trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    // Round-trip through URL to validate + normalize, then drop the trailing slash.
    return new URL(withScheme).origin;
  } catch {
    // Even the prepend didn't yield a valid URL (garbage value) — don't crash the
    // build; fall back to the known-good default.
    return DEFAULT_SITE_URL;
  }
}

/**
 * The origin (scheme + host) of the CURRENT request, for flows that must return
 * to the same deployment the user is actually on rather than the canonical
 * production domain — e.g. an OAuth `redirect_uri`, which must round-trip back to
 * the preview/branch URL the sign-in started from (using `siteUrl()` there sends
 * the user to production, whose callback may not exist → 404). Reads the proxy's
 * forwarded host/proto; falls back to `siteUrl()` when unavailable.
 */
export function requestOrigin(headers: Headers): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) return siteUrl();
  const proto = headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return siteUrl();
  }
}
