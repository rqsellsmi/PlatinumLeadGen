/**
 * Resolve the outbound Telnyx "from" number for an agent: their home office's
 * number, else a configured default, else null (caller skips SMS). Design spec §5/§9.2.
 */
export function pickOfficeNumber(o: {
  officeId: number | null;
  numbersByOfficeId: Map<number, string | null>;
  defaultNumber?: string | null;
}): string | null {
  if (o.officeId != null) {
    const n = o.numbersByOfficeId.get(o.officeId);
    if (n) return n;
  }
  return o.defaultNumber ?? null;
}
