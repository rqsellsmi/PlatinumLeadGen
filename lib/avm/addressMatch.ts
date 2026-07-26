/**
 * Do two address strings refer to the same physical property?
 *
 * Matches on house number + the CORE street name + ZIP — deliberately NOT the full
 * normalized string, and NOT a naive "first word after the number." Real-world
 * address sources disagree on:
 *   - CITY: Google says "Village of Clarkston", the MLS says "Clarkston".
 *   - DIRECTIONALS: Google drops the "N" in "41101 N Maplewood Dr" → "41101
 *     Maplewood Dr". The directional is not the street name.
 *   - SUFFIXES: "Dr" vs "Drive", or a feed quirk that doubles it ("Maplewood Dr Dr").
 * So we reduce each street to house number + core name (directionals + street-type
 * suffixes removed) and compare that, guarding on ZIP when both are known.
 *
 * Pure (only depends on `normalizeAddress`) so it's unit-tested — this exact class
 * of address-matching bug has now bitten twice (city mismatch, then directional).
 */
import { normalizeAddress } from '../addressNormalization';

const DIRECTIONALS = new Set([
  'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw',
  'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest',
]);

const SUFFIXES = new Set([
  'st', 'street', 'ave', 'avenue', 'dr', 'drive', 'ct', 'court', 'ln', 'lane', 'rd', 'road',
  'blvd', 'boulevard', 'way', 'pl', 'place', 'ter', 'terrace', 'cir', 'circle', 'trl', 'trail',
  'pkwy', 'parkway', 'hwy', 'highway', 'sq', 'square', 'loop', 'run', 'path', 'pass', 'xing',
  'crossing', 'pt', 'point', 'hl', 'hill', 'hls', 'hills', 'cv', 'cove', 'row', 'walk',
]);

/** Reduce a normalized street string to { house number, core street name }. */
function streetKey(street: string | null): { num: string | null; core: string } {
  const s = (street ?? '').toLowerCase().trim();
  if (!s) return { num: null, core: '' };
  const numMatch = s.match(/^(\d+)\s*/);
  const num = numMatch ? numMatch[1] : null;
  const rest = num ? s.slice(numMatch![0].length) : s;
  const tokens = rest.split(/\s+/).filter(Boolean);
  const noSuffix = tokens.filter((t) => !SUFFIXES.has(t));
  const noDir = noSuffix.filter((t) => !DIRECTIONALS.has(t));
  // Prefer name with directionals+suffixes stripped; fall back so a street literally
  // named "North" or "Cove" doesn't reduce to nothing.
  const core = (noDir.length ? noDir : noSuffix.length ? noSuffix : tokens).join(' ');
  return { num, core };
}

export function sameProperty(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  const ka = streetKey(na.street);
  const kb = streetKey(nb.street);
  if (!ka.core || !kb.core) return false;

  // Different ZIPs (when both are genuinely known) → different property. Guard
  // against normalizeAddress mistaking a 5-digit HOUSE NUMBER for the ZIP (e.g.
  // "41101 N Maplewood Dr" with no ZIP → zip="41101"), and compare only the
  // 5-digit prefix so ZIP+4 doesn't spuriously differ.
  const realZip = (zip: string | null, houseNum: string | null): string | null =>
    zip && zip !== houseNum ? zip.slice(0, 5) : null;
  const zipA = realZip(na.zip, ka.num);
  const zipB = realZip(nb.zip, kb.num);
  if (zipA && zipB && zipA !== zipB) return false;

  // House number must match when both are known.
  if (ka.num && kb.num && ka.num !== kb.num) return false;
  return ka.core === kb.core;
}
