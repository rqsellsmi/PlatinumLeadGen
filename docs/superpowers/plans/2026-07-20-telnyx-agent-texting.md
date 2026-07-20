# Telnyx Agent Texting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents two-way SMS via Telnyx — notify them of leads and let them accept/decline and update status by text — while email stays the source of truth.

**Architecture:** Replace the dormant Twilio stub in `lib/sms.ts` with a Telnyx REST client (no SDK, matching the existing fetch-based provider clients). Outbound texts go out from the agent's **home-office** number (new `offices.telnyx_number`); a signature-verified webhook (`/api/webhooks/telnyx`) receives replies, a pure parser (`lib/smsCommands.ts`) turns them into commands, and a shared offer-action core (extracted from the offer route) executes accept/decline so web and SMS behave identically. Every message is persisted to a new `sms_messages` table.

**Tech Stack:** Next.js 14 (App Router, route handlers `runtime=nodejs`), TypeScript, Drizzle ORM + Neon Postgres (hand-authored idempotent SQL migrations), vitest (pure-logic unit tests), Node `crypto` (Ed25519 signature verification).

## Global Constraints

- **Migration head is `0023_lead_status_working`; new migration is `0024_telnyx_sms`.** Hand-authored idempotent SQL in `drizzle/migrations/`, registered in `drizzle/migrations/meta/_journal.json` (idx 24, version `"7"`, `when: 1785100000000`, `breakpoints: true`). Apply in order.
- **Lead statuses already exist** (`0023`): `new, attempted_contact, contacted, qualified, working, closed, lost, reopened`. No new enum values.
- **Telnyx-only.** No provider flag. Retire all `TWILIO_*` env vars.
- **SMS is additive.** If Telnyx is unconfigured, the office has no number, the agent opted out, or a send fails, the corresponding **email still sends** exactly as today. SMS failures are caught and logged, never thrown.
- **Outbound `from` = the agent's home-office `telnyx_number`** (`agents.office_id` → `offices.telnyx_number`), with a configured default fallback, else skip.
- **Reply grammar:** `<command> <lead-code> <notes…>`. Command may be **multi-word** (`LEFT VM`). Lead code = numeric lead id (optional leading `#`). Notes = the remainder.
- **Command → status map (verbatim from spec §6.3):** `CONTACTED`→contacted, `SPOKE`→contacted, `LEFT VM`→attempted_contact, `CALLED`→attempted_contact, `ATTEMPTED`→attempted_contact, `QUALIFIED`→qualified, `WORKING`→working, `CLOSED`→closed, `LOST`→lost, `REOPENED`→reopened. Accept: `YES`/`ACCEPT`/`Y`. Decline: `NO`/`DECLINE`/`PASS`/`N`. Compliance: `STOP`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT`, `START`/`UNSTOP`, `HELP`/`INFO`.
- **PII rule:** the offer teaser carries NO client contact info; full client info is texted only on accept/assignment.
- **Tests:** every pure-logic unit gets vitest coverage in `tests/*.test.ts`. `npm run test`, `npm run typecheck`, `npm run build` must all pass. Live Telnyx send/receive is the owner's first-connection step (no creds in CI), same as the IDX/Places pattern.
- Spec of record: `docs/superpowers/specs/2026-07-20-telnyx-agent-texting-design.md`.

---

## File Structure

**Create:**
- `drizzle/migrations/0024_telnyx_sms.sql` — new columns + `sms_messages` table.
- `lib/smsTemplates.ts` — pure message-body formatters (offer, client-info, reminder, acks, help).
- `lib/smsCommands.ts` — pure inbound parser (`parseCommand`).
- `lib/telnyxSignature.ts` — Ed25519 webhook signature verification.
- `lib/officeNumbers.ts` — pure `pickOfficeNumber` from-number resolver.
- `lib/smsMessages.ts` — `logSmsMessage` / `updateSmsStatusByTelnyxId` DB helpers.
- `lib/agentSms.ts` — `sendAgentSms` orchestration (opt-out gate → from-number → send → log).
- `lib/offerActions.ts` — shared `applyAccept` / `applyDecline` core (extracted from the offer route).
- `app/api/webhooks/telnyx/route.ts` — inbound + DLR webhook.
- `tests/smsTemplates.test.ts`, `tests/smsCommands.test.ts`, `tests/telnyxSignature.test.ts`, `tests/officeNumbers.test.ts`, `tests/sms.test.ts`, `tests/agentSms.test.ts`.

**Modify:**
- `drizzle/schema.ts` — `offices.telnyxNumber`, `agents.smsOptOut`/`smsOptOutAt`, `smsMessages` table + inferred types.
- `drizzle/migrations/meta/_journal.json` — register `0024`.
- `lib/sms.ts` — Telnyx internals; keep `toE164`; add `buildTelnyxPayload`, `telnyxConfigured`, new `sendSms` signature.
- `app/api/offer/[token]/route.ts` — call `lib/offerActions.ts` instead of inline logic.
- `lib/autoOffer.ts` — offer teaser via `sendAgentSms`; client-info send on accept/assignment (through `offerActions`).
- `app/api/cron/followup-check/route.ts` — send the update-reminder SMS when due.
- `lib/env.ts` — add `TELNYX_*` recommended group; remove `TWILIO_*`.
- `.env.example`, `SETUP.md` — Telnyx setup + carrier-registration note; remove Twilio.
- `docs/current-state.md`, `docs/lessons-learned.md` — record the feature (final task).

---

### Task 1: Migration `0024` + schema

**Files:**
- Create: `drizzle/migrations/0024_telnyx_sms.sql`
- Modify: `drizzle/migrations/meta/_journal.json`, `drizzle/schema.ts`

**Interfaces:**
- Produces: Drizzle table `smsMessages`; types `SmsMessage = typeof smsMessages.$inferSelect`, `NewSmsMessage = typeof smsMessages.$inferInsert`; columns `offices.telnyxNumber`, `agents.smsOptOut`, `agents.smsOptOutAt`.

- [ ] **Step 1: Write the migration SQL**

Create `drizzle/migrations/0024_telnyx_sms.sql`:

```sql
-- Telnyx agent texting (Phase 1). Per-office sending number, agent opt-out,
-- and a message store mirroring email_send_log. Hand-authored, idempotent.

ALTER TABLE "offices" ADD COLUMN IF NOT EXISTS "telnyx_number" varchar(20);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "sms_opt_out" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "sms_opt_out_at" timestamp;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "direction" varchar(10) NOT NULL,
  "agent_id" integer,
  "lead_id" integer,
  "office_id" integer,
  "from_number" varchar(20) NOT NULL,
  "to_number" varchar(20) NOT NULL,
  "body" text NOT NULL,
  "kind" varchar(30) NOT NULL,
  "telnyx_message_id" varchar(100),
  "status" varchar(20) NOT NULL,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_agent_idx" ON "sms_messages" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_lead_idx" ON "sms_messages" ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_telnyx_id_idx" ON "sms_messages" ("telnyx_message_id");
```

- [ ] **Step 2: Register the migration in the journal**

In `drizzle/migrations/meta/_journal.json`, append to the `entries` array (after the `0023` entry):

```json
    {
      "idx": 24,
      "version": "7",
      "when": 1785100000000,
      "tag": "0024_telnyx_sms",
      "breakpoints": true
    }
```

(Add a comma after the previous entry's closing brace.)

- [ ] **Step 3: Add the schema definitions**

In `drizzle/schema.ts`: add `telnyxNumber: varchar('telnyx_number', { length: 20 })` to the `offices` table; add `smsOptOut: boolean('sms_opt_out').notNull().default(false)` and `smsOptOutAt: timestamp('sms_opt_out_at')` to the `agents` table. Then add the table near `emailSendLog`:

```ts
export const smsMessages = pgTable(
  'sms_messages',
  {
    id: serial('id').primaryKey(),
    direction: varchar('direction', { length: 10 }).notNull(), // 'outbound' | 'inbound'
    agentId: integer('agent_id').references(() => agents.id),
    leadId: integer('lead_id').references(() => leads.id),
    officeId: integer('office_id').references(() => offices.id),
    fromNumber: varchar('from_number', { length: 20 }).notNull(),
    toNumber: varchar('to_number', { length: 20 }).notNull(),
    body: text('body').notNull(),
    kind: varchar('kind', { length: 30 }).notNull(),
    telnyxMessageId: varchar('telnyx_message_id', { length: 100 }),
    status: varchar('status', { length: 20 }).notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    agentIdx: index('sms_messages_agent_idx').on(t.agentId),
    leadIdx: index('sms_messages_lead_idx').on(t.leadId),
    telnyxIdx: index('sms_messages_telnyx_id_idx').on(t.telnyxMessageId),
  }),
);

export type SmsMessage = typeof smsMessages.$inferSelect;
export type NewSmsMessage = typeof smsMessages.$inferInsert;
```

- [ ] **Step 4: Verify types compile**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add drizzle/migrations/0024_telnyx_sms.sql drizzle/migrations/meta/_journal.json drizzle/schema.ts
git commit -m "feat(sms): migration 0024 — telnyx_number, sms opt-out, sms_messages"
```

---

### Task 2: Message templates (`lib/smsTemplates.ts`)

**Files:**
- Create: `lib/smsTemplates.ts`, `tests/smsTemplates.test.ts`

**Interfaces:**
- Produces:
  - `offerText(p: { leadId: number; city: string | null; estimate: number | null; deadline: string }): string`
  - `clientInfoText(p: { leadId: number; firstName: string | null; lastName: string | null; phone: string | null; email: string | null; address: string | null; city: string | null; estimate: number | null }): string`
  - `updateReminderText(p: { leadId: number; firstName: string | null; lastName: string | null; address: string | null }): string`
  - `helpText(): string`, `optOutAckText(): string`

- [ ] **Step 1: Write the failing test**

Create `tests/smsTemplates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { offerText, clientInfoText, updateReminderText, helpText } from '../lib/smsTemplates';

describe('offerText', () => {
  it('includes code + city + estimate, no client name', () => {
    const t = offerText({ leadId: 5739, city: 'Brighton', estimate: 412000, deadline: '4:12pm' });
    expect(t).toContain('#5739');
    expect(t).toContain('Brighton');
    expect(t).toContain('$412k');
    expect(t).toContain('YES 5739');
    expect(t).toContain('NO 5739');
  });
  it('omits estimate when null', () => {
    const t = offerText({ leadId: 1, city: 'Fenton', estimate: null, deadline: '5pm' });
    expect(t).not.toContain('$');
  });
});

describe('clientInfoText', () => {
  it('includes name, phone, email, address', () => {
    const t = clientInfoText({ leadId: 5739, firstName: 'Jane', lastName: 'Doe', phone: '+18105550134', email: 'jane@x.com', address: '123 Main St', city: 'Brighton', estimate: 412000 });
    expect(t).toContain('#5739');
    expect(t).toContain('Jane Doe');
    expect(t).toContain('jane@x.com');
    expect(t).toContain('123 Main St');
  });
  it('omits empty fields cleanly', () => {
    const t = clientInfoText({ leadId: 2, firstName: 'Sam', lastName: null, phone: null, email: null, address: null, city: null, estimate: null });
    expect(t).toContain('Sam');
    expect(t).not.toContain('null');
    expect(t).not.toContain('undefined');
  });
});

describe('updateReminderText', () => {
  it('names the lead and asks for a status update', () => {
    const t = updateReminderText({ leadId: 5739, firstName: 'Jane', lastName: 'Doe', address: '123 Main St' });
    expect(t).toContain('#5739');
    expect(t).toContain('Jane Doe');
    expect(t).toContain('123 Main St');
  });
});

describe('helpText', () => {
  it('mentions STOP', () => {
    expect(helpText()).toContain('STOP');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- smsTemplates`
Expected: FAIL ("Cannot find module '../lib/smsTemplates'").

- [ ] **Step 3: Implement `lib/smsTemplates.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- smsTemplates`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/smsTemplates.ts tests/smsTemplates.test.ts
git commit -m "feat(sms): pure message-body templates"
```

---

### Task 3: Inbound command parser (`lib/smsCommands.ts`)

**Files:**
- Create: `lib/smsCommands.ts`, `tests/smsCommands.test.ts`

**Interfaces:**
- Produces:
  - `type LeadStatus = 'new'|'attempted_contact'|'contacted'|'qualified'|'working'|'closed'|'lost'|'reopened'`
  - `type ParsedCommand = { kind:'accept'; code:number|null; notes:string } | { kind:'decline'; code:number|null; notes:string } | { kind:'status'; status:LeadStatus; code:number|null; notes:string } | { kind:'stop' } | { kind:'start' } | { kind:'help' } | { kind:'unknown'; raw:string }`
  - `function parseCommand(raw: string): ParsedCommand`

- [ ] **Step 1: Write the failing test**

Create `tests/smsCommands.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCommand } from '../lib/smsCommands';

describe('parseCommand — accept/decline', () => {
  it('YES + code', () => {
    expect(parseCommand('YES 5739')).toEqual({ kind: 'accept', code: 5739, notes: '' });
  });
  it('accepts lowercase and # prefix', () => {
    expect(parseCommand('accept #5739')).toEqual({ kind: 'accept', code: 5739, notes: '' });
  });
  it('bare Y with no code', () => {
    expect(parseCommand('Y')).toEqual({ kind: 'accept', code: null, notes: '' });
  });
  it('NO/PASS/DECLINE all decline', () => {
    expect(parseCommand('NO 12').kind).toBe('decline');
    expect(parseCommand('pass 12').kind).toBe('decline');
    expect(parseCommand('DECLINE 12').kind).toBe('decline');
  });
});

describe('parseCommand — status', () => {
  it('CONTACTED with code and notes', () => {
    expect(parseCommand('CONTACTED 5739 left a voicemail, retry tmrw')).toEqual({
      kind: 'status', status: 'contacted', code: 5739, notes: 'left a voicemail, retry tmrw',
    });
  });
  it('SPOKE maps to contacted', () => {
    expect(parseCommand('spoke 5739')).toMatchObject({ kind: 'status', status: 'contacted', code: 5739 });
  });
  it('multi-word LEFT VM maps to attempted_contact', () => {
    expect(parseCommand('left vm 5739 no answer')).toEqual({
      kind: 'status', status: 'attempted_contact', code: 5739, notes: 'no answer',
    });
  });
  it('CALLED and ATTEMPTED map to attempted_contact', () => {
    expect(parseCommand('called 1').status).toBe('attempted_contact');
    expect(parseCommand('attempted 1').status).toBe('attempted_contact');
  });
  it('WORKING/QUALIFIED/CLOSED/LOST/REOPENED map through', () => {
    expect(parseCommand('working 1').status).toBe('working');
    expect(parseCommand('qualified 1').status).toBe('qualified');
    expect(parseCommand('closed 1').status).toBe('closed');
    expect(parseCommand('lost 1').status).toBe('lost');
    expect(parseCommand('reopened 1').status).toBe('reopened');
  });
  it('status with no code → code null, remainder is notes', () => {
    expect(parseCommand('CONTACTED left a message')).toEqual({
      kind: 'status', status: 'contacted', code: null, notes: 'left a message',
    });
  });
});

describe('parseCommand — compliance', () => {
  it('STOP and synonyms (whole message only)', () => {
    expect(parseCommand('STOP')).toEqual({ kind: 'stop' });
    expect(parseCommand('unsubscribe')).toEqual({ kind: 'stop' });
    expect(parseCommand('  Quit ')).toEqual({ kind: 'stop' });
  });
  it('START/HELP', () => {
    expect(parseCommand('start')).toEqual({ kind: 'start' });
    expect(parseCommand('HELP')).toEqual({ kind: 'help' });
  });
  it('does not treat "stop by the house" as opt-out', () => {
    expect(parseCommand('stop by the house 5739').kind).toBe('unknown');
  });
});

describe('parseCommand — unknown', () => {
  it('unrecognized leading word', () => {
    expect(parseCommand('thanks!')).toEqual({ kind: 'unknown', raw: 'thanks!' });
  });
  it('empty string', () => {
    expect(parseCommand('   ')).toEqual({ kind: 'unknown', raw: '' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- smsCommands`
Expected: FAIL ("Cannot find module '../lib/smsCommands'").

- [ ] **Step 3: Implement `lib/smsCommands.ts`**

```ts
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
    return { kind: 'accept', code: parseCode(tokens[1]), notes: afterCode(tokens, 1) };
  }
  if (DECLINE.has(first)) {
    return { kind: 'decline', code: parseCode(tokens[1]), notes: afterCode(tokens, 1) };
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

/** Notes = everything after the (optional) code token at index `cmdIdx+1`. */
function afterCode(tokens: string[], cmdIdx: number): string {
  const codeTok = tokens[cmdIdx + 1];
  const hasCode = parseCode(codeTok) != null;
  return tokens.slice(cmdIdx + 1 + (hasCode ? 1 : 0)).join(' ').trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- smsCommands`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/smsCommands.ts tests/smsCommands.test.ts
git commit -m "feat(sms): inbound command parser with multi-word status phrases"
```

---

### Task 4: Webhook signature verification (`lib/telnyxSignature.ts`)

**Files:**
- Create: `lib/telnyxSignature.ts`, `tests/telnyxSignature.test.ts`

**Interfaces:**
- Produces: `function verifyTelnyxSignature(o: { payload: string; signatureB64: string; timestamp: string; publicKeyB64: string; toleranceSec?: number; nowSec?: number }): boolean`

**Notes:** Telnyx signs the bytes `` `${timestamp}|${payload}` `` with Ed25519. The public key is distributed as base64 of the raw 32-byte key; wrap it in the fixed Ed25519 SPKI DER prefix to build a Node `KeyObject`.

- [ ] **Step 1: Write the failing test**

Create `tests/telnyxSignature.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign, KeyObject } from 'node:crypto';
import { verifyTelnyxSignature } from '../lib/telnyxSignature';

/** Export the raw 32-byte Ed25519 public key as base64 (what Telnyx publishes). */
function rawPublicKeyB64(pub: KeyObject): string {
  const der = pub.export({ type: 'spki', format: 'der' }) as Buffer;
  return der.subarray(der.length - 32).toString('base64');
}

describe('verifyTelnyxSignature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyB64 = rawPublicKeyB64(publicKey);
  const payload = '{"data":{"event_type":"message.received"}}';
  const timestamp = '1785100000';
  const signatureB64 = cryptoSign(null, Buffer.from(`${timestamp}|${payload}`), privateKey).toString('base64');

  it('accepts a valid signature within tolerance', () => {
    expect(verifyTelnyxSignature({ payload, signatureB64, timestamp, publicKeyB64, nowSec: 1785100010 })).toBe(true);
  });
  it('rejects a tampered payload', () => {
    expect(verifyTelnyxSignature({ payload: payload + 'x', signatureB64, timestamp, publicKeyB64, nowSec: 1785100010 })).toBe(false);
  });
  it('rejects a stale timestamp', () => {
    expect(verifyTelnyxSignature({ payload, signatureB64, timestamp, publicKeyB64, nowSec: 1785100000 + 999999, toleranceSec: 300 })).toBe(false);
  });
  it('rejects garbage signature without throwing', () => {
    expect(verifyTelnyxSignature({ payload, signatureB64: 'notbase64!!', timestamp, publicKeyB64, nowSec: 1785100010 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- telnyxSignature`
Expected: FAIL ("Cannot find module '../lib/telnyxSignature'").

- [ ] **Step 3: Implement `lib/telnyxSignature.ts`**

```ts
/**
 * Verify a Telnyx webhook Ed25519 signature (design spec §6.1).
 * Signed message is `${timestamp}|${payload}`. The public key arrives as
 * base64 of the raw 32-byte key; we wrap it in the fixed Ed25519 SPKI prefix.
 * Never throws — returns false on any malformed input.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

// DER prefix for an Ed25519 SubjectPublicKeyInfo (12 bytes), then the 32-byte key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function publicKeyFromRawB64(b64: string) {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) throw new Error('bad ed25519 key length');
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

export function verifyTelnyxSignature(o: {
  payload: string;
  signatureB64: string;
  timestamp: string;
  publicKeyB64: string;
  toleranceSec?: number;
  nowSec?: number;
}): boolean {
  try {
    const tolerance = o.toleranceSec ?? 5 * 60;
    const now = o.nowSec ?? Math.floor(Date.now() / 1000);
    const ts = parseInt(o.timestamp, 10);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false;

    const key = publicKeyFromRawB64(o.publicKeyB64);
    const signed = Buffer.from(`${o.timestamp}|${o.payload}`);
    const sig = Buffer.from(o.signatureB64, 'base64');
    if (sig.length !== 64) return false;
    return cryptoVerify(null, signed, key, sig);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- telnyxSignature`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/telnyxSignature.ts tests/telnyxSignature.test.ts
git commit -m "feat(sms): telnyx webhook ed25519 signature verification"
```

---

### Task 5: Telnyx client (`lib/sms.ts`)

**Files:**
- Modify: `lib/sms.ts`
- Create: `tests/sms.test.ts`

**Interfaces:**
- Keeps: `toE164(raw: string | null | undefined): string | null` (unchanged).
- Produces:
  - `telnyxConfigured(): boolean` (true when `TELNYX_API_KEY` set).
  - `buildTelnyxPayload(from: string, to: string, text: string): { from: string; to: string; text: string; messaging_profile_id?: string }` (pure).
  - `sendSms(to: string | null | undefined, body: string, opts: { from: string }): Promise<SmsResult>` where `SmsResult = { sent: boolean; skipped?: boolean; error?: string; telnyxMessageId?: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/sms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toE164, buildTelnyxPayload } from '../lib/sms';

describe('toE164', () => {
  it('normalizes 10-digit US', () => expect(toE164('810-555-0134')).toBe('+18105550134'));
  it('keeps E.164', () => expect(toE164('+18105550134')).toBe('+18105550134'));
  it('rejects junk', () => expect(toE164('abc')).toBeNull());
});

describe('buildTelnyxPayload', () => {
  it('builds from/to/text', () => {
    expect(buildTelnyxPayload('+15550001111', '+18105550134', 'hi')).toMatchObject({
      from: '+15550001111', to: '+18105550134', text: 'hi',
    });
  });
  it('adds messaging_profile_id when env set', () => {
    process.env.TELNYX_MESSAGING_PROFILE_ID = 'MP123';
    expect(buildTelnyxPayload('+1', '+2', 'x').messaging_profile_id).toBe('MP123');
    delete process.env.TELNYX_MESSAGING_PROFILE_ID;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- sms`
Expected: FAIL (`buildTelnyxPayload` not exported).

- [ ] **Step 3: Rewrite `lib/sms.ts` with Telnyx internals**

Keep `toE164` exactly as it is. Replace the Twilio `creds`/`smsConfigured`/`sendSms` with:

```ts
export interface SmsResult {
  sent: boolean;
  skipped?: boolean;
  error?: string;
  telnyxMessageId?: string;
}

/** True when the Telnyx API key is present. Office-number presence is checked per-send. */
export function telnyxConfigured(): boolean {
  return !!process.env.TELNYX_API_KEY;
}

/** Pure Telnyx Messages API request body. */
export function buildTelnyxPayload(from: string, to: string, text: string) {
  const body: { from: string; to: string; text: string; messaging_profile_id?: string } = { from, to, text };
  const mp = process.env.TELNYX_MESSAGING_PROFILE_ID;
  if (mp) body.messaging_profile_id = mp;
  return body;
}

/** Send one SMS via Telnyx. {skipped:true} when unconfigured or number invalid. */
export async function sendSms(
  to: string | null | undefined,
  body: string,
  opts: { from: string },
): Promise<SmsResult> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return { sent: false, skipped: true };
  const e164 = toE164(to);
  if (!e164) return { sent: false, skipped: true, error: 'invalid-or-missing-number' };
  if (!opts.from) return { sent: false, skipped: true, error: 'no-from-number' };

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildTelnyxPayload(opts.from, e164, body)),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { sent: false, error: `telnyx ${res.status} ${txt.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: { id?: string } } | null;
    return { sent: true, telnyxMessageId: json?.data?.id };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'sms error' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- sms`
Expected: PASS. Also run `npm run typecheck` — expect failures at the two `autoOffer.ts` call sites (old `sendSms(agent.phone, body)` signature); those are fixed in Task 8.

- [ ] **Step 5: Commit**

```bash
git add lib/sms.ts tests/sms.test.ts
git commit -m "feat(sms): telnyx client replacing twilio internals"
```

---

### Task 6: From-number resolver (`lib/officeNumbers.ts`)

**Files:**
- Create: `lib/officeNumbers.ts`, `tests/officeNumbers.test.ts`

**Interfaces:**
- Produces: `function pickOfficeNumber(o: { officeId: number | null; numbersByOfficeId: Map<number, string | null>; defaultNumber?: string | null }): string | null`

- [ ] **Step 1: Write the failing test**

Create `tests/officeNumbers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickOfficeNumber } from '../lib/officeNumbers';

describe('pickOfficeNumber', () => {
  const numbers = new Map<number, string | null>([[1, '+15550001111'], [2, null]]);
  it('returns the office number', () => {
    expect(pickOfficeNumber({ officeId: 1, numbersByOfficeId: numbers })).toBe('+15550001111');
  });
  it('falls back to default when office has no number', () => {
    expect(pickOfficeNumber({ officeId: 2, numbersByOfficeId: numbers, defaultNumber: '+15559999999' })).toBe('+15559999999');
  });
  it('falls back to default when agent has no office', () => {
    expect(pickOfficeNumber({ officeId: null, numbersByOfficeId: numbers, defaultNumber: '+15559999999' })).toBe('+15559999999');
  });
  it('returns null when nothing resolves', () => {
    expect(pickOfficeNumber({ officeId: 3, numbersByOfficeId: numbers })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- officeNumbers`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/officeNumbers.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- officeNumbers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/officeNumbers.ts tests/officeNumbers.test.ts
git commit -m "feat(sms): office-number from-address resolver"
```

---

### Task 7: Message store helpers (`lib/smsMessages.ts`)

**Files:**
- Create: `lib/smsMessages.ts`

**Interfaces:**
- Consumes: `smsMessages`, `NewSmsMessage` (Task 1); `db` (`lib/db.ts`).
- Produces:
  - `logSmsMessage(row: NewSmsMessage): Promise<void>`
  - `updateSmsStatusByTelnyxId(telnyxMessageId: string, status: string, errorMessage?: string): Promise<void>`

- [ ] **Step 1: Implement `lib/smsMessages.ts`**

```ts
/** Persist and update SMS message rows (design spec §4.2). Best-effort; swallows errors. */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { smsMessages, type NewSmsMessage } from '@/drizzle/schema';

export async function logSmsMessage(row: NewSmsMessage): Promise<void> {
  try {
    await db.insert(smsMessages).values(row);
  } catch (err) {
    console.error('[sms] logSmsMessage failed:', err);
  }
}

export async function updateSmsStatusByTelnyxId(
  telnyxMessageId: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  try {
    await db
      .update(smsMessages)
      .set({ status, errorMessage: errorMessage ?? null, updatedAt: new Date() })
      .where(eq(smsMessages.telnyxMessageId, telnyxMessageId));
  } catch (err) {
    console.error('[sms] updateSmsStatusByTelnyxId failed:', err);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no new errors from this file (autoOffer call-site errors from Task 5 may still show; fixed next).

- [ ] **Step 3: Commit**

```bash
git add lib/smsMessages.ts
git commit -m "feat(sms): message-store insert/update helpers"
```

---

### Task 8: Agent-SMS orchestration (`lib/agentSms.ts`)

**Files:**
- Create: `lib/agentSms.ts`, `tests/agentSms.test.ts`
- Modify: `lib/autoOffer.ts` (fix the two `sendSms` call sites to the new signature)

**Interfaces:**
- Consumes: `sendSms` (Task 5), `pickOfficeNumber` (Task 6), `logSmsMessage` (Task 7), `toE164`.
- Produces:
  - `shouldSendAgentSms(agent: { smsOptOut: boolean | null; phone: string | null }): boolean` (pure).
  - `sendAgentSms(o: { agent: { id: number; phone: string | null; officeId: number | null; smsOptOut: boolean | null }; body: string; kind: string; leadId?: number | null }): Promise<void>` — resolves from-number from DB office numbers, gates on opt-out, sends, logs. Never throws.

- [ ] **Step 1: Write the failing test**

Create `tests/agentSms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldSendAgentSms } from '../lib/agentSms';

describe('shouldSendAgentSms', () => {
  it('true for opted-in agent with a phone', () => {
    expect(shouldSendAgentSms({ smsOptOut: false, phone: '+18105550134' })).toBe(true);
  });
  it('false when opted out', () => {
    expect(shouldSendAgentSms({ smsOptOut: true, phone: '+18105550134' })).toBe(false);
  });
  it('false when no phone', () => {
    expect(shouldSendAgentSms({ smsOptOut: false, phone: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- agentSms`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/agentSms.ts`**

```ts
/**
 * Send an SMS to an agent from their home-office number, gated on opt-out and
 * config, logging every attempt. Email is the source of truth — this never
 * throws (design spec §5/§8/§9).
 */
import { sendSms } from './sms';
import { pickOfficeNumber } from './officeNumbers';
import { logSmsMessage } from './smsMessages';
import { db } from './db';
import { offices } from '@/drizzle/schema';

export function shouldSendAgentSms(agent: { smsOptOut: boolean | null; phone: string | null }): boolean {
  return !agent.smsOptOut && !!agent.phone;
}

async function officeNumberMap(): Promise<Map<number, string | null>> {
  const rows = await db.select({ id: offices.id, telnyxNumber: offices.telnyxNumber }).from(offices);
  return new Map(rows.map((r) => [r.id, r.telnyxNumber]));
}

export async function sendAgentSms(o: {
  agent: { id: number; phone: string | null; officeId: number | null; smsOptOut: boolean | null };
  body: string;
  kind: string;
  leadId?: number | null;
}): Promise<void> {
  try {
    if (!process.env.TELNYX_API_KEY) return;
    if (!shouldSendAgentSms(o.agent)) return;

    const numbers = await officeNumberMap();
    const from = pickOfficeNumber({
      officeId: o.agent.officeId,
      numbersByOfficeId: numbers,
      defaultNumber: process.env.TELNYX_DEFAULT_FROM ?? null,
    });
    if (!from) return; // no office number configured — email still sent by caller

    const officeId = o.agent.officeId ?? null;
    const res = await sendSms(o.agent.phone, o.body, { from });
    await logSmsMessage({
      direction: 'outbound',
      agentId: o.agent.id,
      leadId: o.leadId ?? null,
      officeId,
      fromNumber: from,
      toNumber: o.agent.phone ?? '',
      body: o.body,
      kind: o.kind,
      telnyxMessageId: res.telnyxMessageId ?? null,
      status: res.sent ? 'sent' : 'failed',
      errorMessage: res.error ?? null,
    });
  } catch (err) {
    console.error('[agentSms] send failed:', err);
  }
}
```

- [ ] **Step 4: Fix the `autoOffer.ts` call sites (offer teaser)**

In `lib/autoOffer.ts`, replace the offer-alert block (~lines 243-253) and the assignment-alert block (~lines 376-381). For the **offer** send, use the teaser template + `sendAgentSms`:

```ts
import { sendAgentSms } from './agentSms';
import { offerText } from './smsTemplates';
// ...remove: import { sendSms } from './sms';

// offer alert (replaces the old sendSms call):
try {
  await sendAgentSms({
    agent,
    kind: 'offer',
    leadId: lead.id,
    body: offerText({
      leadId: lead.id,
      city: lead.propertyCity ?? null,
      estimate: lead.estimatedValue ?? null,
      deadline: formatEtDeadline(deadline),
    }),
  });
} catch (err) {
  console.error('[autoOffer] offer SMS failed:', err);
}
```

For the **manual-assignment** path (the second old `sendSms`), send **client info** instead of a teaser — see Task 9, which provides `clientInfoText` + the assignment hook. For now, replace the old assignment `sendSms` call with a `sendAgentSms({ agent, kind: 'lead_details', leadId, body: clientInfoText({...}) })` using the lead's contact fields (`firstName`, `lastName`, `phone`, `email`, `propertyAddress`, `propertyCity`, `estimatedValue`).

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- agentSms` → PASS.
Run: `npm run typecheck` → PASS (call sites now match the new signature).

- [ ] **Step 6: Commit**

```bash
git add lib/agentSms.ts tests/agentSms.test.ts lib/autoOffer.ts
git commit -m "feat(sms): agent-sms orchestration + wire offer/assignment sends"
```

---

### Task 9: Shared offer-action core (`lib/offerActions.ts`)

**Files:**
- Create: `lib/offerActions.ts`
- Modify: `app/api/offer/[token]/route.ts` (call the shared core), `lib/autoOffer.ts` (assignment uses `clientInfoText`)

**Interfaces:**
- Consumes: `applyScore`, `reassignLead`, `logLeadEvent`, `sendAgentSms`, `clientInfoText`, Drizzle tables.
- Produces:
  - `type OfferActionResult = { ok: boolean; reason?: 'already-responded' | 'expired' | 'not-found'; leadId?: number; agentId?: number }`
  - `applyAccept(offerId: number, opts?: { fastReasonAt?: Date }): Promise<OfferActionResult>`
  - `applyDecline(offerId: number): Promise<OfferActionResult>`
  - `sendClientInfoSms(leadId: number, agentId: number): Promise<void>`

**Rationale:** Today the accept/decline state transition + scoring + reassignment lives inline in `app/api/offer/[token]/route.ts` (POST handler, ~lines 167-230). Extract it verbatim into `applyAccept`/`applyDecline` so the web route and the SMS webhook run identical logic. Client-info SMS is sent from `applyAccept` (and from the assignment path) so **every** ownership event texts the agent their client's details.

- [ ] **Step 1: Extract the core into `lib/offerActions.ts`**

Move the decline logic (status→`declined`, `applyScore('system_decline')`, `logLeadEvent('offer_declined')`, `reassignLead`) into `applyDecline(offerId)`, and the accept logic (guard already-responded; status→`accepted`; lead `acceptedAt`; the fast/slow `ScoreReason` selection at route lines ~210-220; `applyScore`; `logLeadEvent('offer_accepted')`) into `applyAccept(offerId)`. Load the offer row by `id` at the top of each. Return `OfferActionResult`. At the end of `applyAccept`, call `await sendClientInfoSms(leadId, agentId)`.

```ts
/** Shared accept/decline core so web + SMS behave identically (design spec §6.4). */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { leadOffers, leads, agents } from '@/drizzle/schema';
import { applyScore, type ScoreReason } from './scoring';
import { reassignLead } from './autoOffer';
import { logLeadEvent } from './leadEvents';
import { sendAgentSms } from './agentSms';
import { clientInfoText } from './smsTemplates';

export type OfferActionResult = {
  ok: boolean;
  reason?: 'already-responded' | 'expired' | 'not-found';
  leadId?: number;
  agentId?: number;
};

export async function sendClientInfoSms(leadId: number, agentId: number): Promise<void> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!lead || !agent) return;
  await sendAgentSms({
    agent,
    kind: 'lead_details',
    leadId,
    body: clientInfoText({
      leadId,
      firstName: lead.firstName ?? null,
      lastName: lead.lastName ?? null,
      phone: lead.phone ?? null,
      email: lead.email ?? null,
      address: lead.propertyAddress ?? null,
      city: lead.propertyCity ?? null,
      estimate: lead.estimatedValue ?? null,
    }),
  });
}

// applyAccept / applyDecline: move the existing route POST logic here verbatim,
// keyed by offerId, returning OfferActionResult. applyAccept ends with
// `await sendClientInfoSms(result.leadId!, result.agentId!)`.
```

- [ ] **Step 2: Rewire the offer route to call the core**

In `app/api/offer/[token]/route.ts` POST handler: after resolving the offer by token, replace the inline decline block with `const r = await applyDecline(offer.id);` and the inline accept block with `const r = await applyAccept(offer.id);`, then keep the existing session-cookie set + HTML response based on `r`. Preserve the GET confirmation page and bot-safety behavior unchanged.

- [ ] **Step 3: Update the assignment path (`lib/autoOffer.ts`)**

In the manual-assignment path, after the assignment is persisted, call `await sendClientInfoSms(lead.id, agent.id)` (replacing the interim Task 8 inline assignment send) so assignment and accept share one client-info path.

- [ ] **Step 4: Verify existing behavior holds**

Run: `npm run test` → PASS (routing/offer-window suites unaffected).
Run: `npm run typecheck && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/offerActions.ts app/api/offer/[token]/route.ts lib/autoOffer.ts
git commit -m "refactor(offer): shared accept/decline core + client-info SMS on ownership"
```

---

### Task 10: Update-due reminder SMS (`followup-check` cron)

**Files:**
- Modify: `app/api/cron/followup-check/route.ts`

**Interfaces:**
- Consumes: `sendAgentSms`, `updateReminderText`.

- [ ] **Step 1: Add the reminder SMS where the cron emails an update reminder**

Find the block that sends the "update due" email (driven by `firstUpdateDue`/`nextReminderDue`). Immediately after the email send, for the same agent+lead, add:

```ts
import { sendAgentSms } from '@/lib/agentSms';
import { updateReminderText } from '@/lib/smsTemplates';

// ...inside the per-lead reminder loop, after the email send:
await sendAgentSms({
  agent,                // the agent already loaded for the email
  kind: 'update_reminder',
  leadId: lead.id,
  body: updateReminderText({
    leadId: lead.id,
    firstName: lead.firstName ?? null,
    lastName: lead.lastName ?? null,
    address: lead.propertyAddress ?? null,
  }),
});
```

If the loop does not already have the agent's `officeId`/`smsOptOut`/`phone`, extend its `select` to include them (or load the agent row). Do **not** change which leads qualify for a reminder — only add the SMS alongside the existing email.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build` → PASS. `npm run test` → PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/followup-check/route.ts
git commit -m "feat(sms): text agents when a lead update is due"
```

---

### Task 11: Inbound webhook (`app/api/webhooks/telnyx/route.ts`)

**Files:**
- Create: `app/api/webhooks/telnyx/route.ts`

**Interfaces:**
- Consumes: `verifyTelnyxSignature`, `parseCommand`, `applyAccept`, `applyDecline`, `logSmsMessage`, `updateSmsStatusByTelnyxId`, `sendAgentSms`, `helpText`/`optOutAckText`, `toE164`, `sendEmail` (admin forward), Drizzle tables.

**Behavior (design spec §6):**
1. Read the raw body text; verify signature from `telnyx-signature-ed25519` + `telnyx-timestamp` headers against `TELNYX_PUBLIC_KEY`. Reject 401 on failure.
2. Parse JSON. Branch on `data.event_type`:
   - **DLR** (`message.sent`, `message.finalized`, `message.failed`): `updateSmsStatusByTelnyxId(data.payload.id, mappedStatus)`. Return 200.
   - **`message.received`**: continue.
3. Extract inbound `from`, `to`, `text`, provider id. Log the inbound row (`direction:'inbound'`, `status:'received'`).
4. Resolve agent by `toE164(from)` against `agents.phone`. If none → forward text to `MS_GRAPH_ADMIN_EMAIL` (`kind:'admin_forward'`) and return 200.
5. `parseCommand(text)`:
   - `stop` → set `agents.sms_opt_out=true, sms_opt_out_at=now`; reply `optOutAckText()`; email owner. `start` → clear opt-out. `help` → reply `helpText()`.
   - `accept`/`decline`/`status` → resolve the lead code (see §6.3 inference). Authorize the agent owns/was-offered that lead; then call `applyAccept`/`applyDecline` or write a `status_updates` row + `logLeadEvent` (reuse the portal's status-update helper). Reply a short `command_ack`.
   - `unknown` → forward to owner email.
6. Always return 200 quickly after handling (Telnyx retries non-2xx).

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, leadOffers, leads } from '@/drizzle/schema';
import { verifyTelnyxSignature } from '@/lib/telnyxSignature';
import { parseCommand } from '@/lib/smsCommands';
import { applyAccept, applyDecline } from '@/lib/offerActions';
import { logSmsMessage, updateSmsStatusByTelnyxId } from '@/lib/smsMessages';
import { sendAgentSms } from '@/lib/agentSms';
import { helpText, optOutAckText } from '@/lib/smsTemplates';
import { toE164 } from '@/lib/sms';
import { sendEmail, adminAlertEmail } from '@/lib/email';
import { logLeadEvent } from '@/lib/leadEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ok = verifyTelnyxSignature({
    payload: raw,
    signatureB64: req.headers.get('telnyx-signature-ed25519') ?? '',
    timestamp: req.headers.get('telnyx-timestamp') ?? '',
    publicKeyB64: process.env.TELNYX_PUBLIC_KEY ?? '',
  });
  if (!ok) return new NextResponse('bad signature', { status: 401 });

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  const data = evt?.data ?? {};
  const type: string = data.event_type ?? '';
  const payload = data.payload ?? {};

  // Delivery receipts.
  if (type === 'message.finalized' || type === 'message.sent' || type === 'message.failed') {
    const id: string | undefined = payload.id;
    if (id) {
      const status = type === 'message.failed' ? 'failed' : (payload.to?.[0]?.status ?? 'delivered');
      await updateSmsStatusByTelnyxId(id, status);
    }
    return NextResponse.json({ ok: true });
  }

  if (type !== 'message.received') return NextResponse.json({ ok: true });

  const from: string = payload.from?.phone_number ?? '';
  const to: string = payload.to?.[0]?.phone_number ?? '';
  const text: string = payload.text ?? '';
  const providerId: string | undefined = payload.id;

  const fromE164 = toE164(from) ?? from;
  const [agent] = await db.select().from(agents).where(eq(agents.phone, fromE164)).limit(1);

  await logSmsMessage({
    direction: 'inbound', agentId: agent?.id ?? null, leadId: null, officeId: agent?.officeId ?? null,
    fromNumber: fromE164, toNumber: to, body: text, kind: 'inbound',
    telnyxMessageId: providerId ?? null, status: 'received', errorMessage: null,
  });

  if (!agent) { await forwardToOwner(from, text); return NextResponse.json({ ok: true }); }

  const cmd = parseCommand(text);

  if (cmd.kind === 'stop') {
    await db.update(agents).set({ smsOptOut: true, smsOptOutAt: new Date() }).where(eq(agents.id, agent.id));
    await sendAgentReply(agent, optOutAckText(), 'optout_ack');
    await notifyOwnerOptOut(agent);
    return NextResponse.json({ ok: true });
  }
  if (cmd.kind === 'start') {
    await db.update(agents).set({ smsOptOut: false, smsOptOutAt: null }).where(eq(agents.id, agent.id));
    await sendAgentReply(agent, 'You are re-subscribed to RE/MAX Platinum lead texts.', 'command_ack');
    return NextResponse.json({ ok: true });
  }
  if (cmd.kind === 'help') { await sendAgentReply(agent, helpText(), 'help'); return NextResponse.json({ ok: true }); }
  if (cmd.kind === 'unknown') { await forwardToOwner(from, text); return NextResponse.json({ ok: true }); }

  // accept / decline / status — resolve + authorize the lead code.
  const resolved = await resolveOffer(agent.id, cmd.code, cmd.kind);
  if (!resolved.ok) { await sendAgentReply(agent, resolved.message, 'command_ack'); return NextResponse.json({ ok: true }); }

  if (cmd.kind === 'accept') {
    const r = await applyAccept(resolved.offerId);
    await sendAgentReply(agent, r.ok ? `Accepted lead #${resolved.leadId}.` : 'That lead is no longer available.', 'command_ack');
  } else if (cmd.kind === 'decline') {
    const r = await applyDecline(resolved.offerId);
    await sendAgentReply(agent, r.ok ? `Declined lead #${resolved.leadId}. Reassigning.` : 'That lead is no longer available.', 'command_ack');
  } else if (cmd.kind === 'status') {
    await recordStatusUpdate(resolved.offerId, resolved.leadId, cmd.status, cmd.notes);
    await sendAgentReply(agent, `Updated lead #${resolved.leadId} → ${cmd.status.replace('_', ' ')}.`, 'command_ack');
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Implement the route helpers (same file)**

Implement:
- `sendAgentReply(agent, body, kind)` → `sendAgentSms({ agent, body, kind })`.
- `forwardToOwner(from, text)` → `sendEmail(adminAlertEmail(...))` (or a small inline compose to `MS_GRAPH_ADMIN_EMAIL`) with the sender number + text; log an `admin_forward` outbound row.
- `notifyOwnerOptOut(agent)` → email the owner that the agent opted out.
- `resolveOffer(agentId, code, kind)`: for accept/decline, find a `leadOffers` row for this agent that is still `offered` (matching `leadId=code` if provided; if `code` null and exactly one outstanding offer, use it; else `{ ok:false, message:'Reply with the lead number, e.g. YES 5739.' }`). For status, match an active (accepted, non-closed) lead for this agent by `code`; same single-candidate inference. Returns `{ ok, offerId, leadId, message }`.
- `recordStatusUpdate(offerId, leadId, status, notes)`: write a `status_updates` row (reuse the portal's status-update helper/path — same one `app/api/agent/status-update/route.ts` uses) and `logLeadEvent(leadId, 'status_updated', notes)`. Respect the `canMarkLost` gate for `status==='lost'`; if blocked, the caller replies with the reason.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build` → PASS. `npm run test` → PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add app/api/webhooks/telnyx/route.ts
git commit -m "feat(sms): inbound telnyx webhook — commands, DLR, opt-out, admin forward"
```

---

### Task 12: Env, config, and setup docs

**Files:**
- Modify: `lib/env.ts`, `.env.example`, `SETUP.md`

- [ ] **Step 1: Update `lib/env.ts`**

In `RECOMMENDED_GROUPS`, **remove** the three `TWILIO_*` entries and **add**:

```ts
  // Telnyx SMS — agent texting (design spec §9). Optional; email works without it.
  { label: 'TELNYX_API_KEY', anyOf: ['TELNYX_API_KEY'] },
  { label: 'TELNYX_PUBLIC_KEY', anyOf: ['TELNYX_PUBLIC_KEY'] },
```

- [ ] **Step 2: Update `.env.example`**

Replace the `--- Twilio SMS (optional) ---` block with:

```bash
# --- Telnyx SMS (agent texting) — optional; email still sends without it -------
# API key from the Telnyx portal (Auth → API Keys). Enables agent lead texts.
# TELNYX_API_KEY="KEY..."
# Public key for verifying inbound webhook signatures (Telnyx portal → your
# Messaging Profile / public key). Required for the inbound webhook to accept events.
# TELNYX_PUBLIC_KEY="base64-ed25519-public-key"
# Optional: pin a Messaging Profile for outbound sends.
# TELNYX_MESSAGING_PROFILE_ID="MP..."
# Optional fallback "from" number (E.164) when an agent's office has no number set.
# TELNYX_DEFAULT_FROM="+15551234567"
#
# Per-office sending numbers live in the DB (offices.telnyx_number), not here.
# Carrier registration (10DLC brand+campaign OR toll-free verification) is
# REQUIRED before messages deliver reliably — see SETUP.md.
```

- [ ] **Step 3: Update `SETUP.md`**

Add a "Telnyx agent texting" section documenting: provision 4 numbers (one per office); complete 10DLC or toll-free registration; set `TELNYX_API_KEY`/`TELNYX_PUBLIC_KEY` in Vercel + GitHub Actions; set each `offices.telnyx_number`; point the Telnyx messaging-profile inbound webhook at `https://<domain>/api/webhooks/telnyx`; confirm each agent's `phone` is correct. Remove the Twilio section.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/env.ts .env.example SETUP.md
git commit -m "docs(sms): telnyx env + setup, retire twilio"
```

---

### Task 13: Full verification + docs update

**Files:**
- Modify: `docs/current-state.md`, `docs/lessons-learned.md`

- [ ] **Step 1: Run the full gate**

Run: `npm run test && npm run typecheck && npm run build`
Expected: all PASS.

- [ ] **Step 2: Record the feature**

Add to `docs/current-state.md`: the Telnyx agent-texting feature (per-office numbers, two-way commands, opt-out, `sms_messages`, migration `0024`), and move SMS from "excluded/dormant" to "built (agent-facing, Telnyx)". Add a `docs/lessons-learned.md` section noting the multi-word-command parsing wrinkle and the code-only-session test boundary (live Telnyx = owner first-connection step).

- [ ] **Step 3: Commit**

```bash
git add docs/current-state.md docs/lessons-learned.md
git commit -m "docs: record telnyx agent-texting feature + lessons"
```

---

## Self-Review

**Spec coverage:**
- §3 decisions 1-10 → Tasks 2/3/5/6/8/9/10/11 (actions, matching, numbers, anchor, provider, client-info) + Task 12 (compliance env) + Task 11 (compliance handling). ✅
- §4 data model → Task 1. ✅
- §5 outbound (offer/client-info/reminder/acks) → Tasks 2, 8, 9, 10. ✅
- §6 inbound (webhook, identification, grammar, auth, DLR) → Tasks 3, 4, 11. ✅
- §7 minimal UI → no UI tasks (correct; reuses lead timeline). ✅
- §8 compliance → Task 11 (STOP/START/HELP) + Task 8 (opt-out gate). ✅
- §9 config/provider swap → Tasks 5, 12. ✅
- §10 testing → tests in Tasks 2-6, 8; full gate Task 13. ✅
- §12 owner setup → Task 12 (SETUP.md). ✅

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Tasks 9 and 11 reference moving existing verbatim logic (offer-route POST body, portal status-update helper) rather than reprinting code not yet read — call sites, signatures, and behavior are specified. ✅

**Type consistency:** `sendSms(to, body, {from})`, `sendAgentSms({agent, body, kind, leadId})`, `pickOfficeNumber({officeId, numbersByOfficeId, defaultNumber})`, `parseCommand → ParsedCommand`, `verifyTelnyxSignature({payload, signatureB64, timestamp, publicKeyB64})`, `applyAccept/applyDecline(offerId) → OfferActionResult`, `NewSmsMessage` fields match the Task 1 schema. Consistent across tasks. ✅
