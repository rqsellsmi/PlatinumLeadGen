/**
 * Form-adjacent privacy disclosure — ONE source of truth (P0.6, review #19/#20).
 *
 * Before this module the public forms carried four different promises, and all
 * four contradicted the published Privacy Policy:
 *
 *   HeroValuation      "We never share your information."
 *   ExitIntentOverlay  "We'll never share your address."
 *   GuideDownloadBlock "We never share your information."
 *
 * The policy states plainly that information IS shared — with RE/MAX Platinum
 * agents (who need it to do the valuation), and with service providers
 * (RentCast/ATTOM, Google Maps, hosting and email vendors). "Never shared" was
 * therefore false on its face, and an inaccurate privacy promise is both an FTC
 * exposure and a straightforward trust problem.
 *
 * The replacement below is the review's recommended wording. It says the thing
 * that is actually true and that people care about — we don't SELL your data —
 * and points to the policy for the rest.
 *
 * If this string changes, it changes here and nowhere else. Every public form
 * renders it through <PrivacyNote>.
 *
 * NOTE (P0.6 acceptance): counsel signs off on the final wording before launch.
 */
export const PRIVACY_DISCLOSURE =
  "We don't sell your information. We use it to provide your valuation and follow up about your selling plans, as described in our Privacy Policy.";

/**
 * Shown beside the address step, before any contact details are asked for.
 *
 * D8 requires us to disclose PRE-SUBMISSION collection: the address entered
 * here is retained even if the visitor never finishes the form, so saying so at
 * the point of entry is the honest place for it.
 */
export const ADDRESS_STEP_DISCLOSURE =
  'We keep the address you enter even if you don’t finish, so we can improve our local market data. See our Privacy Policy.';

/** Canonical path to the policy — one place, so a route rename can't orphan a link. */
export const PRIVACY_POLICY_PATH = '/privacy';
