import {
  CONSUMER_USE_DISCLAIMER,
  ACCURACY_DISCLAIMER,
  SEARCH_USE_NOTICE,
  copyrightNotice,
} from '@/lib/idxDisclosures';

/**
 * Required IDX disclosures (IDX spec §3.4). Render below every surface that
 * shows IDX data so compliance is enforced structurally rather than remembered
 * per page.
 *
 *  - 'summary' : consumer-use + accuracy disclaimers + the search-use notice
 *                and the literal term "IDX" (for the first-page requirements).
 *  - 'detail'  : the above plus the copyright/MLS-credit line, which must carry
 *                the originating MLS system name.
 *
 * Pass `firstOnPage` on the first IDX block of a page so the search-use notice
 * and IDX term appear exactly once, up top.
 */
export default function IdxCompliance({
  variant = 'summary',
  originatingSystemName,
  firstOnPage = true,
}: {
  variant?: 'summary' | 'detail';
  originatingSystemName?: string | null;
  firstOnPage?: boolean;
}) {
  return (
    <div className="mt-6 space-y-2 border-t border-line pt-4 text-[11px] leading-relaxed text-mute-light">
      {variant === 'detail' ? (
        <p className="font-medium text-mute">{copyrightNotice(originatingSystemName)}</p>
      ) : null}
      <p>{CONSUMER_USE_DISCLAIMER}</p>
      <p>{ACCURACY_DISCLAIMER}</p>
      {firstOnPage ? (
        <p>
          <span className="font-semibold text-mute">IDX.</span> {SEARCH_USE_NOTICE}
        </p>
      ) : null}
    </div>
  );
}
