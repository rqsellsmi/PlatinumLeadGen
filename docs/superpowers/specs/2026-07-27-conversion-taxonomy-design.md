# Conversion Taxonomy — Seller Now, Buyer Later — Design Reference

**Date:** 2026-07-27
**Status:** Adopted (seller side built); buyer side is a documented future track
**Branch:** `feature/google-ads-tracking` (off `refinements-v1`)
**Builds on:** `docs/superpowers/specs/2026-07-24-google-ads-lead-stage-tracking-design.md`
(the outbox + Data Manager worker) — this doc adds the **website/acquisition**
conversions and the long-term taxonomy the owner and Claude worked through.

---

## 1. Two layers, one dimension

Conversions fall into **two layers**, cut by **one dimension** (buyer vs seller):

- **Website / acquisition** — the visitor did something on the site (submitted a
  valuation, downloaded a guide, requested an appointment). Fired server-side the
  moment the lead/appointment is captured.
- **Pipeline / outcome** — the lead progressed in the CRM (Nurturing → Signed →
  Closed). Fired server-side from the status flow (the 2026-07-24 build).

The buyer/seller dimension rides on the **existing `leads.intent`** column
(`seller`/`buyer`/`unknown`, migration 0026) — no new axis needed. The site is
seller-only today (`intent` defaults `seller`); the buyer column below is built
when the buyer surfaces exist.

| Layer | Seller (built) | Buyer (future) |
|---|---|---|
| **Website / acquisition** | Seller Valuation · Guide Download · Appointment Requested | Buyer Registration · Guide Download · Showing Scheduled · (Saved search/favorite = soft) |
| **Pipeline / outcome** | Valid Seller Lead *(Nurturing)* · Listing Signed · Closed Listing | Valid Buyer Lead · Buyer Under Contract · Closed Buyer Deal |

---

## 2. Decisions locked (2026-07-27, with the owner)

| # | Decision |
|---|---|
| T1 | **Hero and Valuation are the same form.** Both submit `leadType='valuation'`; the old `pageVariant` (`seo`/`ads`) split was a *placement* distinction, not a form one. One **Seller Valuation** conversion covers both. |
| T2 | **SEO vs PPC is an attribution property, not a page.** The `/ads/[slug]` pages are being retired (PPC points straight at `/sell/[slug]`), so paid-vs-organic is read from the lead's **`gclid`/`gbraid`/`wbraid` + `utm_*`**, not `pageVariant`. For Google Ads this needs no separate action (Ads only credits clicks it can match via gclid); paid-vs-organic reporting lives in the CRM/GA4. |
| T3 | **Track by lead type / intent, not by placement or individual asset.** Seller Valuation vs Seller Guide is the meaningful (intent) split; hero-vs-city and guide-A-vs-guide-B are finer cuts left to segmentation/CRM. |
| T4 | **Guide identity is captured** (`leads.guide_id`, migration 0032) so per-guide reporting is possible later, even though **all** downloads fire one "Guide Download" conversion. Multiple guides do **not** get separate Google actions by default. |
| T5 | **Appointment** is one conversion for now (seller). It can split into Seller Appointment / Buyer Showing (or become intent-valued) when the buyer track lands. |
| T6 | **No conversion values yet** (consistent with the 2026-07-24 omit-values decision). The value hierarchy (Closed ≫ Signed ≫ Appointment ≫ Valid Lead ≫ Valuation ≫ Download; seller > buyer) is documented and added when value-based bidding is turned on. |
| T7 | **One primary bidding goal at a time.** Start with Seller Valuation primary (the current signal); shift to **Valid Seller Lead** once its imports are proven. Everything else stays **Secondary** (observation) so bidding isn't fragmented. |
| T8 | **Parallel migration, not rip-and-replace.** The server-side acquisition conversions run alongside the existing client-side ones; validate, then retire the client-side ones and re-point bidding. Never abruptly delete a working conversion (it feeds Smart Bidding history). |
| T9 | **One config map is the source of truth.** `(intent, event, guide) → conversion action` lives in code (`lib/googleAdsConfig.ts` + `lib/googleAdsOutbox.ts`), so a new surface is a config line + one Google action, not a rebuild. |

---

## 3. The seller conversion set (built)

| Conversion | Trigger (code) | Google category | Env var |
|---|---|---|---|
| Seller Valuation | lead created, `leadType='valuation'` (`enqueueGoogleAdsAcquisition`) | Submit lead form | `GOOGLE_ADS_ACTION_ID_SELLER_VALUATION` |
| Guide Download | lead created, `leadType='seller_guide'` (+ future buyer guides) | Submit lead form | `GOOGLE_ADS_ACTION_ID_GUIDE_DOWNLOAD` |
| Appointment Requested | appointment row created w/ `leadId` (`enqueueGoogleAdsAppointment`) | Book appointment | `GOOGLE_ADS_ACTION_ID_APPOINTMENT` |
| Valid Seller Lead | first Nurturing (`enqueueGoogleAdsConversion`) | Qualified lead | `GOOGLE_ADS_ACTION_ID_VALID_SELLER_LEAD` |
| Listing Agreement Signed | first Signed | Converted lead | `GOOGLE_ADS_ACTION_ID_LISTING_SIGNED` |
| Closed Seller Listing | first Closed | Converted lead | `GOOGLE_ADS_ACTION_ID_CLOSED` |

All flow through the **same outbox + worker** (2026-07-24 build), all deduped
once per `(lead_id, milestone)` by the outbox unique index, all no-op until
`GOOGLE_ADS_CUSTOMER_ID` + `GOOGLE_ADS_SA_KEY` are set. Acquisition events set
`eventSource=WEB`.

**Dedup nuances:**
- A returning visitor who re-submits an existing lead does **not** re-fire an
  acquisition conversion (the submit route returns early on a duplicate before the
  enqueue; the unique index is the backstop).
- Someone who downloads several guides = one `guide_download` conversion (once per
  lead); the first guide's id is stored on the lead. Per-guide analytics come from
  the CRM, not multiple Google conversions.

---

## 4. The buyer track (future — not built)

When buyer surfaces exist (account creation, saved homes/searches, contact-agent,
schedule-showing, buyer guides), add the buyer column keyed off `intent='buyer'`:

- **Website:** Buyer Registration and Showing Scheduled are buyer-specific;
  buyer **guide downloads flow into the shared generic `Guide Download` action**
  (audience-agnostic — the buyer/seller split lives in `leads.intent` + the CRM,
  not a separate Google action). Saved-search / saved-favorite are **soft/secondary**
  engagement signals.
- **Pipeline:** Valid Buyer Lead, Buyer Under Contract, Closed Buyer Deal — a
  parallel to the seller pipeline once a Buyer Track status flow is designed
  (current-state §4.3 notes the Buyer Track is a future, separate design).
- **Economics:** seller > buyer at each equivalent stage (T6) — reflected in
  values when value-based bidding is enabled, and/or by keeping seller and buyer
  actions separate so they can be bid/valued independently.

Adding a buyer conversion = one entry in the config map + one Google action.
`acquisitionMilestoneFor` / `milestoneFor` grow buyer branches; the outbox,
worker, hashing, and auth are unchanged.

---

## 5. What lives where (reporting)

- **Google Ads:** which campaigns/forms drive conversions and at what cost; bid on
  the aggregate (one primary), observe the rest (secondary).
- **CRM / GA4:** the deeper questions Google Ads can't answer — **paid vs organic**
  (by gclid/utm), **which guide converts best** (by `guide_id`), and **which
  originating form actually closes** (origin + pipeline outcome, which only the CRM
  holds end-to-end). A small admin "leads & outcomes by originating form/guide"
  report is a natural future addition.

---

## 6. Owner setup delta (on top of the 2026-07-24 list in SETUP.md §8)

- Create **three more** offline conversion actions (Seller Valuation, **Guide
  Download** [generic — covers future buyer guides too], Appointment Requested) —
  six total — all Import source, Count = One, Secondary. Put their ids in the
  three new env vars (§3).
- No new migration to apply beyond **0032** (`leads.guide_id`), which ships with
  this change. No new secrets beyond the three action-id vars.
