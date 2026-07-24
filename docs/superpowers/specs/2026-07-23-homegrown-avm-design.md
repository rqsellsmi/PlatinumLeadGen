# Homegrown Comp-Based AVM — Design Notes

**Status:** 🟡 DISCUSSION — not approved, not built. This captures the
conversation so we can resume cold. Nothing here is committed to.
**Date:** 2026-07-23
**Owner prompt that started it:** ATTOM (our current valuation provider) returns
"wildly inaccurate numbers for our area, particularly lake homes." Could we pull
the subject home's *facts* from something cheaper and compute the *valuation*
ourselves from the MLS data we already have — more accurately for these homes,
and possibly cheaper?
**Foundation already shipped:** the sold-comps ranker
(`lib/idx.ts` `similarityScore` / `rankSoldComps` / `getRecentSoldComps`) — see
`docs/current-state.md` §4.6b. That's the comp engine this design builds on.

---

## 1. The problem

National AVMs (ATTOM, and to a lesser degree RentCast) are trained on public
records and broad comp pools. They are systematically weak exactly where SE
Michigan value lives:

- **Waterfront** — an enormous, non-linear premium that public records barely
  encode (they rarely flag frontage feet, lake name, or lake type).
- **Non-standard structures & land** — pole barns, equestrian facilities,
  acreage, outbuildings — value drivers that public records miss but the **MLS
  captures** (in structured fields, remarks, and photos).
- **Condition** — a renovated vs. dated vs. as-is home can differ 30%+, and
  public-record AVMs are blind to it.

The through-line: **the homes national AVMs are worst at are the homes a local
MLS-based model is best at**, because we hold the signals they lack. The owner's
key insight is that this is *not* a lake problem — it's a "non-standard value
driver" problem, and lakes are just the most obvious case.

Secondary motivation: **cost.** ATTOM is billed per lead and is the more
expensive provider; RentCast is cheaper and returns both an AVM number
(`/avm/value`) and a property record (`/properties`). A homegrown comp valuation
has ~$0 marginal cost per lead.

## 2. Goals / non-goals

**Goals**
- A comparable-sales (CMA-style) valuation computed from our own `idx_listings`
  data, that beats the provider AVM *for our market's non-standard homes*.
- Decouple **subject facts** (cheap provider / MLS history / seller) from the
  **valuation number** (ours).
- Honest, data-derived **confidence & range** — wider for unusual homes, not
  false precision.
- Prove accuracy with a **backtest against real sold prices** before trusting it.

**Non-goals (for now)**
- Beating national AVMs on *ordinary* tract homes — they're fine there; we only
  need to win where they fail and match where they don't.
- A fully-automatic model with zero human input — the agent refines every number
  anyway (human-in-the-loop is a feature, not a gap).
- Replacing the provider entirely on day one — provider stays as a thin-market /
  low-confidence fallback.

## 3. The model (comparable-sales / CMA)

The same method a human appraiser or agent uses:

1. **Select comps** — recent, nearby, *similar* closed sales (the
   `rankSoldComps` engine, extended with the value-driver logic below).
2. **Line-item adjust each comp** to the subject — appraiser-style grid: for each
   difference (extra garage bay, no pool, finished basement, 200 fewer sqft,
   dated kitchen) add/subtract a dollar amount to the comp's sale price so it
   represents "what this comp would have sold for *as the subject*."
3. **Reconcile** the adjusted comp values into one indicated value (weighted by
   similarity + how little adjustment each needed).
4. **Range & confidence** from the dispersion of the adjusted comps and how much
   adjustment was required.

The hard part is **step 2 (adjustments)** — that's where every AVM earns or loses
its accuracy. §6–§7 are about doing it well for *our* value drivers.

## 4. Architecture: cheap facts + our number

Today a single env var, `VALUATION_PROVIDER` (`rentcast` | `attom`, currently
**attom**), controls *both* the valuation number (`lib/valuation.ts`) **and** the
property-record source (`lib/propertyRecords.ts`). RentCast serves both endpoints
and is cheaper.

Two moves:

- **Zero-code experiment (do this first, independently):** flip
  `VALUATION_PROVIDER=rentcast` in Vercel. Cheaper immediately, and RentCast's own
  model may already be better on our lakes. Reversible; a real data point.
- **The build:** provider (RentCast, or cheapest) supplies the **subject's
  facts**; our comp engine supplies the **number**. The facts pull is already
  cached 30 days in `property_records`, so it doesn't re-bill on repeat views.

## 5. The crux: where do the *subject's* facts come from?

Comps tell us what similar homes sold for; they don't tell us the *subject's* own
sqft/beds/lot/waterfront. And the subject's non-standard drivers (is it on the
water? does it have a pole barn?) are exactly what public-record facts miss — so
even a perfect comp model needs the subject characterized. Sources, best first:

1. **MLS history match** — if the subject address was ever listed, it's in our
   `idx_listings` with true `waterfrontYN`, `waterFrontageFeet`, outbuildings in
   remarks, etc. Free and authoritative. **Highest-leverage source.**
2. **Seller intake** — extend the condition refiner: "On the water? Pole barn?
   Acreage? Recently renovated?" Cheap, high-signal, and it engages the lead.
3. **Provider property record** — RentCast/ATTOM `/properties` for beds/baths/
   sqft/year/lot (but blind to the non-standard drivers).
4. **Geospatial** — detect lake adjacency from coordinates as a fallback flag.

> Reality: the subject-facts dependency never fully disappears; the design lowers
> its cost (cheap provider + cache) and improves it (MLS history + seller), but
> "characterize the subject" is a permanent input, not a solved problem.

## 6. Value-driver catalog

The heart of this doc — every driver, where we'd get it, and how it should enter
the model. **Data-source key:** `S` = structured `idx_listings` field we store ·
`S*` = structured field that exists in schema but is **currently NULL** due to the
Realcomp `$select` bug (lessons §16b — must fix the separate-query workaround
before it's usable) · `R` = `publicRemarks` (NLP) · `P` = listing photos (vision)
· `PR` = public-record/provider · `SI` = seller intake · `GEO` = geospatial.
**Role key:** `FILTER` = comps should share it (never mix) · `ADJ` = priced
line-item adjustment · `SIGNAL` = soft rank term (already in `similarityScore`).

### 6.1 Water (the big one)
| Driver | Source | Role | Notes |
|---|---|---|---|
| Waterfront vs not | `S` `waterfrontYN` | **FILTER** | Never comp on-water against off-water. The single biggest lever. |
| Which lake / body | `S` `waterBodyName` | FILTER/ADJ | Lake identity carries most of the premium; prefer same-lake comps. |
| Frontage feet | `S` `waterFrontageFeet` | ADJ | We *have* this. Price often scales with frontage; non-linear. |
| Water type & quality | `S` `waterfrontFeatures` + `R` | ADJ/FILTER | All-sports vs no-wake vs private; lake vs river vs canal/channel vs pond; chain-of-lakes. Huge variance. |
| Water *access* (no frontage) | `R`, `S*` `associationAmenities` | ADJ | Deeded access, shared frontage, association beach/boat launch — a premium, but a fraction of true frontage. |
| Water *view* only | `S` `view` | ADJ | View without frontage. |
| Waterfront orientation / depth | `R`, `P` | ADJ | West/sunset-facing premium; swimmable vs weedy/shallow; sandy bottom. MI-specific buyer concerns. |
| Boathouse / permanent dock / hoist / covered slip | `R`, `P` | ADJ | Lake-adjacent structures. |

### 6.2 Outbuildings & structures
| Driver | Source | Role | Notes |
|---|---|---|---|
| Pole barn / "Michigan barn" | `R`, `P`, `S` `exteriorFeatures` | ADJ | Very common rural-MI value driver. Heated + concrete + power ("shop/man-cave") is worth far more than a bare shell — needs NLP nuance, not a boolean. |
| Equestrian facilities | `R`, `P` | ADJ/FILTER | Barn, stalls, riding arena, paddocks, pasture fencing, tack room. Niche but large premium; horse buyers are a distinct comp set (lean FILTER). |
| Detached / extra / oversized garage | `S` `garageSpaces`, `S*` `parkingFeatures`, `R` | ADJ | Bay count and heated/finished matter. |
| Workshop / heated shop | `R`, `P` | ADJ | |
| Guest house / in-law suite / ADU / carriage house | `R` | ADJ | Second dwelling → big value, and can change financing/comp class. |
| Greenhouse, kennel, chicken coop, sugar shack | `R`, `P` | ADJ | Niche; usually small. |

### 6.3 Land & lot
| Driver | Source | Role | Notes |
|---|---|---|---|
| Acreage / lot size | `S` `lotSizeAcres`, `S` `lotSizeDimensions` | ADJ/FILTER | Non-linear: first acre worth most; big acreage adds little per-acre *unless* splittable. Bucket it (don't comp a 40-ac farm with a 0.2-ac subdivision lot). |
| Splittable / dividable / multi-parcel | `R`, `S` `zoning` | ADJ | Development potential → large premium. |
| Zoning (res / ag / commercial / mixed) | `S` `zoning` | FILTER | Ag or commercial-zoned changes the buyer & value basis. |
| Tillable / farmland / CRP / income land | `R`, `S` `zoning` | ADJ | Income-producing acreage. |
| Lot character (wooded, private, cul-de-sac, corner, busy road) | `S*` `lotFeatures`, `R` | ADJ | Busy road = discount; private/wooded = premium. |
| Seasonal / private road / road association | `R` | ADJ | Affects financing *and* value in up-north/lake areas. |
| Mineral / oil / gas rights | `R` | ADJ | Rare but real in parts of MI. |

### 6.4 Pool & outdoor living
| Driver | Source | Role | Notes |
|---|---|---|---|
| In-ground pool | `S` `poolPrivateYN`, `S` `poolFeatures` | ADJ | Premium — but note the cold-climate nuance (sometimes neutral/slightly negative to some buyers). Let the *local data* set the sign. |
| Deck / patio / porch / screened / 3-season room | `S` `patioAndPorchFeatures`, `S` `exteriorFeatures` | ADJ | |
| Hot tub / spa, outdoor kitchen, fire pit, pergola | `R`, `P` | ADJ | Small-to-moderate. |
| Fencing | `R`, `P` | ADJ | Matters for horse/dog buyers. |

### 6.5 Condition & quality (the second-biggest lever after location)
| Driver | Source | Role | Notes |
|---|---|---|---|
| Overall condition (renovated ↔ dated ↔ as-is/fixer) | **`P` (vision)** + `R` | ADJ | The #1 thing AVMs miss. Vision on comp photos → a condition score to normalize each comp; NLP catches "newly renovated," "needs TLC," "as-is." |
| Recent big-ticket updates (kitchen, bath, roof, HVAC, windows) | `R` | ADJ | |
| Finished / walkout / daylight basement | `S` `basement` + `R` | ADJ | Walkout on a lake lot is a major MI premium. Above-grade vs below-grade sqft handled separately. |
| Luxury finishes (granite, hardwood, high-end appliances) | `S*` `appliances`, `R`, `P` | ADJ | |
| Deferred maintenance | `P` + `R` | ADJ | Negative adjustment. |
| System age (roof/furnace/AC/well/septic age) | `R` | ADJ | |

### 6.6 Structure & layout
| Driver | Source | Role | Notes |
|---|---|---|---|
| Living area (sqft) | `S` `livingArea` | SIGNAL/ADJ | Already used; the base of $/sqft. |
| Above- vs below-grade sqft | `S` `livingArea` + `S` `basement` | ADJ | Below-grade sqft is worth less per foot. |
| First-floor primary suite | `S*` `interiorFeatures`, `R` | ADJ | Premium for aging-in-place buyers. |
| Style (ranch vs 2-story vs …) | `S*` `architecturalStyle`, `S` `levels`, `S` `storiesTotal` | SIGNAL | Preference varies by market/segment. |
| Beds / baths (incl. half-baths) | `S` `bedsTotal`, `S` `bathsTotal` | SIGNAL/ADJ | Already used. |
| Fireplaces | `S` `fireplacesTotal`, `S` `fireplaceFeatures` | ADJ | |

### 6.7 Location micro-factors (beyond city)
| Driver | Source | Role | Notes |
|---|---|---|---|
| School district | `S` `schoolDistrict` | FILTER/ADJ | Large, well-documented premium; often worth a soft filter. |
| Subdivision / neighborhood | `S` `subdivisionName` | SIGNAL | Prestige subdivisions; within-sub water vs non-water. |
| Township vs city | `S` `township` | ADJ | Taxes & services differ. |
| Gated / golf-course / lake community | `S*` `associationAmenities`, `R` | ADJ | |
| Proximity to town / highway / lake | `GEO` | ADJ | |

### 6.8 Carrying costs & financial
| Driver | Source | Role | Notes |
|---|---|---|---|
| HOA fee & what it includes | `S` `associationFee`, `associationFeeFrequency`, `associationFeeIncludes` | ADJ | High HOA = value drag. |
| Property taxes | `S` `taxAnnualAmount` | ADJ | **MI uncapping**: taxable value resets on sale — a real buyer concern worth surfacing. |
| Special assessments | `R` | ADJ | |

### 6.9 Systems & energy
| Driver | Source | Role | Notes |
|---|---|---|---|
| Well vs municipal / septic vs sewer | `S` `waterSource`, `S` `sewer` | ADJ | Rural consideration. |
| Heat type (gas / propane / electric / geothermal) | `S` `heating` | ADJ | Propane (rural) = higher carrying cost. |
| Central air | `S` `cooling` | ADJ | |
| Whole-house generator, solar, high-efficiency | `R` | ADJ | |

### 6.10 New construction / builder
| Driver | Source | Role | Notes |
|---|---|---|---|
| New construction | `S` `newConstructionYN` | ADJ/FILTER | Premium; different buyer. |
| Custom vs spec / builder reputation | `R` | ADJ | |

### 6.11 Comp-*quality* signals (not subject features — they tell us how much to trust a comp)
| Signal | Source | Use |
|---|---|---|
| Sale-to-list ratio, price cuts | `S` `closePrice` / `originalListPrice` / `listPrice` | Detect over/under-pricing; weight comp reliability; read market direction. |
| Days on market | `S` `daysOnMarket`, `cumulativeDaysOnMarket` | Fast sale = strong price; long DOM = soft. |
| Seasonality | `S` `closeDate` | Lake homes sell higher spring/summer; adjust a winter comp. |
| Distressed / non-arm's-length (foreclosure, REO, short sale, estate, as-is) | `R`, `S` `mlsStatus` | **Down-weight or exclude** — not market value. |
| Seller concessions | `R` | Inflates apparent price; discount if detected. |

## 7. Filter vs. adjustment — methodology

Three tiers, applied in order:

1. **Hard filters (comp must share):** waterfront on/off, property family, zoning
   class, distressed-exclusion, and coarse acreage bucket. These define the comp
   *set*; getting them wrong is unrecoverable downstream.
2. **Priced line-item adjustments:** everything marked `ADJ` — a dollar delta per
   difference. The open question is **where the dollar amounts come from:**
   - **Agent-set coefficients** — the owner/agents *know* their market ("+$40k for
     a heated pole barn on acreage," "+$25k finished walkout"). Fast, explainable,
     good v1. Store as an editable table.
   - **Regression / paired-sales on our sold data** — we have the sales; a hedonic
     regression can estimate each driver's marginal $ (and validate the
     agent-set numbers). Needs enough volume per driver.
   - **Hybrid (recommended):** ship agent-set coefficients, refine with regression
     as data accrues; show agents where the data disagrees with their gut.
3. **Soft ranking signals:** the continuous `similarityScore` terms already in
   place (distance, city, beds/baths/sqft/type/year/price).

## 8. Where AI fits (cached, so cost doesn't scale with leads)

- **Vision on comp photos** → a condition/quality score (0–100), and tags for
  visible drivers (pole barn, pool, dated kitchen, waterfront) that aren't in
  clean fields. This is how modern AVMs (Zillow, HouseCanary) handle condition.
- **NLP on `publicRemarks`** → structured tags: pole barn (+heated/concrete),
  equestrian, renovation recency, walkout, distressed, concessions, splittable.
- **Cost model:** analyze each *comp* **once** and cache the result on the row
  (comps are reused across many leads), so AI is amortized over the market, not
  paid per lead — the structural win vs. per-lead provider AVM calls. We already
  have `ANTHROPIC_API_KEY` (used for market narratives).

## 9. Confidence & range

Derive honestly from the data, replacing the current fixed ±8%:
- **Comp dispersion** — spread (IQR/σ) of the *adjusted* comp values.
- **Comp count & proximity** — few/far comps → wider.
- **Adjustment magnitude** — if comps needed heavy adjustment to match the
  subject, confidence drops (the subject is unusual → say so with a wider range).
- **Segment prior** — lake/acreage/barn homes carry inherently wider ranges;
  that's correct, not a failure. Wider-but-grounded beats narrow-but-wrong.

## 10. Thin-market / fallback

Comp models need comps. Rural/unusual subjects may have too few recent nearby
sales. Fallbacks, in order: widen the radius → widen the time window → relax the
soft filters → **fall back to the provider AVM** and flag low confidence. Never
show a confident number built on 1–2 comps.

## 11. Validation — the thing that makes this decidable

We own **ground truth**: every closed sale is a home whose real price we know.

- **Backtest harness (the decisive first artifact):** for each recently-sold
  home, hold it out, value it from the *other* comps with our model, and compute
  error `= (predicted − actual) / actual`. Report **median |error| %**, and
  within-10% / within-20% hit rates, **segmented** by lake vs. non-lake, acreage
  tier, has-outbuilding, price tier, and city. Run ATTOM/RentCast through the same
  homes for a head-to-head. This turns "is ours more accurate for lake homes?"
  into a number, per segment, *before* we show a seller anything. (Runs against
  the owner's DB — no external creds needed for the comp model itself.)
- **Shadow mode:** once backtest looks good, compute our number alongside the
  provider on live leads, log both, and reconcile against the eventual sale when
  it closes. Promote to primary only per-segment where it wins.

This is the Rule-#1 discipline: don't ship a valuation we haven't validated
against ground truth.

## 12. Cost

- **RentCast facts < ATTOM** per call (confirm current pricing at build time),
  and `property_records` caches 30 days → no re-bill on repeat views.
- **Comp math ≈ $0** marginal per lead.
- **AI vision/NLP** cached per comp → amortized across the market, not per lead.
- Net: cheaper than the status quo *and* the cost stops scaling linearly with
  lead volume. The remaining cost lever is the subject-facts pull (§5).

## 13. Compliance / legal

- **Realcomp permission** — publishing market *stats* is clearly fine (we already
  do); a per-address *derived valuation* from IDX data is a grayer area — verify
  with Realcomp before it goes live (same first-connection pattern as the rest of
  the feed).
- **Disclaimer** — we already show "computer-generated estimate, not a formal
  appraisal" on every value surface; a homegrown number raises the stakes on
  accuracy, and the agent refines it (human-in-loop safety net).
- **Display gates** — don't surface MLS-only fields that aren't IDX-displayable;
  sold-comp display is already gated (entire-listing + address).

## 14. Data gaps & dependencies

- ⚠️ **Six driver fields are currently NULL** — `architecturalStyle`,
  `interiorFeatures`, `appliances`, `parkingFeatures`, `lotFeatures`,
  `associationAmenities` are dropped from the incremental `$select` because
  Realcomp zeroes any query that selects them (lessons §16b). Several `ADJ`
  drivers above depend on them (first-floor primary, lot character, luxury
  finishes, gated community, style). **Either** fix the separate-query workaround
  **or** lean on `R`/`P` (remarks/photos) for those until it's fixed. Flag this
  before scoping any driver that reads them.
- **Geocoding coverage** — proximity/geo drivers need subject + comp coordinates.
- **Photo availability** — vision needs comp photos; note the "photo wiped on
  close" gotcha (lessons §15) can leave sold comps photo-less.
- **Subject facts** — the permanent input (§5).

## 15. Phased rollout

- **Phase 0 — DONE:** attribute + proximity sold-comp ranking (`rankSoldComps`).
- **Phase 1:** backtest harness; measure a baseline comp/$-per-sqft model vs.
  providers, segmented. **Go/no-go gate.** (Also: flip `VALUATION_PROVIDER=rentcast`
  as a free parallel experiment.)
- **Phase 2:** structured-field adjustments (waterfront filter; garage/pool/
  basement/acreage/fireplace/frontage adjustments) with agent-set coefficients;
  re-backtest.
- **Phase 3:** AI condition (vision) + remarks NLP tags (pole barn, reno,
  distressed, walkout, splittable), cached per comp; re-backtest.
- **Phase 4:** shadow mode in production vs. provider on live leads.
- **Phase 5:** promote to primary per-segment where confidence holds; provider
  becomes the thin-market fallback.

## 16. Open questions / decisions to make

1. **Subject facts source** — RentCast `/properties`, seller intake, MLS-history
   match, or all three? (Leaning: MLS-history-match first, seller intake second,
   provider third.)
2. **Adjustment coefficients** — agent-set, regression, or hybrid? (Leaning
   hybrid.)
3. **v1 driver set** — which drivers make Phase 2 vs. later? (Leaning: water +
   garage + basement + acreage + pool + condition-via-vision.)
4. **Hard-filter list** — exactly what must a comp share? (Candidate: waterfront
   on/off, property family, distressed-exclusion.)
5. **Show sellers our number immediately, or agent-only first** while we build
   confidence?
6. **Fix the six NULL fields first?** (Needed for several drivers.)
7. **Does Realcomp permit a per-address derived valuation?** (Verify.)

## 17. Appendix — relevant code & data

- **Comp engine:** `lib/idx.ts` — `similarityScore` (now reads
  `closePrice ?? listPrice`), `rankSoldComps` (pure, unit-tested),
  `getRecentSoldComps`, `ComparableSubject`. Tests: `tests/idx.test.ts`.
- **Valuation dispatch:** `lib/valuation.ts` (`VALUATION_PROVIDER`),
  `lib/propertyRecords.ts` (facts + 30-day cache in `property_records`),
  `lib/rentcast.ts` (`/avm/value` + `/properties`), `lib/attom.ts`.
- **Consumer:** `app/thank-you/page.tsx` + `components/idx/FullValuationIdxSections.tsx`.
- **Data:** `idx_listings` (~90 cols; field inventory in `drizzle/schema.ts`),
  `idx_listing_photos` (vision source), `property_records`.
- **Related follow-up:** the sold-comps **map** (parked on cost/compliance) —
  `docs/current-state.md` §9.

---

# 18. Active plan — 2026-07-24 (branch `feature/custom-avm`)

This continuation supersedes the phased rollout in §15 for **what we build
first**. It captures the owner conversation that turned the abstract "backtest
harness" into a concrete, inspectable tool. **Design only — no code yet.** A
phased build plan follows *after* owner sign-off on this section.

## 18.1 What we build first: a glass-box AVM inspector

Not a headless batch harness that prints median-error stats — a **single-address
admin page that shows its work**, so the owner (the domain expert) can judge and
correct the *reasoning*, not just trust an aggregate number. Enter an address →
see the subject's facts and where they came from, the comps chosen (and rejected)
with plain-English reasons, an appraiser-style line-item adjustment grid, the
reconciled custom value, the provider AVM beside it, and — for a home that has
sold — the **actual sale price as ground truth**. Every run is saved to a
re-runnable scoreboard so the custom column can be tuned toward the actual column
over successive engine changes.

This deliberately merges §15's Phases 1–3 (backtest + structured adjustments + AI
condition) behind one inspectable UI, driven by real sold prices. The batch
"median error % by segment" view becomes a later *button on the same engine*, once
individual-home reasoning is trusted. **Admin-only; never seller-facing at this
stage** (resolves §16 Q5).

## 18.2 The hold-one-out test methodology (the core discipline)

Grading against real sales is the only thing that proves accuracy — but it has to
simulate production honestly:

- **The most-recent sale is held out COMPLETELY.** It is the graded answer and
  nothing else: not a comp, and **not used to characterize the subject.** (Its
  listing may carry post-sale facts — "renovated 2024," a new pole barn — that we
  would not have known *before* that sale, so using it would leak recency the live
  tool never has.)
- **The subject is characterized from the 2nd-most-recent sale.** In production
  the freshest data about a not-yet-sold home predates the value we're predicting;
  the backtest matches that. Subject-facts cascade (also the production cascade,
  resolving §16 Q1):
  1. **2nd-most-recent sale in our DB** (MLS-history match — free, authoritative).
  2. **None in DB → query the MLS on demand** for a prior sale of that address,
     persist it to `idx_listings`, then use it. (A lightweight, targeted way to
     deepen history exactly where a test needs it — no mass backfill required.)
  3. **No prior sale at all → the provider API** (RentCast `/properties`, then
     ATTOM) for the subject's facts.
- **The comp pool excludes the held-out sale** (else the home's own sale sneaks in
  as a perfect comp and the tool cheats).
- **Output per run:** `Actual $ · ATTOM $ · Custom $`, with error % for each.
  Persisted and re-runnable so tuning is visible over time.

## 18.3 Subject facts & provenance (top of the page)

Show the facts being valued and *where each came from*, since characterization is
the crux (§5). MLS-history match is labeled with its source listing + date; a
provider fallback is labeled as such (and flagged lower-confidence, because the
provider is blind to the non-standard drivers). Non-standard drivers
(waterfront/frontage/outbuildings/basement type) show their individual source so a
wrong fact is traceable.

## 18.4 Comp selection — transparent, with reasons

Reuse `rankSoldComps` + `similarityScore`, add the §7 hard filters (waterfront
on/off first). Render **both** the comps used (each with a plain-English "why
chosen" — same lake, closest size, recent) **and** the notable rejects (each with
a "why not" — off-water, too far, distressed). The held-out sale is visibly marked
as excluded.

## 18.5 The adjustment grid — structured-first, AI for the gaps

Appraiser-style: one dollar line per difference between each comp and the subject,
netting each comp's sale price to "what it would have sold for *as the subject*."

- **The AI proposes the dollar adjustments, grounded in the structured IDX data**
  for both homes ($/sqft, frontage feet, acreage, garage count, basement enum,
  close price, DOM) — it reasons from the data, not from a vacuum. Pure AI
  judgment is reserved for what the data genuinely can't give — chiefly
  **condition read from the listing photos**, the capability the owner most wants
  to watch, surfaced verbatim ("dated kitchen, original baths — photos 4–6") so it
  can be judged and overridden.
- **Observation vs. price are separated.** The AI's *observation* of a comp
  (condition score + driver tags from photos/remarks) is computed **once per comp
  and cached** on the row (see §18.7); the *dollar adjustment* is the per-comparison
  step. Keeping them apart makes corrections precise: agree the comp has a finished
  walkout, still disagree on the dollars.
- **Owner corrections are the calibration.** Early AI dollar figures will be the
  roughest part (an LLM isn't grounded in *this* market yet); the hold-one-out
  scoreboard exposes when they're off, and logged corrections become the signal a
  later regression (§7) learns from. Ground truth stays in charge (Rule #1).

## 18.6 v1 driver set + the "prefer MLS over AI" field audit

Owner's top movers first, and **prefer a structured MLS field wherever one exists
— only reach for AI where the MLS truly lacks it:**

| Driver | Structured MLS source | AI only for |
|---|---|---|
| Lake frontage (ft) + waterfront filter | `waterFrontageFeet`, `waterfrontYN` — have | frontage quality (sandy/weedy, orientation) |
| Lake type / identity | `waterfrontFeatures` (all-sports/no-wake), `waterBodyName` — have | remarks nuance |
| Acreage | `lotSizeAcres` — have | splittable / usable vs wooded |
| Basement: finished / walkout / egress | RESO `Basement` enum ("Finished/Walk-Out Access/Egress Window(s)") — **likely already in our `basement` text field, just unparsed** | — |
| Garage | `garageSpaces`, `attachedGarageYN` — have | heated / finished |
| Pole barn / outbuildings | RESO `OtherStructures` — **structured but not pulled yet** | confirm/size from photos |
| Condition | (`PropertyCondition` exists but unreliable) | **AI photos + remarks — the real AI job** |

**Task before/with the build — audit Realcomp `$metadata`** for `OtherStructures`,
`PropertyCondition`, the `Basement`/`WaterfrontFeatures` enum value coverage, and
garage features; add the missing structured fields and *parse the enum values we
already store*. **Heed lessons §16b:** six fields (`ArchitecturalStyle`,
`InteriorFeatures`, `Appliances`, `ParkingFeatures`, `LotFeatures`,
`AssociationAmenities`) silently zero any `$select` that includes them — test any
newly-added field the same way before wiring it into the incremental sync.

## 18.7 AI cost model

Analyze each comp's photos + remarks **once**, cache the observation (condition
score + driver tags) on the listing row; every later test and eventual production
valuation reuses it, so AI cost amortizes across the market rather than scaling per
lead (§8, §12). `ANTHROPIC_API_KEY` is already present.

## 18.8 The scoreboard (persistence)

A small table of test runs — address, run timestamp, actual sale price + date, the
held-out `listingKey`, the facts source used, ATTOM value, custom value, error %s,
the engine/coefficient version, and free-text notes. Re-running an address appends
a new row (or supersedes), so improvement is legible across engine changes. Schema
TBD in the build plan; not built yet.

## 18.9 Resolved decisions (updates §16)

1. **Subject facts:** MLS-history match (prior sale) → on-demand MLS pull →
   provider. ✔
2. **Adjustment $:** AI-proposed, **grounded in structured IDX data**,
   owner-corrected; regression later. ✔
3. **v1 drivers:** frontage, lake type/identity, acreage, basement
   (finished/walkout/egress), garage, pole barn/outbuildings, condition. ✔
4. **Hard filters:** waterfront on/off, property family, distressed-exclusion,
   coarse acreage bucket (from §7). ✔
5. **Seller-facing?** No — admin-only inspector first. ✔
6. **Fix the six NULL fields / expand fields?** Folded into the §18.6 field audit.
7. **Realcomp permission for a per-address derived value:** still a pre-launch
   verify (§13); internal backtest use needs no permission.
8. **Local-preference quizzes (the Q3 idea):** deferred until the backtest proves
   the core out; "lake type" is where it will eventually plug in (§6.1).

## 18.10 Out of scope this session

No code. This section is the design. The phased build plan (migrations for the
scoreboard table + any new IDX fields, the inspector page, the adjustment engine,
the AI comp-analysis cache, unit tests) comes after owner sign-off.
