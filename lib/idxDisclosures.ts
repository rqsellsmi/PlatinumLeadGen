/**
 * IDX required disclosures (IDX spec §3.1; Realcomp IDX Rules §18.2–§18.3).
 *
 * Centralized as constants so a required disclaimer is never accidentally
 * omitted — every IDX-displaying surface pulls its text from here. Violations
 * carry escalating fines ($2,500 / $5,000) and termination of MLS privileges,
 * so treat these as non-negotiable.
 */

export const REALCOMP_BROKERAGE = 'RE/MAX Platinum';

/** Path to the Realcomp-approved logo (owner supplies the official file). */
export const REALCOMP_LOGO_SRC = '/assets/realcomp-logo.png';

/**
 * Copyright notice — on every listing DETAIL display (§18.3.4). The originating
 * system name identifies which MLS the listing came from (some Realcomp
 * listings originate from data-share partner MLSs).
 */
export function copyrightNotice(originatingSystemName?: string | null): string {
  const origin = originatingSystemName?.trim() ? ` and ${originatingSystemName.trim()}` : '';
  return `IDX provided courtesy of Realcomp II Ltd. via ${REALCOMP_BROKERAGE}${origin}, ©2022 Realcomp II Ltd. Shareholders`;
}

/** Consumer use disclaimer — on every page showing IDX data (§18.3.7). */
export const CONSUMER_USE_DISCLAIMER =
  "IDX information is provided exclusively for consumers' personal, non-commercial use " +
  'and may not be used for any purpose other than to identify prospective properties ' +
  'consumers may be interested in purchasing. The data is deemed reliable but not ' +
  'guaranteed accurate by the MLS.';

/** Accuracy disclaimer — on every listing display (§18.3.13). */
export const ACCURACY_DISCLAIMER =
  'The accuracy of all information, regardless of source, is not guaranteed or warranted. ' +
  'All information should be independently verified.';

/** Search use notice — on the first page where any IDX data appears (§18.3.14a). */
export const SEARCH_USE_NOTICE =
  'Any use of search facilities of data on this site, other than by a consumer looking ' +
  'to purchase real estate, is prohibited.';

/** The literal term "IDX" must appear on the first page where listing data shows (§18.3.6). */
export const IDX_TERM_LABEL = 'IDX Search';
