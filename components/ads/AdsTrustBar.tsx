import Logo from '@/components/Logo';

/** Trust bar (Section 20.3 #6): brand logo, Google reviews badge, homes sold. */
export default function AdsTrustBar({
  googleReviewRating,
  googleReviewCount,
  homesSold,
}: {
  googleReviewRating: number | null;
  googleReviewCount: number | null;
  homesSold: number | null;
}) {
  return (
    <section className="border-y border-line bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-6 px-4 py-6 text-sm font-semibold text-charcoal sm:gap-12">
        <Logo variant="blue" width={120} href={null} />
        {googleReviewRating != null ? (
          <span className="flex items-center gap-1.5">
            <span className="text-warning" aria-hidden>
              {'★'.repeat(Math.round(googleReviewRating))}
            </span>
            {googleReviewRating.toFixed(1)}
            {googleReviewCount != null ? (
              <span className="text-mute-light">Google reviews ({googleReviewCount})</span>
            ) : null}
          </span>
        ) : null}
        {homesSold != null ? (
          <span>
            <span className="font-numeric text-platinum-red">{homesSold.toLocaleString()}</span> homes
            sold
          </span>
        ) : null}
      </div>
    </section>
  );
}
