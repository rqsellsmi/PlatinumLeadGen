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

/**
 * The pre-acceptance offer. Carries enough to decide — who, roughly where, how
 * much, how soon — and nothing that identifies or locates the seller.
 *
 * There is deliberately NO `address` parameter. This used to fall back to the
 * full property address whenever `city` was empty, on the reasoning that the
 * forms never captured a city; that stopped being true when Places address
 * components were wired up (P0.4), and it meant an unaccepted offer text
 * carried the seller's street address. Removing the parameter makes that
 * structurally impossible rather than a rule someone has to remember — callers
 * pass a city or nothing (see deriveCityFromAddress for the fallback).
 *
 * Phone and email never appear here. They go out on accept, in clientInfoText.
 *
 * Kept to plain ASCII: an em dash or a curly quote forces the whole message
 * from GSM-7 into UCS-2, which cuts the per-segment budget from 160 characters
 * to 70 and silently doubles or triples the cost of every offer we send.
 */
export function offerText(p: {
  leadId: number;
  firstName: string | null;
  city: string | null;
  estimate: number | null;
  timeframe?: string | null;
  deadline: string;
}): string {
  const name = (p.firstName ?? '').trim();
  const loc = (p.city ?? '').trim();
  const whoWhere = [name || null, loc ? `in ${loc}` : null].filter(Boolean).join(' ');
  const est = money(p.estimate);
  const tf = (p.timeframe ?? '').trim();
  // Accept/decline is inferred from the agent's single open offer, so a plain
  // YES / NO is enough — no lead number required (only status updates need one).
  return [
    `RE/MAX Platinum: new lead #${p.leadId}.`,
    whoWhere ? `${whoWhere}.` : '',
    est ? `Est. ${est}.` : '',
    tf ? `Timeframe: ${tf}.` : '',
    'Reply YES to accept or NO to pass.',
    `Expires ${p.deadline}.`,
  ]
    .filter(Boolean)
    .join(' ');
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
