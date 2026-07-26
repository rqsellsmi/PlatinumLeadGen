/**
 * Subject updates / upgrades since the last sale (spec §5.2 — seller intake).
 *
 * The subject's facts come from its prior MLS sale, which can be years stale. This
 * lets an operator record major value-affecting changes made since (finished the
 * basement, added a bed/bath, put on an addition) and folds them into the SUBJECT's
 * drivers before valuation — so the adjustment grid prices comps toward the
 * improved home (a comp without the finished basement is adjusted UP to match).
 *
 * Pure (only touches the AvmSubject shape), so it's unit-tested. Numeric deltas
 * apply only when the base value is known — we never fabricate "+1 bed" onto an
 * unknown base (that would wrongly swing the comps); flags (finished/walkout/etc.)
 * always apply.
 */
import type { AvmSubject } from './valuate';

export interface SubjectUpdates {
  addedBeds?: number;
  addedBaths?: number;
  addedSqft?: number;
  addedGarageBays?: number;
  finishedBasement?: boolean;
  addedWalkout?: boolean;
  addedEgress?: boolean;
  addedPool?: boolean;
  addedPoleBarn?: boolean;
}

/** True if any update field is set. */
export function hasUpdates(u: SubjectUpdates | null | undefined): boolean {
  if (!u) return false;
  return Boolean(
    u.addedBeds || u.addedBaths || u.addedSqft || u.addedGarageBays ||
      u.finishedBasement || u.addedWalkout || u.addedEgress || u.addedPool || u.addedPoleBarn,
  );
}

export function applyUpdates(
  subject: AvmSubject,
  u: SubjectUpdates,
): { subject: AvmSubject; applied: string[]; skipped: string[] } {
  const s: AvmSubject = { ...subject };
  const applied: string[] = [];
  const skipped: string[] = [];

  if (u.addedBeds) {
    if (s.beds != null) { s.beds += u.addedBeds; applied.push(`+${u.addedBeds} bd`); }
    else skipped.push(`+${u.addedBeds} bd (base unknown)`);
  }
  if (u.addedBaths) {
    if (s.baths != null) { s.baths += u.addedBaths; applied.push(`+${u.addedBaths} ba`); }
    else skipped.push(`+${u.addedBaths} ba (base unknown)`);
  }
  if (u.addedSqft) {
    if (s.sqft != null) { s.sqft += u.addedSqft; applied.push(`+${u.addedSqft.toLocaleString('en-US')} sqft`); }
    else skipped.push(`+${u.addedSqft} sqft (base unknown)`);
  }
  if (u.addedGarageBays) {
    if (s.garageSpaces != null) { s.garageSpaces += u.addedGarageBays; applied.push(`+${u.addedGarageBays} garage bay`); }
    else skipped.push(`+${u.addedGarageBays} garage (base unknown)`);
  }

  // Basement flags fold into the RESO-enum-style string so parseBasement picks
  // them up (they always apply — even onto an unknown base, which then becomes
  // "known + finished").
  const basementParts: string[] = [];
  if (u.finishedBasement) { basementParts.push('Finished'); applied.push('finished basement'); }
  if (u.addedWalkout) { basementParts.push('Walk-Out Access'); applied.push('walkout'); }
  if (u.addedEgress) { basementParts.push('Egress Window(s)'); applied.push('egress'); }
  if (basementParts.length) s.basement = [s.basement, ...basementParts].filter(Boolean).join(', ');

  if (u.addedPool) { s.pool = true; applied.push('pool'); }
  if (u.addedPoleBarn) { s.poleBarn = true; applied.push('pole barn'); }

  if (applied.length) s.factsSource = `${subject.factsSource} + updates (${applied.join(', ')})`;
  return { subject: s, applied, skipped };
}
