/**
 * Key-feature chips for a listing detail page — chosen from the listing's OWN
 * populated data in a priority order. Pure + unit-tested + client-safe (type-only
 * import). NB: never reads the six Realcomp zero-out columns (interiorFeatures,
 * appliances, parkingFeatures, lotFeatures, architecturalStyle,
 * associationAmenities) — they are always NULL (lessons §16b).
 */
import type { IdxListing } from '../drizzle/schema';

export type KeyFeatureIcon =
  | 'water'
  | 'lot'
  | 'new'
  | 'pool'
  | 'garage'
  | 'fire'
  | 'basement'
  | 'year'
  | 'hoa'
  | 'view'
  | 'beds';

export interface KeyFeature {
  icon: KeyFeatureIcon;
  label: string;
}

const has = (hay: string | null | undefined, needle: string): boolean =>
  !!hay && hay.toLowerCase().includes(needle.toLowerCase());

/**
 * Pick up to `max` standout features. Waterfront leads when present (with the
 * lake name / frontage); otherwise the strongest populated attributes fill in.
 */
export function buildKeyFeatures(
  l: Pick<
    IdxListing,
    | 'waterfrontYN'
    | 'waterBodyName'
    | 'waterFrontageFeet'
    | 'waterfrontFeatures'
    | 'lotSizeAcres'
    | 'newConstructionYN'
    | 'poolPrivateYN'
    | 'garageSpaces'
    | 'attachedGarageYN'
    | 'fireplacesTotal'
    | 'fireplaceFeatures'
    | 'basement'
    | 'yearBuilt'
    | 'associationYN'
    | 'associationFee'
    | 'view'
    | 'bedsTotal'
  >,
  max = 6,
): KeyFeature[] {
  const out: KeyFeature[] = [];

  // 1) Waterfront — the marquee feature when present.
  if (l.waterfrontYN || l.waterBodyName || l.waterFrontageFeet) {
    if (l.waterBodyName) out.push({ icon: 'water', label: `On ${l.waterBodyName}` });
    else if (l.waterfrontFeatures) out.push({ icon: 'water', label: l.waterfrontFeatures.split(',')[0].trim() });
    else out.push({ icon: 'water', label: 'Waterfront' });
    if (l.waterFrontageFeet && l.waterFrontageFeet > 0)
      out.push({ icon: 'water', label: `${Math.round(l.waterFrontageFeet)} ft of frontage` });
  }

  // 2) Acreage — notable lots only.
  if (l.lotSizeAcres != null && l.lotSizeAcres >= 1) {
    const acres = Math.round(l.lotSizeAcres * 10) / 10;
    out.push({ icon: 'lot', label: `${acres} acre${acres === 1 ? '' : 's'}` });
  }

  if (l.newConstructionYN) out.push({ icon: 'new', label: 'New construction' });
  if (l.poolPrivateYN) out.push({ icon: 'pool', label: 'Private pool' });

  if ((l.garageSpaces ?? 0) > 0)
    out.push({ icon: 'garage', label: `${l.garageSpaces}-car garage${l.attachedGarageYN ? ' (attached)' : ''}` });

  if ((l.fireplacesTotal ?? 0) > 0 || l.fireplaceFeatures) {
    if (has(l.fireplaceFeatures, 'gas')) out.push({ icon: 'fire', label: 'Gas fireplace' });
    else if ((l.fireplacesTotal ?? 0) > 1) out.push({ icon: 'fire', label: `${l.fireplacesTotal} fireplaces` });
    else out.push({ icon: 'fire', label: 'Fireplace' });
  }

  if (has(l.basement, 'finished')) out.push({ icon: 'basement', label: 'Finished basement' });

  if (l.view && l.view.trim()) out.push({ icon: 'view', label: `${l.view.split(',')[0].trim()} view` });

  if (l.associationYN === false) out.push({ icon: 'hoa', label: 'No HOA' });

  if (l.yearBuilt != null && l.yearBuilt > 1800) out.push({ icon: 'year', label: `Built ${l.yearBuilt}` });

  // De-dupe by label, cap.
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.label) ? false : (seen.add(f.label), true))).slice(0, max);
}
