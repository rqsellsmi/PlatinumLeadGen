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
