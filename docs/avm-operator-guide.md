# Homegrown AVM — Operator Guide

Two working guides for the backtest tool (`/admin/avm-backtest`):
1. **Tuning the adjustment coefficients** against the scoreboard.
2. **Running the local LLMs** for condition/photo + remarks analysis (planned —
   what to expect before we build it).

Design context: `docs/superpowers/specs/2026-07-23-homegrown-avm-design.md` §18/§19.
Everything below is admin-internal; nothing is seller-facing until Realcomp says yes.

---

## 1. Tuning the adjustment coefficients

**Where they live:** `DEFAULT_COEFFICIENTS` in `lib/avm/engine.ts` — one editable
table. They're placeholders today; the scoreboard is how you calibrate them.
**The loop:** run known sold homes → read the error + the adjustment grid → change
ONE coefficient → redeploy → re-run the same homes → compare on the scoreboard.

### What to look at on each run
- **Signed error, not just size.** "Custom vs actual" as **+/−%** tells you if
  we're systematically HIGH or LOW. A pattern (e.g. lake homes always low) is a
  coefficient problem; random scatter is usually a comp-pool problem.
- **The adjustment grid.** Are the line items sane? A **+$120k frontage** line that
  leaves the comp way above the sale means `perFrontageFoot` is too high. Eyeball
  each big line against your gut — that's the whole point of the glass box.
- **Total adjustment per comp.** If comps needed heavy adjusting to match the
  subject, either the coefficient is off OR the comp pool is weak (too few close,
  unusual subject). Check the comps before blaming the coefficient.
- **Is one comp dominating?** The reconciliation weights by similarity + how little
  adjustment a comp needed + status. If a single comp drives the number, look at it.
- **Confidence.** Low confidence = thin/dispersed/heavily-adjusted comps — a data
  problem, not necessarily a coefficient problem.

### How to actually calibrate a number
- **Isolate one driver.** Find homes that differ from their comps mostly on ONE
  thing (subject has a pole barn, comps don't). The leftover error ≈ that
  coefficient's miscalibration.
- **Paired sales (the appraiser method).** Two near-identical nearby homes, one
  with the feature and one without — the price gap ≈ the feature's real value. This
  is the strongest signal for setting a coefficient, better than gut.
- **Direction:** systematically OVER-valuing homes with feature X → lower coeff X;
  under-valuing → raise it.
- **Watch non-linearity.** v1 coefficients are linear, but frontage (first feet
  worth most), acreage (first acre worth most), and $/sqft (varies by price tier
  and lake vs non-lake) are NOT. Where linearity clearly breaks, note it — the next
  step is bucketing or per-segment coefficients, not a bigger flat number.

### Metrics worth tracking (the scoreboard gives you the raw rows)
- **Median |error %|** overall and by **segment**: lake vs non-lake, acreage tier,
  price tier, city. Segment matters more than the overall number.
- **Bias** (mean *signed* error) — are we tilted high or low overall?
- **Within-10% / within-20% hit rate.**
- **Custom vs provider, per segment.** The goal isn't to beat ATTOM/RentCast
  everywhere — it's to beat them **where they fail (lake/acreage/condition)** and
  match them elsewhere.

### Pitfalls
- **Don't overfit to one house.** Tune on the aggregate; use the individual grid to
  understand *why*, not to chase a single home to zero error.
- **A big miss is often the comp pool, not a coefficient** — too few, too far, or
  the wrong status mix. Check the comps list first.
- **Expect large early errors.** The coefficients are guesses right now. That's the
  starting point, not a failure.
- **Market drift ≠ coefficient error.** Non-closed comps reflect *today's* market;
  grading a 10-month-old sale against today's actives will show drift. Read that
  separately from coefficient miscalibration (the run notes flag how many comps are
  active/pending).

### The concrete weekly loop
1. Pick 10–20 homes you know cold, spread across segments (some lake, some tract,
   some acreage, a couple of renovated/dated pairs).
2. Run each; jot the signed error and any obviously-wrong adjustment lines.
3. Find the **biggest systematic bias** (e.g. "lake homes run 15% low → frontage /
   lake premium too low").
4. Change **one** coefficient in `lib/avm/engine.ts`, redeploy, re-run the same
   homes.
5. Compare on the scoreboard (each run is a dated row — re-runs stack so you get a
   before/after). Repeat.

*Future:* an admin UI to edit coefficients without a deploy, per-segment tables,
and a regression pass on our own sold data to set them from the numbers (spec §7).

---

## 2. Running the local LLMs (planned — what to expect)

**Not built yet.** This is the roadmap so you know the shape, cost, and payoff
before we commit. Two AI jobs, both **cached per comp** (analyze a listing once,
reuse across every valuation), so cost is amortized across the market, never
per-lead:

- **Vision on comp photos** → a **condition/quality score (0–100)** + visible-driver
  tags (pole barn, pool, waterfront, dated vs renovated kitchen).
- **NLP on `publicRemarks`** → structured tags the clean fields miss: heated/
  concrete pole barn, finished walkout, recent renovation, distressed/as-is,
  splittable lot.

**Why local (not Anthropic's API):** compliance. Sending comp photos/remarks to a
third party trips Agreement §7.5/§7.6/§7.7. A model **you host** keeps the data in
your controlled environment — like a query in your own database. This is the whole
reason it's a separate build.

### What you'd need
- **A GPU host you control** — NOT a managed "model API" (that's a third party
  again). Either:
  - your own workstation/server with a 24GB GPU (RTX 3090/4090), run batches on it; or
  - a cloud GPU VM you fully administer + firewall (still "your environment").
- **Models** (open-weight):
  - Vision: Qwen2.5-VL 7B, Llama 3.2-Vision 11B, or InternVL.
  - Text: Llama 3.1 8B / Qwen2.5 7B.
- **A server**: Ollama (easiest) or vLLM (faster batch) — both expose a local
  OpenAI-compatible endpoint on your host.

### The build, step by step
1. **Stand up the host**, install Ollama/vLLM, pull one vision + one text model.
2. **Lock it down** — private network/firewall so only the app reaches it, no
   public exposure. This is what satisfies "data stays in our controlled system."
3. **Schema** — cache columns on `idx_listings` (or a sidecar table):
   `ai_condition_score`, `ai_tags` (JSON), `ai_analyzed_at`, `ai_model_version`.
4. **Batch job** (runs on/near the GPU host, not GitHub Actions — no GPU there):
   for each comp missing analysis at the current model version, send its photo(s) +
   remarks with a structured prompt → parse JSON → store. Skip already-analyzed
   comps (cache-once); re-run only new/changed listings incrementally.
5. **Wire into the engine** — a new adjustment source: `ai_condition_score`
   normalizes each comp toward the subject's condition; `ai_tags` fills drivers the
   structured fields lack (pole barn). Plugs into the existing coefficient/driver
   seam in `lib/avm/engine.ts`.

### What to realistically expect
- **Quality:** open vision models are solid at *coarse* condition (renovated /
  updated / dated / as-is) and obvious features (pool, waterfront, barn, dated
  kitchen). A notch below Claude/GPT-4o, but caching + your human-in-loop review
  covers the gap.
- **Throughput:** batch, not real-time. A 7–11B model does a few images/sec on a
  4090; the first full pass over the active comp universe is hours, then it's
  incremental and cheap.
- **Cost:** one-time GPU setup + power/VM hours. **No per-lead API cost** — the
  structural win over a paid provider AVM.
- **Effort:** this is the **biggest lift** in the whole AVM — infra + batch pipeline
  + prompt design + validation. Treat it as its own phase.
- **Photo caveat:** we store only the **primary photo for sold/pending** listings
  (§18.10) but the **full gallery for Active/UC** — so condition-from-photos is
  richer on active/under-contract comps than on closed ones. (Fetching more sold
  photos for internal-only analysis is a §18.10 display-vs-use nuance to confirm.)
- **Validation first:** run the backtest **with vs without** the AI layer and
  compare median error by segment. Keep it only where it measurably helps (shadow
  discipline, spec §11).

### Expected impact
Condition is the **#1 thing provider AVMs miss** (spec §6.5). For your spread of
renovated / dated / lake homes, this is probably the **single biggest accuracy
lever after** getting the comp pool tight and frontage right — but also the most
work and the least certain, so we validate before trusting it.
