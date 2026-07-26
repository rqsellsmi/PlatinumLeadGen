/**
 * Humanize Realcomp/RESO enum tokens for display. The feed returns space-less
 * PascalCase/camelCase tokens ("SingleFamilyResidence", "WalkOutAccess",
 * "LakeFenton"); this splits them into spaced words ("Single Family Residence",
 * "Walk Out Access", "Lake Fenton"), preserving comma lists and other separators
 * (" · "). It is a no-op on already-spaced text, numbers, and currency, so it is
 * safe to apply to any detail value. Client-safe (pure, no imports).
 */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '';
  return value
    // insert a space between a lowercase/digit and a following uppercase letter
    // ("SingleFamily" → "Single Family"); commas/other separators are untouched,
    // so thousands separators like "$12,655" are left alone.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // ...and split a run of caps that starts a new word ("ADAAccess" → "ADA Access")
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
