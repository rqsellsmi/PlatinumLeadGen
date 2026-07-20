# Telnyx Agent Texting — Design Spec

**Date:** 2026-07-20
**Status:** Approved design — ready for implementation planning
**Branch:** `claude/texting-telnyx-requirements-ktc9fo`
**Author:** Requirement-gathering session (superpowers:brainstorming)

---

## 1. Summary

Add **two-way SMS between the platform and its agents**, powered by **Telnyx**, so
an agent can receive lead notifications and act on them entirely from their phone.

This is **Phase 1 — agent-facing only.** Homeowner-facing texting and automated
nurture/drip are explicitly **out of scope** (see §11). The design leaves a clean
seam for the future Local Services Ads (LSA) direction without building it now.

The current `lib/sms.ts` is a dormant Twilio stub (never activated) wired into two
outbound alerts. This work **replaces Twilio with Telnyx**, adds an **inbound path**
(a signature-verified webhook + command parser), adds a **per-office sending-number**
model, and **persists every message** for audit.

Email remains the source of truth for every notification. **SMS is always additive**
— if SMS is unconfigured, fails, or the agent has opted out, the corresponding email
still sends exactly as it does today.

---

## 2. Goals / Non-goals

### Goals
- Notify agents by text on: **new lead offer**, **manual assignment**, **update-due reminder**.
- Text the agent the **client's contact information** the moment they **accept** an
  offer or a lead is **manually assigned** to them.
- Let agents **reply by text** to: **accept/decline an offer**, **update a lead's
  status** (with free-text notes), and have any **unrecognized message forwarded to
  the owner**.
- Send/receive across **4 office-owned Telnyx numbers** (one per office), extensible.
- Persist all inbound/outbound messages and delivery status for audit.
- Honor `STOP`/`HELP`/`START` compliance.

### Non-goals (Phase 1)
- Homeowner-facing texting (LSA lead inbound, confirmation texts to sellers).
- Automated nurture / drip sequences.
- Availability on/off by text.
- Stale-lead-ladder and weekly-reminder texts (remain email-only crons for now).
- Any new agent- or admin-facing UI screen (see §7 — minimal UI).
- A provider-abstraction flag — Telnyx-only (Twilio was never live).

---

## 3. Key decisions (from requirement gathering)

| # | Decision |
|---|----------|
| 1 | **Scope:** agent-facing notifications **and** agent replies. No homeowner texting. |
| 2 | **Agent reply actions:** accept/decline offer · update lead status · free-form → owner email. (No availability toggle.) |
| 3 | **Lead matching:** short **code = lead id**. Outbound messages carry code + client name + address. Reply grammar `<command> <code> <notes…>`. Code inferred only when exactly one candidate; otherwise we ask for it. |
| 4 | **Numbers:** **4 Telnyx numbers, one per office**, extensible. Agent identified by their own cell (the inbound `from`). |
| 5 | **Number anchor:** outbound comes from the **agent's home-office** number (stable thread on the agent's phone). |
| 6 | **UI:** **minimal** — persist + audit via existing lead timeline; unrecognized texts emailed to owner. No new screens. |
| 7 | **Outbound triggers:** new offer · manual assignment · update-due reminder. |
| 8 | **Provider:** **Telnyx-only**; replace the Twilio stub, keep the `sendSms` interface. |
| 9 | **Compliance:** honor `STOP` (opt-out, keep email, notify owner), `START`, `HELP`. |
| 10 | **Client info:** texted to the agent on **accept** or **manual assignment** (not at offer time — no PII until they own the lead). |

---

## 4. Data model (migration `0023`)

Head is currently `0022_area_poi_cache`; this adds `0023`. Hand-authored idempotent
SQL, registered in `meta/_journal.json`. Apply in order.

### 4.1 `offices.telnyx_number` (new column)
- `telnyx_number varchar(20)` — the office's Telnyx sending number in E.164, nullable.
- Seeded now; admin-editable later. An office with no number falls back per §6.4.

### 4.2 `sms_messages` (new table) — mirrors `email_send_log`
| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `direction` | varchar(10) | `outbound` \| `inbound` |
| `agent_id` | int FK→agents | nullable (unknown sender) |
| `lead_id` | int FK→leads | nullable |
| `office_id` | int FK→offices | nullable (which office number) |
| `from_number` | varchar(20) | E.164 |
| `to_number` | varchar(20) | E.164 |
| `body` | text | message text |
| `kind` | varchar(30) | `offer` \| `lead_details` \| `update_reminder` \| `command_ack` \| `help` \| `optout_ack` \| `inbound` \| `admin_forward` |
| `telnyx_message_id` | varchar(100) | provider id, nullable |
| `status` | varchar(20) | `queued` \| `sent` \| `delivered` \| `failed` \| `received` |
| `error_message` | text | nullable |
| `created_at` | timestamp | default now |
| `updated_at` | timestamp | default now |

Indexes: `(agent_id)`, `(lead_id)`, `(telnyx_message_id)` for DLR lookups.

### 4.3 `agents.sms_opt_out` (new columns)
- `sms_opt_out boolean not null default false`
- `sms_opt_out_at timestamp` — nullable.

### 4.4 Status updates reuse existing tables
An SMS status change writes a **`status_updates`** row (already keyed to
`lead_offer_id`, `new_status`, note) **and** a `lead_events` entry — the same path the
portal uses. No parallel history table.

---

## 5. Outbound messages

All outbound texts are sent **from the agent's home-office `telnyx_number`** and
logged to `sms_messages`. The matching email still sends in every case.

### 5.1 Offer (revises existing alert) — `kind=offer`
Teaser, **no PII**:
> `RE/MAX Platinum: new lead #5739 in Brighton. Reply YES 5739 to accept or NO 5739 to pass. Expires 4:12pm.`

### 5.2 Client info — `kind=lead_details` *(new)*
Sent on **accept** or **manual assignment** — the agent now owns the lead:
> `Lead #5739: Jane Doe, (810) 555-0134, jane@example.com. Property: 123 Main St, Brighton. Est. $412k. Reply CONTACTED 5739 <notes> to log updates.`

Fields pulled from `leads`: `first_name`/`last_name`, `phone`, `email`,
`property_address`/`property_city`, `estimated_value`. Empty fields omitted.

### 5.3 Update-due reminder — `kind=update_reminder` *(new as SMS)*
Fired by the existing follow-up cron when `first_update_due`/`next_reminder_due`
elapses:
> `Lead #5739 — Jane Doe, 123 Main St needs a status update. Reply e.g. CONTACTED 5739 left a voicemail.`

### 5.4 Command acknowledgements — `kind=command_ack` / `help` / `optout_ack`
Short confirmations replying to an inbound command (see §6.3).

---

## 6. Inbound path

### 6.1 Webhook route
`POST /api/webhooks/telnyx` — `runtime=nodejs`, `dynamic=force-dynamic`.
Handles two Telnyx event types:
- **`message.received`** → parse & act (§6.2).
- **`message.sent` / `message.finalized` (DLR)** → update the matching
  `sms_messages.status` by `telnyx_message_id`.

**Security:** verify the Telnyx **Ed25519 signature** (`telnyx-signature-ed25519` +
`telnyx-timestamp` headers) against `TELNYX_PUBLIC_KEY`; reject on mismatch or a
timestamp outside a tolerance window. Rate-limit via the existing `lib/rateLimit`.

### 6.2 Agent identification
Match the inbound `from` (normalized E.164) against `agents.phone`.
- **Match** → proceed as that agent.
- **No match** → log as `inbound` with `agent_id=null` and **forward to the owner by
  email**. This is also where future LSA/homeowner inbound will land — the handler
  must not assume "sender is always an agent."

### 6.3 Command grammar — `<command> <lead-code> <notes…>`
Parsing lives in **`lib/smsCommands.ts`** (pure, unit-tested).

- **Accept:** `YES` / `ACCEPT` / `Y`
- **Decline:** `NO` / `DECLINE` / `PASS` / `N`
- **Status:** `CONTACTED`, `ATTEMPTED` (→ `attempted_contact`), `QUALIFIED`,
  `WORKING`, `CLOSED`, `LOST`, `REOPENED` — mapped to the real `lead_status` enum.
  `LOST` respects the existing `canMarkLost` gate; if not yet unlockable we reply
  explaining why.
- **Compliance:** `STOP`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT`, `START`/`UNSTOP`,
  `HELP`/`INFO` (§8).
- **Lead code** = the numeric lead id. If omitted:
  - accept/decline → infer if the agent has exactly **one outstanding offer**;
  - status → infer if the agent has exactly **one active lead**;
  - otherwise reply asking for the code.
- **Notes** = everything after the code; saved on the `status_updates` row. For
  accept/decline, notes are logged but don't change the action.
- **Authorization:** the code must resolve to a lead the agent was actually
  offered / owns, else reject and log. Accept on an expired/reassigned offer →
  `That lead is no longer available.`
- **Unrecognized command** → log `inbound` + **forward to owner by email**
  (`kind=admin_forward`).

Every recognized command sends a brief `command_ack` reply.

### 6.4 Shared accept/decline core
The accept/decline logic currently lives inside `POST /api/offer/[token]`. Extract
its core into a reusable function (e.g. `lib/autoOffer.ts` `acceptOffer()` /
`declineOffer()`) so **both** the web POST route and the SMS command path call the
**same** code — scoring, reassignment, `lead_events`, and the §5.2 client-info text
stay identical across channels. (Route keeps its bot-safe GET-confirm / POST-act
behavior.)

---

## 7. UI / surfacing (minimal)

No new screens in Phase 1.
- Accept/decline via SMS produces the same `lead_events` + score effects as the web
  path → already visible in the admin lead timeline and offer history.
- Status updates via SMS appear in the existing status history.
- Unrecognized / free-form texts are emailed to the owner (`MS_GRAPH_ADMIN_EMAIL`).
- `sms_messages` is queryable for a future admin thread view (deferred).

---

## 8. Compliance

- **`STOP`** (and synonyms): set `agents.sms_opt_out=true` + `sms_opt_out_at`, send a
  final `optout_ack`, **stop all future texts to that number**, keep sending the
  agent's email, and **notify the owner** so they can nudge the agent to re-opt-in.
- **`START`:** clear the opt-out.
- **`HELP`:** auto-reply describing the number and how to opt out.
- `sendSms` checks `sms_opt_out` before every send. Carriers also enforce `STOP` at
  the network level; our state mirrors theirs.
- **Carrier registration (owner setup task, not code):** the 4 numbers require
  **10DLC** (Brand + Campaign registration) or **Toll-Free verification** before
  reliable delivery — the same "first-connection setup" shape the Twilio creds had.
  Documented in `.env.example` / `SETUP.md`.

---

## 9. Config & provider swap

### 9.1 Environment
- **New:** `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` (webhook verification), optional
  `TELNYX_MESSAGING_PROFILE_ID`.
- **Retire:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`,
  `TWILIO_MESSAGING_SERVICE_SID` (remove from `.env.example` and `lib/env.ts`).
- Office numbers live in `offices.telnyx_number` (not env).

### 9.2 `lib/sms.ts` (Telnyx internals, same shape)
- Keep `toE164`, `smsConfigured`, `sendSms` — `sendSms(to, body, opts)` gains a
  `from` (office number) and metadata (`kind`, `leadId`, `agentId`, `officeId`) so it
  can log to `sms_messages`.
- POST to the Telnyx Messages API (`https://api.telnyx.com/v2/messages`) with a
  bearer token; no SDK dependency (mirrors the current fetch-based Twilio call).
- **Outbound number selection:** agent → `office_id` → `offices.telnyx_number`.
  If the office has no number, fall back to a default configured office number; if
  none exists, **no-op** and rely on email (logged).
- `smsConfigured()` is true only when `TELNYX_API_KEY` **and** ≥1 office number
  exist. No key → the whole feature no-ops, exactly like today.

### 9.3 Call-site changes
`lib/autoOffer.ts` (offer + assignment) and the follow-up cron switch to the new
`sendSms` signature and add the §5.2 client-info send on accept/assignment.

---

## 10. Testing

Follows the existing "unit-test the pure logic; live integration is the owner's
first-connection step" pattern (`routing`, `offerWindow`).

**Unit (vitest):**
- `lib/smsCommands.ts` parser: grammar, command synonyms, code inference (0/1/many
  candidates), notes extraction, `LOST` gate, opt-out keywords.
- `toE164` edge cases; agent-by-`from`-number resolution.
- Office-number selection (agent office → number → default → no-op).
- Telnyx **signature verification** against a known key/payload (valid + tampered).
- Opt-out gating in `sendSms` (opted-out agent → skipped, email path untouched).

**Not runnable in a code-only session** (no Telnyx creds / registered numbers): live
send/receive, DLR callbacks, real signature headers. Everything stays behind config
flags and degrades safely; live validation is the owner's first-connection step.

`npm run test` · `npm run typecheck` · `npm run build` must all pass.

---

## 11. Future (explicitly deferred)

- **LSA / homeowner inbound** on the office numbers — the per-office numbers +
  `sms_messages` store are built to accommodate it; the inbound handler already
  treats unknown senders as a first-class case.
- Homeowner speed-to-lead + confirmation texts.
- Automated nurture / drip sequences.
- Stale-ladder and weekly-reminder texts.
- Availability on/off by text.
- Admin/agent SMS thread-view UI.

---

## 12. Open items for the owner (setup, not code)

1. Provision **4 Telnyx numbers** (one per office) and complete **10DLC or Toll-Free**
   registration.
2. Set `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` in Vercel (+ GitHub Actions for cron).
3. Populate `offices.telnyx_number` for each office.
4. Point the Telnyx messaging profile webhook at `/api/webhooks/telnyx`.
5. Confirm each agent's `phone` is on file and correct (used for identification).
