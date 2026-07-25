/**
 * Do two address strings refer to the same physical property?
 *
 * Matches on house number + street name + ZIP — deliberately NOT the full
 * normalized string. The CITY portion varies by source (Google autocomplete says
 * "Village of Clarkston", the MLS says "Clarkston", the assessor says
 * "Independence Twp"), so `normalizeAddress().full` (which includes the city)
 * wrongly rejects the same home. ZIP + street is the stable identity.
 *
 * Pure (only depends on `normalizeAddress`) so it's unit-tested — this exact class
 * of address-matching bug is why the backtest first reported "no sale on record"
 * for a home that was sitting in our data.
 */
import { normalizeAddress } from '../addressNormalization';

export function sameProperty(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  const sa = (na.street ?? '').toLowerCase().trim();
  const sb = (nb.street ?? '').toLowerCase().trim();
  if (!sa || !sb) return false;
  // Different ZIPs (when both are known) → different property, even if the street
  // text happens to collide.
  if (na.zip && nb.zip && na.zip !== nb.zip) return false;
  if (sa === sb) return true;

  // Same house number is required; then the primary street word must match, so
  // "5915 Chickadee Ln" == "5915 Chickadee" but not a different street at the same
  // number. (normalizeAddress already normalizes suffixes like Lane→Ln.)
  const numA = sa.match(/^\d+/)?.[0];
  const numB = sb.match(/^\d+/)?.[0];
  if (!numA || !numB || numA !== numB) return false;
  const coreA = sa.replace(/^\d+\s*/, '').split(/\s+/)[0] ?? '';
  const coreB = sb.replace(/^\d+\s*/, '').split(/\s+/)[0] ?? '';
  return coreA.length > 0 && coreA === coreB;
}
