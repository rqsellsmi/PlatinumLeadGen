'use client';

import GuideCaptureForm from '@/components/GuideCaptureForm';

interface SellerGuideSectionProps {
  locationSlug: string;
  guideUrl: string | null;
}

/**
 * Gated seller-guide download on the city pages. The lead capture itself lives
 * in the shared GuideCaptureForm (P0.3); this component owns only the banner
 * layout and copy.
 */
export default function SellerGuideSection({ locationSlug, guideUrl }: SellerGuideSectionProps) {
  // Caller also guards, but defend here per spec.
  if (!guideUrl) return null;

  return (
    <section className="bg-platinum-blue">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-8 px-4 py-14 sm:py-20">
        <div className="flex-1 basis-80">
          <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-[#A3D4F2]">
            Free download
          </p>
          <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            The Home Seller&apos;s Guide
          </h2>
          <p className="mt-2.5 leading-relaxed text-white/90">
            Pricing, prep, and timing strategies for selling in today&apos;s market — free PDF.
          </p>
        </div>
        <div className="flex-1 basis-80 rounded-2xl bg-white p-5">
          <GuideCaptureForm
            locationSlug={locationSlug}
            fileUrl={guideUrl}
            ctaLabel="Download the guide →"
            loadingLabel="Preparing…"
            inputLayout="stack"
            className="flex flex-col gap-2.5"
          />
        </div>
      </div>
    </section>
  );
}
