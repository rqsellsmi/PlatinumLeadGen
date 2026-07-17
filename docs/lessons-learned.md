# Lessons Learned — AI Build Notes (for future sessions)

Written by the AI agent after auditing the original Manus system and implementing the v1.6 addendum in this repo. Read this before making changes so you don't relearn the hard parts.

---

## 0. RULE #1 — NEVER THEORIZE; CONFIRM BY READING THE CODE OR ASKING TO TEST

The single most important habit, learned the hard way debugging a "recent sale
missing from the homepage." Every step where progress was made came from a fact
(a SQL result, the actual source line, a screenshot); every step that wasted the
owner's time was a plausible-sounding theory offered as if it were the answer
("it's probably the NULLS-first ordering", "it's probably a buyer-side deal",
"it's probably a DB mismatch") — each one confidently reasoned, each one wrong,
and each one only disproven when the owner ran a query I should have asked for
first.

- **Before asserting a cause, ground it.** Read the exact function that runs (not
  your memory of it), or hand the owner a one-line query / a specific thing to
  click, and wait for the result. "Let me confirm" beats "it's probably."
- **A chain of eliminations is fine; a chain of *guesses* is not.** Narrow with
  tests, not with prose. If you catch yourself writing "this is likely…", stop
  and turn it into a query or a code read.
- **The owner's data outranks your model of the system.** When they say "we were
  the listing side and the DB shows it," believe it and go read why the code
  disagrees — don't re-explain why your theory says otherwise.
- **State confidence honestly.** If you haven't confirmed it, say "I don't know
  yet — run this and we'll know," not a definitive-sounding diagnosis.

Everything below is only trustworthy because it was confirmed against the code or
the running system. Keep it that way.

---

## 1. This repo's specific traps

- **Migrations are hand-authored SQL, not generated.** `drizzle-kit generate` prompts interactively (and can't in CI) because the snapshot chain is intentionally incomplete — `meta/_journal.json` lists `0002` but there is no `0002_snapshot.json`. Running generate will try to "rename/recreate" already-applied tables (e.g. `rate_limits`) and produce a destructive diff. **Always** write a new `NNNN_*.sql` with `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `ADD VALUE IF NOT EXISTS`, add a journal entry, and update `schema.ts` to match. Model it on `0002_v15_additions.sql` and `0003_v16_addendum.sql`.
- **`node_modules` is not present on a fresh clone.** Run `npm ci` first, then use the local `drizzle-kit` (via `npm run db:*`) — a bare `npx drizzle-kit` pulls a newer major version that behaves differently.
- **The lazy DB client is deliberate.** `lib/db.ts` defers connection so `next build` works without `DATABASE_URL`. Public data loaders (`lib/queries.ts`) swallow DB errors and render empty. So a successful `next build` with `[queries] … fetch failed` logs is *expected* offline — it is not a failure. Don't "fix" it by making queries throw.
- **`applyScore` reads-modifies-writes for the clamp.** It can no longer be a single `SET score = score + delta` SQL update (that can't clamp). It selects current score, clamps to [0,200], logs the *actually applied* delta, and writes the clamped value. Keep that shape or clamping/negation breaks.
- **`recommendAgents` is pure and unit-tested.** Don't make it hit the DB. DB orchestration (loading agents, reading/persisting `agent_queue`) lives in `lib/autoOffer.ts` and `lib/queue.ts`. The persisted rotation is passed in via the optional `rotationList` param.
- **`normalizeAddress()` returns an object, not a string.** Use `.full` as the dedup key (`lib/leadDedup.normalizedAddressKey`).
- **`@dnd-kit` / `recharts` are NOT dependencies here** even though the addendum assumed they were. Native HTML5 drag-and-drop and CSS bar charts avoided adding heavy deps. Check `package.json` before importing a library the spec "assumes."
- **`Badge` and `Input` accept `tone`/`className` but not arbitrary DOM props** (e.g. `title`). When unsure, don't pass extra props — typecheck will pass but you may rely on behavior that isn't wired.

## 2. When a spec and its corrections disagree, the corrections win — but read both

The addendum had Sections A–J and then Section K "corrections from source-code review that supersede conflicting instructions." Several places conflicted (valuation range, the 6-day warning column, transaction-id prefixes, tier boundaries, the reversal scope, the DB date function). The K version was always the one grounded in the real original code. **Lesson:** when a document carries later "corrections," treat earlier sections as intent and the corrections as the spec; grep the referenced original source to break ties. Example: E.5 invented a `stale6DayWarningSentAt` column; K.4 said reuse `staleWarningSentAt` with a compound filter — the latter matched the original and avoided a needless column.

## 3. Audit before building — and verify against files, not a prior report

The user explicitly said "check the actual files — don't assume based on the previous build report." That was right: a prior audit doc can drift from the code. Cheap, decisive signals first: `grep` for the feature's telltale identifier (`gtag`, `send_to`, `getLeadAttribution`, `agent_queue`, `data-upload`), `ls` the expected directory, read the schema. Those three moves classified every section as Built/Partial/Missing in minutes and were more trustworthy than prose.

## 4. Parallelize reading, serialize writing

The initial cross-repo inventory (two large codebases) was done with parallel read-only sub-agents, each writing a detailed file to scratchpad and returning a short inventory. That collapsed hours of reading into one pass. The implementation, by contrast, was sequential and phase-ordered because the phases shared files (schema → routes → UI) and later edits depended on earlier ones. Match concurrency to dependency: fan out for independent discovery, stay linear for interdependent edits.

## 5. Typecheck after every phase, not just at the end

Running `tsc --noEmit` after each phase caught mistakes while the context was fresh (unused imports, a renamed variable still referenced, an object-vs-string return). Cheap and fast; far better than a giant error dump at the end. Build + full test only at the finish.

## 6. Keep phases independently testable and commit once, cleanly

Section L defined an explicit phase order (schema → CSV → metrics → conversions → attribution → dedup → scoring → panel → queue → dashboards → legal → test). Following it meant each phase left the tree typechecking. A task list mirrored the phases so progress was legible. One well-structured commit at the end (with a message that maps changes to sections) beats many noisy ones for a review-heavy change like this.

## 7. Wire the whole path, not just the unit

Recurring failure mode to avoid: building `lib/googleAdsConversions.ts` but not calling it, or adding schema columns without writing them. Each feature here was traced end-to-end — schema column → Zod field → route write → UI read. For conversions specifically, the leadId had to be threaded from the API response through `sessionStorage` to the thank-you page so the appointment conversion could use `appointment-${leadId}`. A feature isn't done until the data flows through every layer.

## 8. Respect explicit "do not build" lists

The addendum listed deliberate exclusions (CRM, AI, SMS, S3, capacity caps) and one item pending an owner decision (MAX_LEADS gate). Leaving those alone — and surfacing the pending decision as a question at the end rather than guessing — is part of doing the job correctly. Over-building against an explicit exclusion is as wrong as under-building.

## 9. Match the codebase's existing idioms

New admin mutations used Server Actions + `requireAdmin()` (the established pattern); admin API routes used `auth()` guards; emails were added as new template functions in `lib/email.ts` with the same shell/signature; new tables mirrored existing column/index conventions. Reading three or four neighboring files before writing a new one made the additions indistinguishable from the original code and avoided inventing a second way to do something that already had one.

## 10. Practical guardrails that paid off

- Give the git clone a generous timeout (large shallow packs take minutes; the default kills `index-pack` mid-unpack).
- Use `SKIP_ENV_VALIDATION=1` for typecheck/build/generate so env gating doesn't block tooling.
- Add unit tests for the new *pure* logic (score deltas/tiers, CSV parsing, metric calcs) even when full E2E needs a DB you don't have — they lock in the exact numbers the spec cares about and run in a second.
- When the deliverable is a document/audit, write it to the repo and commit it; it's versioned context the next session (or the user) can rely on.

## 11. Reviews / routing-rework / Scoring-v2 session

- **A `NEXT_PUBLIC_` Google key can't do server-side Places/Geocoding.** Browser
  keys are HTTP-referrer-restricted; Google rejects them for server web-service
  calls with `REQUEST_DENIED: API keys with referer restrictions cannot be used
  with this API`. You need a *separate* unrestricted server key (`GOOGLE_MAPS_API_KEY`)
  with the **legacy** Places API + Geocoding enabled (new projects only get
  "Places API (New)"). The code already prefers `GOOGLE_MAPS_API_KEY` over the
  public one — just set it.
- **Never swallow third-party API errors silently.** The reviews fetch returned
  `[]` on any non-OK response and prod redacts thrown errors, so a
  key/permission failure was indistinguishable from "no reviews." Capturing the
  provider's `status` + `error_message` and surfacing it in the admin turned a
  multi-message guessing game into a one-look diagnosis. Do this for every
  external call whose failure a human has to act on.
- **Hand-applied migrations across multiple Neon branches are the #1 "it broke
  after deploy" cause.** Three traps hit this session: (1) it's easy to skip a
  middle migration (0012) while applying later ones (0013/0014); (2) any admin
  page that `select`s a whole row (`db.select({ agent: agents })` / `select(agents)`)
  fails if *any* schema column is missing from that DB, so a skipped migration
  breaks whole pages, not just one field; (3) Vercel auto-creates a *per-preview*
  Neon branch that never gets your migrations, and the `APP_DATABASE_URL` override
  only takes effect on a **redeploy**. Prefer `npm run db:migrate` (applies the
  whole journal in order) over pasting files, and apply the full chain on **every**
  branch.
- **"Only some pages error" is a strong signal.** It rules out env-var / DB-connection
  problems (those break everything) and points at a specific missing column on the
  table those pages read. Diagnose by querying `information_schema.columns` for the
  exact columns the failing page selects, not by re-reading code.
- **Percentile tiers need a tie-tolerant rank.** A cohort-relative "top 10%" tier
  with a naive inclusive rank puts a fully-tied cohort (which is exactly what you
  get right after a bootstrap migration sets everyone to the same score) all in the
  bottom tier. The midrank (`below + 0.5*equal`) lands ties mid-pack — the sane
  default.
- **A rolling-window sum decays for free if it's log-derived + seeded with a real
  row.** Instead of special decay code, rolling-365 = `sum(log delta where
  created_at >= now-365d)`; the migration inserts one baseline log row per agent so
  the value starts at the bootstrapped score and ages out naturally after the
  window. Recompute on write + nightly.
- **Match concurrency to the split.** Splitting one column into four tracks touched
  ~20 files; a parallel read-only survey agent inventoried every `score` read/write
  first, which made the redirect (routing→rolling, tier/profile→lifetime) mechanical
  and complete. Fan out for the inventory, serialize the edits.
- **When a blocking question tool errors, don't stall.** The `AskUserQuestion`
  call failed mid-build; the spec-recommended defaults (earn-up-from-1-slot,
  top-20 leaderboard) were the right call to proceed with, stated explicitly and
  flagged as reversible, rather than blocking the whole implementation.

## 12. IDX / Realcomp integration session

- **The spec's intro carried scope the numbered phases didn't.** The build
  phases described only the new `idx_listings` table + consumer features, but the
  intro paragraph also mandated moving the existing brokerage metrics off CSV
  onto the feed. Reading intent from the whole document (not just the numbered
  list) surfaced a real scope fork worth confirming with the owner — they chose
  "everything." Same lesson as §2: read the corrections/intent, not just the body.
- **The thank-you page WAS the "report page."** The owner asked for a "Full
  Valuation page" with the valuation + condition "like it is now"; that page
  already existed (`/thank-you`, gated by a valuation token, with the condition
  refiner + confidence). Enhancing it beat building a parallel `/report/[leadId]`.
  Grepping the existing reveal flow (`getRevealedValuation`, the `v` token) before
  designing avoided a duplicate page.
- **Two valuation forms had drifted.** `HeroValuation.tsx` was current (teaser
  token → reveal); `city/ValuationForm.tsx` still read a `estimatedValue` the API
  no longer returns (always fell to the fallback). When wiring a cross-cutting
  flow, grep *every* caller — the stale one silently no-ops.
- **Can't run the feed from a code-only session.** No creds in the sandbox, and
  the owner didn't want to paste them, so live `$metadata` validation had to be
  deferred to a script the owner runs (`idx:verify`) + defensive field mapping
  (coerce, don't assume) + the first GitHub Actions backfill as the real test.
  Centralize every "confirm against $metadata" unknown (enum quoting, `in()`
  quoting, MLS-number field) in one place so the fix is a one-liner, not a hunt.
- **Guard a recompute that can zero out live data.** `updateMetricsFromIdx()`
  writes the same `home_page_metrics`/`market_stats` the homepage reads; running
  it before the sold-backfill would blank the homepage. It early-returns when
  there are no office-closed listings, and the public readers fall back to
  `closings` — so the cutover is data-driven and reversible, not a hard switch.
- **Vercel Hobby caps crons at daily.** The hourly IDX sync runs from a GitHub
  Actions schedule pinging the endpoint (the pattern `cron.yml` already used),
  not a `vercel.json` hourly entry (which the plan would reject).
- **§18.10 is a display rule, not a storage rule.** The spec said "store only the
  primary photo"; the owner wanted all of them. Both are satisfiable: store the
  full Media set, but gate *display* — full gallery for Active, primary-only for
  Pending/Closed — in the card component.

### 12b. Live-connection debugging (the spec's identifiers were all slightly wrong)

Once the owner connected real credentials, almost every hardcoded identifier from
the spec was subtly off. The pattern: **the vendor's own docs/spec drift from the
live API — validate every value against `$metadata`/the service document, never
trust the spec sheet.**

- **A wrong-but-well-formed value fails *downstream*, not at validation.** The
  OAuth `audience` was `rapi.realcomp.com`; the correct value was
  `rcapi.realcomp.com` (one letter). The token endpoint accepted the request
  (audience field present → passed validation) and then **500'd with an empty
  body while minting the token**. Days-style debugging collapsed once we compared
  behaviors: bogus client → `200 {access_token:null}`, real client → `500`,
  missing-audience → clean `400`. That triad proved "endpoint healthy, request
  valid, this specific account/value errors" = upstream/config, not our code.
  **When a call fails, diff its behavior against deliberately-broken variants;
  the shape of *which* inputs 500 vs 400 vs 200 localizes the fault fast.**
- **`$metadata` lists fields; the service document (`/odata/`) lists queryable
  entity sets.** `$metadata` worked while `/Property` 404'd — the service doc
  confirmed `Property` was real and the base was right, redirecting us off a
  dead-end.
- **RESO field names have multiple variants — match the one your IDs use.** Office
  keys came as `*OfficeKey` (string), `*OfficeKeyNumeric` (Int64), and
  `*OfficeMlsId` (string). The spec said `*OfficeKey`; only `*OfficeKeyNumeric`
  and `*OfficeMlsId` existed; and the owner's `REALCOMP_OFFICE_KEYS` were actually
  **OfficeMlsId** values. Confirming by querying the `Office` collection and
  eyeballing which column the IDs matched was decisive (they matched neither
  KeyNumeric nor Key).
- **IIS returns a generic 404 HTML page when the URL/query exceeds ~2 KB.** Our
  sold query (big `$select` + a 4-field office `in()` clause with ~24 keys +
  `$expand`) blew past `maxQueryString`. A bare `?$top=1` worked, the full query
  404'd. Fix: **split one wide filter into several short requests** (one per
  office field) and union via the upsert key. Watch total URL length whenever a
  filter interpolates a user-sized list.
- **Realcomp location fields are county-suffixed enums.** `City` =
  `"SturgisCity_StJoseph"`, `PostalCity` = `"Sturgis_StJoseph"`, `CountyOrParish`
  = `"StJoseph"`. The clean mailing city is **`OriginalPostalCity`** ("Sturgis").
  Dump a few real records and pick the human-readable field rather than trusting
  the obvious-sounding one.

### 12c. The `$`-in-bcrypt-hash env trap (cost the most time, zero to do with IDX)

Local admin login failed for a long time with a *correct* 60-char hash in the
file. Root cause chain, each masking the next:
- **Next.js's env loader interpolates `$`.** `@next/env` runs dotenv-expand, so a
  bcrypt hash `$2a$12$…` in `.env`/`.env.local` gets `$2a`, `$12`, `$<salt>` eaten
  as variables, leaving a ~30-char fragment → `bcrypt.compare` always false.
  **Single quotes do NOT stop it in their version — escape each `$` as `\$`** (or
  the hash breaks). This only bites local `.env` files; Vercel injects env vars
  literally, so production used the unescaped hash fine — which is exactly why
  "works in prod, fails locally" was so confusing.
- **`set -a; source .env` pollutes the shell and everything launched from it.**
  The earlier curl-test pattern exported a bash-`$`-expanded (mangled) hash into
  the shell; `dotenv`/`@next/env` **do not override an already-set `process.env`
  var**, so both the `node` check and `npm run dev` inherited the broken value
  regardless of the file. Run throwaway `source .env` sessions in a *separate*
  terminal from the dev server, and single-quote values used there.
- **Stop guessing — log the ground truth.** A three-line temp `console.error` in
  `authorize()` (received vs expected username, `hashLen`, `hashStart`, bcrypt
  result) ended the guessing in one attempt: `hashLen=32 hashStart=".LAZ"`
  instantly showed the hash was being mangled on read, not mistyped. Add the
  diagnostic to the failing code path early instead of theorizing about env.

### 12d. A persisted OAuth token turns a transient misconfig into a permanent wedge

The GitHub Actions backfill kept 401'ing `Invalid Audience` **long after** the
audience/base-URL config was corrected. The cause wasn't the live config — it was
a **stale token cached in the shared `realcomp_tokens` table**. An early run (before
the empty-string env fell back to the right default) minted a token with a blank
audience and persisted it; `getValidRealcompToken` reuses any token expiring >5 min
out, so every later run — even with perfect env vars — replayed the poisoned token
and the data API rejected it. Lessons:
- **A cache that persists across runs will faithfully re-serve a bad value made
  during a misconfigured run.** Fixing the config fixes new *mints*, not the row
  already on disk. When "I fixed the config but it still fails," suspect persisted
  state before re-checking the config a fifth time.
- **Any credential cache needs an invalidation path on the auth error it can
  cause.** `realcompFetch`/`realcompFetchPages` now treat a `401` as "the cached
  token may be poisoned": drop it, force a fresh mint (`getValidRealcompToken(true)`),
  retry once. A transient bad token can no longer wedge the sync indefinitely — it
  self-heals on the next request instead of needing a manual `DELETE FROM
  realcomp_tokens`. Build the self-heal when you build the cache, not after it
  bites in production.
- **The `??` vs `||` distinction is load-bearing for empty-string secrets.** An
  unset GitHub Actions secret is passed to the process as `""`, not undefined, so
  `process.env.X ?? default` keeps the empty string while `process.env.X || default`
  falls back. Use `||` for any env var whose "unset" and "empty" should behave
  identically (which is almost all of them).

### 12e. Don't guess `varchar` widths for an external feed — use `text`

The `active` backfill fetched 50,000 listings, then the whole batch died on
`value too long for type character varying(100)` (Postgres 22001). A Realcomp
value — most likely `basement` (a multi-value enum serialized to a comma list) or
a county-suffixed city/area enum — exceeded the column's 100-char cap. Lessons:
- **Postgres reports the *type*, not the *column*.** The error says
  `varchar(100)` but `column: undefined`; with a dozen `varchar(100)` columns you
  can't tell which overflowed. Don't bisect — widen the whole overflow-prone class.
- **`text` vs `varchar(n)` is free in Postgres.** Identical storage and speed; the
  only difference is the length constraint. For columns fed by an external system
  whose max length you don't control, a bounded `varchar` buys nothing and can halt
  a 50k-row import on one outlier. Migration `0016` converts the descriptive/enum
  `idx_listings` columns to `text`. Reserve `varchar(n)` for values *you* generate
  or that have a real spec'd max (state code, postal code, status enum).
- **One bad row shouldn't kill the batch, but a schema that can't represent the
  data is the real bug** — fix the column type, not the row. `ALTER COLUMN … TYPE
  text` is idempotent (no-op if already text), so the fix is safe to re-run per
  Neon branch.

## 13. Listing/valuation fixes + IDX backfill hardening session

### 13a. The IDX backfill "one fix unmasks the next" chain
Getting the `active` backfill to complete took a sequence of fixes, each only
visible after the previous one let the run get further. The meta-lesson: **for a
long external-feed pull, expect a chain — instrument progress (row counts,
per-page logs) so each failure surfaces at a specific point, and fix forward.**
The chain: varchar(100) overflow at 50k (migration 0016 had to actually be
applied to the DB the job writes to; 0017 widened the URL columns) → OData enum
literal → token expiry at 56k → transient network timeout at ~1h40m → job
timeout at 2h → photo-fetch volume. None were visible until the one before was
fixed.

- **OData enum members are space-less tokens; a spaced literal fails at query
  validation, not silently.** `StandardStatus` is an `Edm.EnumType`, so the
  filter constant is the member NAME: `ActiveUnderContract`, not
  `'Active Under Contract'` (the feed returns `400 … 'Active Under Contract' is
  not a valid enumeration type constant`). Single-word statuses (`Active`,
  `Closed`) hid this because name == display. The feed also *returns* the
  space-less token, so it's what you store and compare against. Centralize the
  status list in ONE constant so the fix is a single edit (it was).
- **A one-shot retry latch does not survive a long paginated pull.** The 401
  self-heal used a boolean "retried once" flag for the WHOLE pagination loop; a
  backfill outlives the token TTL and hits 401 repeatedly, so the second expiry
  threw. Same shape for transient network errors. Fix: a per-URL retry COUNTER
  that **resets on every success**, so each fresh failure gets its own budget and
  only *consecutive* failures give up.
- **Undici has its own headers/body timeouts that kill a hung request with no
  retry.** `UND_ERR_HEADERS_TIMEOUT` ended a 1h40m run. Give each request an
  explicit `AbortController` timeout and treat the abort/network throw as
  retryable (backoff) — a slow page becomes a retry, not a dead run. Add 5xx/429/
  408 to the retryable set too.

### 13b. Making a long backfill resumable — bounded chunks beat an in-query cursor
First attempt: order by `ModificationTimestamp` ascending + checkpoint the max
timestamp per page, resume `>= checkpoint`. It was *correct* (ascending order
means no gaps below the checkpoint) but **`$orderby=ModificationTimestamp` forced
the RESO server to sort the entire result set before returning the first page**,
so every request ran past the abort timeout and the run died. **Lesson: a
server-side `$orderby` over a huge feed is a performance trap; don't rely on it.**
- **Prefer bounded windows over an ordered cursor for resume.** The working design
  splits the feed-wide pull into 12 **month windows**
  (`ModificationTimestamp ge monthStart and lt monthEnd`, no `$orderby`). Each
  window is a job; its completion is recorded in `idx_backfill_checkpoints`, and a
  re-run skips finished windows. Bounded range scans are fast and need no sort; a
  failed window is just re-fetched whole (idempotent upserts), which is cheap.
- **Resume must be scoped per job, not global.** `max(ModificationTimestamp)`
  across the whole table is wrong when multiple backfills write to it — a per-job
  key (month window / sold field-pass) avoids the cross-contamination.
- **A resilience feature must degrade to a no-op if its table isn't migrated.**
  The checkpoint write is best-effort (try/catch) so a not-yet-applied 0020 can't
  turn "resumable" into a brand-new failure mode.

### 13c. Storage-limiting ≠ fetch-limiting — but measure before "optimizing" the fetch
We had limited which listings' photo **galleries we WRITE** (Active + under-
contract only) and assumed that made the sync lean. It didn't — the sync still
**FETCHED** every photo of every listing (`$expand=Media`). Correct diagnosis:
*when a job is slow, measure whether the cost is in the fetch or the write.* But
the "obvious" fetch fix **backfired**: switching the feed-wide pass to
primary-only via nested `$expand=Media($orderby=Order;$top=1)` made it **~5×
SLOWER**, because Realcomp's server sorts+limits media *per listing* (a correlated
subquery) — far more expensive than a plain join that returns all media. The
full-media pull was actually ~24s/page; the `$top=1` pull was ~2min/page and
timed out. **Lesson: `$expand` with nested `$orderby`/`$top` is not free — profile
the actual per-page latency before adopting it; "fetch less" is not automatically
"faster."** Final design: fetch the **full** Media set (fast) and gate STORAGE by
status via `upsertRawListings(records, { galleries })` (galleries only for
Active/UC; primary photo for everyone via `photoUrl`). The feed is simply large,
so month-chunking + resume + a generous request timeout (300s) + retries is what
carries it to completion, not a cleverer photo query.

### 13d. Vercel Hobby crons + the "connectable-host 404" signal
- **Hobby caps a project at 2 cron jobs, daily-only; a `vercel.json` with more
  fails the deployment** — and a failed production deployment makes the WHOLE
  domain 404, which is exactly what the GitHub-Actions cron ping hit. Also,
  **Vercel Cron never sends a custom header**, so routes gated on
  `x-cron-secret` can't be triggered by `vercel.json` anyway — GitHub Actions is
  the real trigger. Removing the `vercel.json` crons fixed both.
- **A 404 from a host that connects (vs a 401, or a connection error) means "no
  app is served here," not "auth failed"** — wrong/stale `DEPLOY_URL` or a
  never-deployed project. The decisive test the sandbox couldn't run (the agent
  proxy blocks arbitrary egress; `ENOTFOUND`/`403 CONNECT tunnel failed` are proxy
  artifacts, not the target's response): **open the URL logged-out in a browser** —
  site loads (public, fine), a Vercel login wall (Deployment Protection), or a 404
  (no deployment). We reasoned it to a wrong `DEPLOY_URL`, and the owner pointed it
  at the real pre-launch `*.vercel.app`.

### 13e. Product/compliance details worth keeping
- **Don't set a key that opens a gate.** Copying the AVM estimate onto an unnamed
  partial lead is fine; setting `valuations.leadId` would have bypassed the
  pre-contact reveal gate. Copy the numbers, don't create the link.
- **Provider raw data is not user-facing — and prettify at RENDER, not in the
  cached parse.** ATTOM returns ALL-CAPS values and codes; title-casing them at
  display time (a small `pretty()` in the component) means the 30-day-cached
  `property_records` rows benefit immediately, with no re-fetch. Also: agents/
  admins do not want a raw-JSON dump — a formatted "About this home" is the
  deliverable.
- **"No em dashes" (or any hard output constraint on LLM copy) needs belt AND
  suspenders.** Instruct it in the prompt AND strip in code — models still emit
  them. Unit-test both the stripper and the deterministic fallback (which must
  also obey the rule).
- **An async React Server Component can be a JSX child.** Making `SiteFooter`
  `async` and letting it resolve its own context (the office to show) typechecks
  and works in Next 14 here — cleaner than threading an `office` prop through
  every page. Callers pass only lightweight context (`locationId`/coords) and the
  component defaults to Brighton when given none.
- **`$expand` nested options are a Realcomp-quirk risk to validate live.**
  `$expand=Media($orderby=Order;$top=1)` is standard RESO, but the pattern this
  build kept hitting is "the vendor's OData differs from the spec." It fails fast
  (a 400 on the first page, not a wasted hour) if unsupported, so it's cheap to
  try — but keep a fetch-a-few-and-pick-lowest-Order fallback in mind.

## 14. Texting & refinement session (round 1 — refinements)

- **"Auto-populate like the other ones" = wire the same behavior, don't invent a
  new one.** The exit-intent overlay had a plain address input while the hero and
  modal used Google Places autocomplete. The fix was to attach the *same*
  autocomplete, not build a different suggestion mechanism. When a user asks for
  parity with an existing surface, grep how that surface does it and reuse the
  exact pattern (here: the `attach()` Places-autocomplete closure and the
  `OPEN_VALUATION_EVENT` handoff, extended to carry lat/lng).
- **A shared modal that a second surface feeds needs its handoff widened, not
  forked.** The overlay hands off to `HeroValuation`'s modal via a `CustomEvent`.
  Rather than give the overlay its own valuation flow, the event `detail` grew
  `propertyLat/propertyLng` and the single consumer read them — one code path,
  two entry points.
- **The expand-the-feed path is clean *because* the upsert is column-derived.**
  `UPDATE_ON_CONFLICT` is built from `getTableColumns(idxListings)`, so adding a
  column to the schema + the `mapRealcompListing` return is all it takes — the
  upsert picks it up automatically. Adding ~35 fields touched three spots
  (schema, `SELECT_FIELDS`, the mapper) and needed no upsert changes. When you
  design a generic conflict-set once, later widenings are cheap.
- **Generalize the enum serializer the moment you need it twice.**
  `serializeWaterfrontFeatures` was one-off; the moment a dozen more enum
  multi-values (Heating, Appliances, InteriorFeatures…) needed the same
  camelCase→spaced comma-list treatment, promoting it to `serializeEnumList`
  (with de-dupe) and delegating the old name kept every call site consistent and
  the tests green.
- **Cache a paid per-coordinate lookup by a coarse GRID cell, and store each
  result's own coordinates.** Google Places Nearby Search is billed per request.
  Keying the cache by `lat/lng` rounded to 3 decimals (~110 m) lets every listing
  on the same block reuse one lookup (repeat views cost $0), and storing each
  POI's own lat/lng means the exact per-home distance is recomputed from any home
  in the cell — accurate *and* cheap. Reused the existing `haversine` from
  routing rather than adding a second distance function.
- **Feature-flag anything that spends money, and degrade to nothing.**
  `areaPoiEnabled()` is off without a key and honors `LISTING_AREA_POI=0`; the
  section renders map-only (free Embed API) or is omitted entirely on any
  failure. `Promise.allSettled` across categories means one failing category
  (or a partial 400) doesn't sink the whole area report.
- **A visual mockup is the intent, not every literal field.** The owner's sold-
  listing mockup showed HOA/taxes/fireplace/heating/laundry/water-sewer that the
  feed didn't carry yet. Reading it as "render this shape, and expand the feed to
  fill it" (with graceful omission until backfilled) beat either faking the
  fields or dropping them. The one deliberate deviation the owner asked for (the
  POI map) and the one they vetoed (schools *in that section*, while keeping the
  MLS School-district *fact*) were both honored precisely — confirm the scope
  forks, then match them exactly.
- **Still can't run the feed/Places from a code-only session** (no DB, no
  Realcomp/Places creds — same as §12). Everything is defensive (missing RESO
  fields → NULL → hidden; POI failures → null) and verified by typecheck + build
  + unit tests on the pure logic (`serializeEnumList`, `geoKey`, the
  schools-excluded category guard). Live validation of the new field names and
  Nearby Search is the owner's first-connection step.

## 15. "The DB row is perfect but the homepage won't show it" — recent-sales tiles

Debugging why a just-closed MLS sale wasn't appearing on the homepage even
though the hourly sync ran and the row looked correct in `idx_listings`.

- **A runtime-env read can silently switch the whole data source.** The homepage
  recent-sales tiles come from `getFeaturedRecentSales` → `idxOfficeRecentSales`
  (`lib/queries.ts`), whose FIRST line is `const keys = parseOfficeKeys(); if
  (keys.length === 0) return [];`. `parseOfficeKeys()` reads `REALCOMP_OFFICE_KEYS`
  from `process.env` **at request time**. If that var is set where the SYNC runs
  (GitHub Actions) but NOT in the APP runtime (Vercel), the sync happily
  populates the DB while the app's tile query short-circuits to `[]` and
  `getFeaturedRecentSales` silently falls back to the old CSV `closings` table.
  Symptom: a flawless `idx_listings` row that never shows on the homepage, and
  "recent sales" that are actually stale imports. **The same env var must be set
  in BOTH the sync environment and the app environment** — a DB that's correct
  proves the sync's env, not the app's. (Reinforces §11's cross-branch/env
  hygiene: where a value is read matters as much as whether it's set.)
- **Verify the exact filter/order before theorizing.** The tile query is only:
  `standard_status='Closed'` AND `photo_url IS NOT NULL` AND not-lease AND
  (`list_office_key` OR `co_list_office_key` ∈ keys), `ORDER BY close_date DESC
  LIMIT 6`. There is **no date window**, so "the close date is today" is NOT a
  cause — a today close sorts to the top. Grepping every `close_date` comparison
  showed they all live in the *market-stats* paths (`lib/idx.ts`,
  `lib/idxMetrics.ts`), not the tiles. Rule out a hypothesis by reading the
  actual predicate, not by pattern-matching the symptom to a plausible cause.
- **`ORDER BY col DESC` is NULLS FIRST in Postgres.** If office-closed rows have
  a `photo_url` but a `NULL close_date`, they sort ABOVE every dated sale and can
  fill all 6 tiles, hiding genuinely-recent sales. A date-adjacent cause that is
  NOT "today". (`desc(col)` in Drizzle emits plain `DESC`, i.e. NULLS FIRST — add
  `NULLS LAST` when nulls should sink.)
- **`photo_url` can be wiped on close.** Every sync upserts `photo_url` from the
  feed's expanded Media; a listing going Closed can return with empty Media, so
  `photo_url` is overwritten with NULL — and the tile query's `photo_url IS NOT
  NULL` then hides a sale that had a photo while Active. A hard NOT-NULL photo
  filter turns "no photo yet" into "invisible sale."
- **Build a zero-SQL discriminator into the UI when you can.** IDX sales render
  as a `<Link href="/listing/[key]">` (they have a `listingKey`); CSV closings
  render as a plain `<div>` (null key). So "are the homepage sold cards
  clickable?" instantly tells you whether the app is on the IDX path or the CSV
  fallback — no DB access needed. Cheap observable state that distinguishes two
  code paths is worth more than another query.
- **Don't hand someone runnable-looking code for the wrong console.** Quoting the
  TS snippet `const keys = parseOfficeKeys(); …` to *explain* the logic led the
  owner to paste it into the Neon SQL editor, which errored on `const`. When the
  person is working in a SQL console, give SQL; clearly label illustrative app
  code as code, not a command to run.

## 16. Hourly IDX sync 504 — the fix was moving where it runs, not how

The hourly sync failed for four *distinct* reasons in sequence; each fix unmasked
the next (same "one fix reveals the next" pattern as §13a). Worth recording the
whole chain because most of the wasted time was theorizing past the real cause.

- **The chain:** (1) `idx:verify` CI failed — `getValidRealcompToken` hit the DB
  for token caching, but the verify job has no `DATABASE_URL`; fixed by minting a
  token DB-free when no connection string is set. (2) verify then 400'd on
  `TaxYear` — Realcomp's live `$metadata` declares `TaxAnnualAmount` but **not**
  `TaxYear`; dropped it from `SELECT_FIELDS` (kept the column + response mapping).
  (3) The hourly sync 504'd; I added page-by-page upsert + a 45s budget +
  `$orderby=ModificationTimestamp` for gap-free resume — but `$orderby` is the
  exact server-side-sort timeout §2.8/§13b avoids, so it made the *first page*
  never return; removed it. (4) Still 504. The admin "Recent sync runs" table
  showed **every run frozen at `RUNNING`, no counts, no error** — the tell that
  the function is hard-killed before it can write ANY status.
- **The actual root cause:** the hourly workflow (`idx-sync.yml`) only `curl`ed
  the Vercel endpoint `/api/cron/idx-sync`. The sync ran **on Vercel**, hard-capped
  at `maxDuration=60`. A feed-wide delta with full Media does not fit in 60s, so
  Vercel returned 504 through the curl; the GitHub job showing the 504 was just
  the messenger. The initial backfill takes ~2h fine because it runs `npm run
  idx:sync` **on the runner** (350-min limit) — same code, somewhere it can run
  long. The owner's "the hourly sync is in GitHub Actions" was right about *where
  they saw it* and the correction is what surfaced the real fix.
- **The fix:** stop pinging the 60s function. Run the sync **on the runner** too
  (`scripts/idx-incremental-sync.ts`, `npm run idx:sync:incremental`, wired into
  `idx-sync.yml` with the DB + Realcomp secrets), passing `budgetMs: Infinity` so
  it drains the whole delta in one run. `runIdxSync` took an optional `budgetMs`
  (default 45s for the Vercel endpoint / admin "Run now", which stay 60s-bounded).
- **Lessons:**
  - **A GitHub Action that `curl`s your app is not "running in GitHub Actions."**
    A 504 in the Actions log can originate entirely from the pinged serverless
    function's timeout. Check what the step actually *executes* (a curl vs a node
    script) before reasoning about where the time goes.
  - **`status='running'` that never flips = hard kill.** Because the log row is
    only updated at the end (success/failed/partial), a platform timeout leaves it
    frozen with null counts. A row stuck `running` is positive evidence of a
    kill-at-the-wall, not an in-progress run — and told us the 60s cap, not any
    query error, was the wall.
  - **Match the runtime to the work.** A job that can exceed 60s does not belong
    behind a 60s serverless function on Hobby. The ping-Vercel indirection was a
    workaround for Hobby's daily-cron limit and silently inherited the 60s cap;
    running the compute on the runner (already done for the backfill) removes it.
  - **`$orderby` on a large RESO set is a timeout, every time** (now bitten in the
    backfill §13b *and* here). Don't add it to any query whose result set isn't
    already bounded small.
  - **Confirm before theorizing (Rule #1), and build the confirmation IN.** The
    diagnosis only landed once the admin "Recent sync runs" table exposed
    per-run status/counts. Cheap observable state beats another round of guessing.
  - **"Nothing logged after N seconds" locates the hang precisely.** Once on the
    runner, the job logged *nothing* for 1m39s. Since the script logs per page,
    that meant the FIRST Realcomp request hadn't returned — the hang is the
    request itself, not the DB or our loop. (`REQUEST_TIMEOUT_MS` is 5 min, so a
    single materialize-the-whole-result request can hang that long before it even
    aborts.)
  - **An open-ended `gt cursor` feed-wide delta doesn't scale; window it.** With
    the backfill days old, the cursor was days behind, so Query 2 asked Realcomp
    for *every displayable listing modified in days, with full Media*. Realcomp
    appears to materialize the whole filtered+expanded result before returning
    page 1, so the first page never came. Fix = the backfill's own pattern:
    **bounded time windows** (1-hour) with a checkpoint that advances only after a
    window fully drains — small result sets, fast first page, gap-free resume, no
    `$orderby`. The incremental sync should never issue an unbounded feed-wide
    query, even "since the cursor."
  - **THE ACTUAL ROOT CAUSE (found by a preflight probe, read from the runner
    logs via the GitHub API): a freshly-minted Realcomp token isn't valid on the
    data API for ~1-2s.** A preflight firing token → `Property?$top=1` (no media)
    → same with `$expand=Media` showed: token OK, **no-media 401 "Token failed
    validation" at +213ms**, **with-media 200 at +2.9s** — same token, so it's a
    ~1-2s propagation delay, and Media was never the problem. The fetch loop's
    401 handler *force-re-mints* (`getValidRealcompToken(true)`), and
    `mintRealcompToken` had **no timeout on its auth fetch** — so a stalled auth
    response (or a churn of un-propagated re-mints) hung the whole sync silently
    for minutes. Fix: (a) give the token mint its own 30s timeout so it can't hang
    forever; (b) `sleep(~3s)` after minting so the token propagates before first
    use, so the first request doesn't 401 and trigger the re-mint churn.
  - **The `Property?$top=1` two-request probe (with vs without the suspect param)
    is the tool that finally isolated it.** Two cheap, bounded requests logged to
    *stderr* (unbuffered → survive a kill), plus reading the archived job log via
    the GitHub API, turned "hangs silently for 10 min" into an exact HTTP status
    and latency per call. Note: the GitHub logs API 404s for in-progress jobs — it
    only serves the archived log after the step completes, so a diagnostic build
    that runs the probe and EXITS (skipping the hang) is what makes it readable.
  - **THE FINAL CAUSE: Realcomp INTERMITTENTLY hangs on the feed-wide request, and
    our per-request timeout was 5 minutes.** A probe firing the sync's EXACT query
    returned HTTP 200 in 1.2s (run #107); the identical query via `realcompFetchPages`
    the next run (#108) never returned a page in 90s. Same query, same token — so
    the request itself intermittently stalls on Realcomp's side. With
    `REQUEST_TIMEOUT_MS = 300_000`, one stalled request froze the whole run for 5
    minutes (and the sync fires dozens). Fix: thread a per-request `timeoutMs` into
    `realcompFetchPages`/`fetchWithTimeout` and have the incremental sync use a
    SHORT one (30s runner / 20s serverless) — a stalled request aborts fast and the
    existing net-retry loop re-issues it, and a retry usually succeeds. A 1-hour
    window's page is small, so a legitimate response lands well inside 30s. General
    rule: a shared "big" timeout tuned for a 6h backfill is a footgun for a
    short-lived job against a flaky upstream — make it per-call.
  - **Debugging method that worked (after several that didn't): bisect the code
    path with bounded probes, outermost-first.** token → minimal query → exact
    query → exact query + real upsert → the real fetch wrapper. Each probe ruled a
    layer in or out against the actual production endpoint/data, on the actual
    runner. Reading the *real* logs beats reasoning about what "should" happen.
  - **CONFIRMED intermittent by a reliability probe: it's Realcomp, not us.** A
    build that fired the exact feed-wide query 8× returned **8/8 HTTP 200** in
    0.4–4.4s. But 45 min earlier the identical query had aborted 4× in a row. The
    timeline (200 at 16:12 → hung 16:20–16:32 → 200×8 at 17:19) shows Realcomp's
    data API has **~20-minute degraded windows** where it stalls these queries,
    then recovers. No code change fixes their server; the design that survives it
    is already in place — a short (30s) per-request timeout so a stalled request
    aborts and retries, plus the per-window checkpoint so a run that dies inside a
    bad window resumes from where it stopped on the next hourly run. When a symptom
    is time-correlated and not code-correlated, stop editing code and measure the
    dependency's reliability directly.

### 16b. The REAL cause of the zero-record incremental sync: six un-`$select`able fields

  - **Symptom after all the timeout/paging fixes above: the sync still upserted 0
    records, every run, silently.** No 504, no error — HTTP 200 with an empty
    `value` array and a phantom `@odata.nextLink`. The cursor never moved, so
    ~3 days of solds/actives went missing.
  - **Decomposition proved it wasn't media, the time window, or paging.** A probe
    (`probeMediaDiagnostics`) fired the same filter with a 3-field `$select` vs the
    full ~90-field select: 3-field returned 5 rows (with or without `$expand=Media`,
    open or narrow window); the **full `$select` returned 0**. So the *field list*
    was the culprit, not any query mechanic.
  - **Bisection then per-field audit (`probeSelectFindAllBad`) pinned the exact
    fields.** Binary-searching the field list found the first offender
    (`ArchitecturalStyle` at prefix 56); testing every field individually against
    the anchors found all of them. **Six fields make Realcomp return 0 rows for ANY
    query that `$select`s them, even alone:** `ArchitecturalStyle`,
    `InteriorFeatures`, `Appliances`, `ParkingFeatures`, `LotFeatures`,
    `AssociationAmenities`. They are all in `$metadata` (they pass `idx:verify`), so
    metadata validation does NOT catch this — the feed accepts the field name but
    zeroes the result set instead of 400-ing (unlike `TaxYear`, which 400s).
  - **Why it hit incremental and not the backfill:** these six were added in the
    "buyer-relevant fields" expansion AFTER the initial backfill ran. The backfill's
    select never contained them; the incremental sync was the first job to use the
    fat select, so it was the first to silently zero out.
  - **Fix:** drop those six from `SELECT_FIELDS_ARR` (columns + mappings stay, so
    they light up automatically if Realcomp ever fixes the feed; populating them
    now would need a separate query that doesn't `$select` them alongside the rest).
    Also dropped `PhotosCount` (a transient audit timeout, and redundant with
    `$expand=Media`) — `photosCount` is now derived from the media array length.
  - **Method reminder (again): bisect against the live endpoint, don't theorize.**
    A metadata-valid field silently returning zero rows is not something you'd
    guess; an automated per-field probe against the real feed found all six in one
    ~3-minute run.
