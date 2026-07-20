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
  leadId: number; city: string | null; estimate: number | null; deadline: string;
}): string {
  const where = p.city ? ` in ${p.city}` : '';
  const est = money(p.estimate);
  const estBit = est ? ` ${est}` : '';
  return `RE/MAX Platinum: new lead #${p.leadId}${where}${estBit}. ` +
    `Reply YES ${p.leadId} to accept or NO ${p.leadId} to pass. Expires ${p.deadline}.`;
}

export function clientInfoText(p: {
  leadId: number; firstName: string | null; lastName: string | null;
  phone: string | null; email: string | null; address: string | null;
  city: string | null; estimate: number | null;
}): string {
  const name = fullName(p.firstName, p.lastName) || 'Client';
  const contact = [p.phone, p.email].filter(Boolean).join(', ');
  const property = [p.address, p.city].filter(Boolean).join(', ');
  const est = money(p.estimate);
  const parts = [
    `Lead #${p.leadId}: ${name}${contact ? `, ${contact}` : ''}.`,
    property ? `Property: ${property}.` : '',
    est ? `Est. ${est}.` : '',
    `Reply CONTACTED ${p.leadId} <notes> to log updates.`,
  ].filter(Boolean);
  return parts.join(' ');
}

export function updateReminderText(p: {
  leadId: number; firstName: string | null; lastName: string | null; address: string | null;
}): string {
  const name = fullName(p.firstName, p.lastName) || 'your lead';
  const at = p.address ? `, ${p.address}` : '';
  return `Lead #${p.leadId} — ${name}${at} needs a status update. ` +
    `Reply e.g. CONTACTED ${p.leadId} left a voicemail.`;
}

export function helpText(): string {
  return 'RE/MAX Platinum lead texts. Reply e.g. YES <id>, NO <id>, or CONTACTED <id> notes. ' +
    'Reply STOP to opt out, START to resume.';
}

export function optOutAckText(): string {
  return 'You are opted out of RE/MAX Platinum lead texts. Reply START to resume. You will still get emails.';
}
