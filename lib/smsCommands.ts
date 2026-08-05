/**
 * Pure inbound-SMS command parser (design spec §6.3).
 *
 * Grammar: `<command phrase> <lead-code> <notes…>`. Command phrases may be
 * multi-word ("attempted contact", "left vm"). The lead code is a lead id,
 * optionally written `#53`.
 *
 * HOW THE LEAD CODE IS FOUND. The original parser matched a phrase from a fixed
 * list and assumed the very next token was the code. That silently lost the code
 * whenever the phrase was longer than the listed one: "ATTEMPTED CONTACT 53 left
 * another message" matched only the word "attempted", failed to parse "contact"
 * as a number, and swept the id and everything after it into the notes — so the
 * update landed on whichever lead happened to be the agent's only active one.
 * That phrasing is exactly how the portal labels the stage, so it was the most
 * natural thing an agent could type.
 *
 * The code now delimits the phrase rather than the phrase delimiting the code:
 *
 *   1. An explicit `#53` ANYWHERE is definitive — everything before it is the
 *      phrase, everything after is notes.
 *   2. A BARE number counts as the code only when everything before it is an
 *      EXACT known command phrase. This is the guard that keeps a number inside
 *      free text from being mistaken for a lead id: "nurture still thinking 3
 *      months" has no exact phrase before the 3, so the 3 stays in the notes.
 *   3. Otherwise there is no code, and the longest known phrase PREFIX is the
 *      command; the rest is notes.
 *
 * A parsed code is still only a CANDIDATE — the webhook validates it against the
 * sending agent's own offers before acting on it, so a number that names nobody's
 * lead can never redirect an update (see resolveOffer in the telnyx route).
 *
 * Unrecognized messages carry the leading `phrase` back to the caller so the
 * wording can be logged and reviewed in the admin SMS log; common real-world
 * phrasings can then be added to the table below.
 *
 * Compliance keywords (STOP/START/HELP…) match only when they are the WHOLE
 * message, so a homeowner's "stop by the house" is not an opt-out.
 */

export type LeadStatus =
  | 'new' | 'attempted_contact' | 'connected' | 'nurturing'
  | 'appointment_set' | 'signed' | 'closed' | 'lost' | 'reopened';

export type ParsedCommand =
  | { kind: 'accept'; code: number | null; codeExplicit: boolean; notes: string }
  | { kind: 'decline'; code: number | null; codeExplicit: boolean; notes: string }
  | { kind: 'status'; status: LeadStatus; code: number | null; codeExplicit: boolean; notes: string }
  | { kind: 'stop' }
  | { kind: 'start' }
  | { kind: 'help' }
  /** `phrase` is the leading wording we failed to recognize — logged for review. */
  | { kind: 'unknown'; raw: string; phrase: string; code: number | null; notes: string };

const STOP = new Set(['stop', 'unsubscribe', 'cancel', 'end', 'quit']);
const START = new Set(['start', 'unstop']);
const HELP = new Set(['help', 'info']);

/** Longest command phrase we will consider, in words. */
const MAX_PHRASE_WORDS = 4;

type Command =
  | { kind: 'accept' }
  | { kind: 'decline' }
  | { kind: 'status'; status: LeadStatus };

const ACCEPT_WORDS = ['yes', 'accept', 'y'];
const DECLINE_WORDS = ['no', 'decline', 'pass', 'n'];

/**
 * Command phrase (lowercased) → action. Multi-word entries exist so the phrases
 * agents actually read off their own screen ("attempted contact", "appointment
 * set") parse, and aliases cover the words people say instead of the system's
 * ("contacted" / "made contact" for Connected). Order is irrelevant — matching
 * is by exact key, then by longest prefix.
 */
const STATUS_PHRASES: Array<[string, LeadStatus]> = [
  // Appointment set
  ['appointment set', 'appointment_set'],
  ['appt set', 'appointment_set'],
  ['set appointment', 'appointment_set'],
  ['appointment', 'appointment_set'],
  ['appt', 'appointment_set'],
  // Attempted contact
  ['attempted contact', 'attempted_contact'],
  ['attempted to contact', 'attempted_contact'],
  ['tried to contact', 'attempted_contact'],
  ['left voicemail', 'attempted_contact'],
  ['left message', 'attempted_contact'],
  ['left vm', 'attempted_contact'],
  ['no answer', 'attempted_contact'],
  ['voicemail', 'attempted_contact'],
  ['attempted', 'attempted_contact'],
  ['called', 'attempted_contact'],
  ['vm', 'attempted_contact'],
  // Connected
  ['made contact', 'connected'],
  ['got ahold', 'connected'],
  ['talked to', 'connected'],
  ['contacted', 'connected'],
  ['connected', 'connected'],
  ['reached', 'connected'],
  ['spoke', 'connected'],
  // Nurturing
  ['nurturing', 'nurturing'],
  ['nurture', 'nurturing'],
  // Signed
  ['listing signed', 'signed'],
  ['signed', 'signed'],
  // Closed
  ['closed won', 'closed'],
  ['closed', 'closed'],
  ['won', 'closed'],
  // Lost
  ['lost', 'lost'],
];

const COMMAND_LOOKUP: Map<string, Command> = new Map([
  ...ACCEPT_WORDS.map((w) => [w, { kind: 'accept' } as Command] as const),
  ...DECLINE_WORDS.map((w) => [w, { kind: 'decline' } as Command] as const),
  ...STATUS_PHRASES.map(([p, s]) => [p, { kind: 'status', status: s } as Command] as const),
]);

/** Every recognized command phrase — exposed so tests and docs stay in step. */
export const KNOWN_COMMAND_PHRASES: string[] = [...COMMAND_LOOKUP.keys()];

function isBareInt(token: string): boolean {
  return /^\d+$/.test(token);
}

function isHashCode(token: string): boolean {
  return /^#\d+$/.test(token);
}

function codeValue(token: string): number {
  return parseInt(token.replace(/^#/, ''), 10);
}

/**
 * Normalize tokens into a lookup key: lowercase, punctuation trimmed from the
 * edges of each word, so "Connected," and "connected" are the same phrase.
 */
function phraseKey(tokens: string[]): string {
  return tokens
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function withCommand(
  cmd: Command,
  code: number | null,
  codeExplicit: boolean,
  notes: string,
): ParsedCommand {
  const trimmed = notes.trim();
  if (cmd.kind === 'accept') return { kind: 'accept', code, codeExplicit, notes: trimmed };
  if (cmd.kind === 'decline') return { kind: 'decline', code, codeExplicit, notes: trimmed };
  return { kind: 'status', status: cmd.status, code, codeExplicit, notes: trimmed };
}

/**
 * Resolve a phrase (plus already-split notes) into a command: exact match first,
 * then the longest known prefix, with any leftover phrase words folded into the
 * notes. Unrecognized wording is returned with the phrase intact for logging.
 */
function build(
  phraseTokens: string[],
  code: number | null,
  codeExplicit: boolean,
  notesTokens: string[],
  raw: string,
): ParsedCommand {
  const exact = COMMAND_LOOKUP.get(phraseKey(phraseTokens));
  if (exact) return withCommand(exact, code, codeExplicit, notesTokens.join(' '));

  for (let n = Math.min(phraseTokens.length, MAX_PHRASE_WORDS); n >= 1; n--) {
    const cmd = COMMAND_LOOKUP.get(phraseKey(phraseTokens.slice(0, n)));
    if (cmd) {
      const notes = [...phraseTokens.slice(n), ...notesTokens].join(' ');
      return withCommand(cmd, code, codeExplicit, notes);
    }
  }

  return {
    kind: 'unknown',
    raw,
    phrase: phraseKey(phraseTokens.slice(0, MAX_PHRASE_WORDS)),
    code,
    notes: notesTokens.join(' ').trim(),
  };
}

export function parseCommand(raw: string): ParsedCommand {
  const trimmed = (raw ?? '').trim();
  const lower = trimmed.toLowerCase();

  // Compliance: whole-message match only.
  if (STOP.has(lower)) return { kind: 'stop' };
  if (START.has(lower)) return { kind: 'start' };
  if (HELP.has(lower)) return { kind: 'help' };

  if (trimmed === '') return { kind: 'unknown', raw: '', phrase: '', code: null, notes: '' };

  const tokens = trimmed.split(/\s+/);

  // (1) An explicit "#53" is a definitive delimiter, wherever it sits.
  const hashIdx = tokens.findIndex(isHashCode);
  if (hashIdx >= 0) {
    return build(
      tokens.slice(0, hashIdx),
      codeValue(tokens[hashIdx]),
      true,
      tokens.slice(hashIdx + 1),
      trimmed,
    );
  }

  // (2) A bare number is the lead code ONLY if everything before it is an exact
  //     known phrase. Start at 1: a leading number has no phrase before it, so
  //     it is content, not a code.
  const limit = Math.min(tokens.length, MAX_PHRASE_WORDS + 1);
  for (let i = 1; i < limit; i++) {
    if (!isBareInt(tokens[i])) continue;
    const cmd = COMMAND_LOOKUP.get(phraseKey(tokens.slice(0, i)));
    if (cmd) {
      return withCommand(cmd, codeValue(tokens[i]), false, tokens.slice(i + 1).join(' '));
    }
    // The first bare number decides. No exact phrase in front of it means it is
    // part of the message ("...thinking 3 months"), not a lead id.
    break;
  }

  // (3) No code — longest known phrase prefix, remainder is notes.
  return build(tokens, null, false, [], trimmed);
}
