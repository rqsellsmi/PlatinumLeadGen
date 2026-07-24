/**
 * Pure SMS body formatters for agent texting (design spec §5). No PII in the
 * offer teaser; full client info only in clientInfoText. Empty fields omitted.
 */

/** "$412k" style compact price; '' when null. */
function money(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ').trim();
}

export function offerText(p: {
  leadId: number; city: string | null; address?: string | null; estimate: number | null; deadline: string;
}): string {
  // Location: prefer a stored city, else fall back to the full property address
  // (the valuation forms capture the address string but not a separate city, so
  // city is usually empty). Agents decide by where the property is, so the
  // offer must always carry a location when we have one.
  const loc = (p.city && p.city.trim()) || (p.address && p.address.trim()) || '';
  const where = loc ? ` in ${loc}` : '';
  const est = money(p.estimate);
  const estBit = est ? ` Est. ${est}.` : '';
  // Accept/decline is inferred from the agent's single open offer, so a plain
  // YES / NO is enough — no lead number required (only status updates need one).
  return `RE/MAX Platinum: new lead #${p.leadId}${where}.${estBit} ` +
    `Reply YES to accept or NO to pass. Expires ${p.deadline}.`;
}

export function clientInfoText(p: {
  leadId: number; firstName: string | null; lastName: string | null;
  phone: string | null; email: string | null; address: string | null;
  city: string | null; estimate: number | null; leadUrl?: string;
}): string {
  const name = fullName(p.firstName, p.lastName) || 'Client';
  const contact = [p.phone, p.email].filter(Boolean).join(', ');
  const property = [p.address, p.city].filter(Boolean).join(', ');
  const est = money(p.estimate);
  const parts = [
    `Lead #${p.leadId}: ${name}${contact ? `, ${contact}` : ''}.`,
    property ? `Property: ${property}.` : '',
    est ? `Est. ${est}.` : '',
    p.leadUrl ? `View: ${p.leadUrl}.` : '',
    `Reply CONNECTED ${p.leadId} <notes> to log updates.`,
  ].filter(Boolean);
  return parts.join(' ');
}

export function updateReminderText(p: {
  leadId: number; firstName: string | null; lastName: string | null; address: string | null;
  leadUrl?: string;
}): string {
  const name = fullName(p.firstName, p.lastName) || 'your lead';
  const at = p.address ? `, ${p.address}` : '';
  const view = p.leadUrl ? ` View: ${p.leadUrl}.` : '';
  return `Lead #${p.leadId} — ${name}${at} needs a status update.${view} ` +
    `Reply e.g. CONNECTED ${p.leadId} left a voicemail.`;
}

export function helpText(): string {
  return 'RE/MAX Platinum lead texts. Reply e.g. YES <id>, NO <id>, or CONNECTED <id> notes. ' +
    'Reply STOP to opt out, START to resume.';
}

export function optOutAckText(): string {
  return 'You are opted out of RE/MAX Platinum lead texts. Reply START to resume. You will still get emails.';
}
