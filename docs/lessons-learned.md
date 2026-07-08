# Lessons Learned — AI Build Notes (for future sessions)

Written by the AI agent after auditing the original Manus system and implementing the v1.6 addendum in this repo. Read this before making changes so you don't relearn the hard parts.

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
