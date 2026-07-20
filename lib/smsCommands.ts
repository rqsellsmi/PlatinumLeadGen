/**
 * Pure inbound-SMS command parser (design spec §6.3).
 * Grammar: <command> <lead-code> <notes…>. Commands may be multi-word
 * (e.g. "LEFT VM"). Lead code is a numeric lead id with an optional '#'.
 * Compliance keywords (STOP/START/HELP…) match only when they are the WHOLE
 * message, so a homeowner's "stop by the house" is not an opt-out.
 */

export type LeadStatus =
  | 'new' | 'attempted_contact' | 'contacted' | 'qualified'
  | 'working' | 'closed' | 'lost' | 'reopened';

export type ParsedCommand =
  | { kind: 'accept'; code: number | null; notes: string }
  | { kind: 'decline'; code: number | null; notes: string }
  | { kind: 'status'; status: LeadStatus; code: number | null; notes: string }
  | { kind: 'stop' }
  | { kind: 'start' }
  | { kind: 'help' }
  | { kind: 'unknown'; raw: string };

const ACCEPT = new Set(['yes', 'accept', 'y']);
const DECLINE = new Set(['no', 'decline', 'pass', 'n']);
const STOP = new Set(['stop', 'unsubscribe', 'cancel', 'end', 'quit']);
const START = new Set(['start', 'unstop']);
const HELP = new Set(['help', 'info']);

/** Command phrase (lowercased) → status. Longest phrases first at match time. */
const STATUS_PHRASES: Array<[string, LeadStatus]> = [
  ['left vm', 'attempted_contact'],
  ['contacted', 'contacted'],
  ['spoke', 'contacted'],
  ['called', 'attempted_contact'],
  ['attempted', 'attempted_contact'],
  ['qualified', 'qualified'],
  ['working', 'working'],
  ['closed', 'closed'],
  ['lost', 'lost'],
  ['reopened', 'reopened'],
];
// Match multi-word phrases before single words.
const STATUS_SORTED = [...STATUS_PHRASES].sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);

/** Parse a numeric lead code from a token; null if not a plain number. */
function parseCode(token: string | undefined): number | null {
  if (!token) return null;
  const cleaned = token.replace(/^#/, '');
  if (!/^\d+$/.test(cleaned)) return null;
  return parseInt(cleaned, 10);
}

export function parseCommand(raw: string): ParsedCommand {
  const trimmed = (raw ?? '').trim();
  const lower = trimmed.toLowerCase();

  // Compliance: whole-message match only.
  if (STOP.has(lower)) return { kind: 'stop' };
  if (START.has(lower)) return { kind: 'start' };
  if (HELP.has(lower)) return { kind: 'help' };

  if (trimmed === '') return { kind: 'unknown', raw: '' };

  const tokens = trimmed.split(/\s+/);
  const first = tokens[0].toLowerCase();

  // Accept / decline (single-word commands).
  if (ACCEPT.has(first)) {
    return { kind: 'accept', code: parseCode(tokens[1]), notes: afterCode(tokens) };
  }
  if (DECLINE.has(first)) {
    return { kind: 'decline', code: parseCode(tokens[1]), notes: afterCode(tokens) };
  }

  // Status phrases (possibly multi-word).
  for (const [phrase, status] of STATUS_SORTED) {
    const words = phrase.split(' ');
    if (tokens.length >= words.length &&
        tokens.slice(0, words.length).join(' ').toLowerCase() === phrase) {
      const rest = tokens.slice(words.length);
      const code = parseCode(rest[0]);
      const notes = code != null ? rest.slice(1).join(' ') : rest.join(' ');
      return { kind: 'status', status, code, notes: notes.trim() };
    }
  }

  return { kind: 'unknown', raw: trimmed };
}

/** Notes = everything after the (optional) code token (at index 1). */
function afterCode(tokens: string[]): string {
  const codeTok = tokens[1];
  const hasCode = parseCode(codeTok) != null;
  return tokens.slice(1 + (hasCode ? 1 : 0)).join(' ').trim();
}
