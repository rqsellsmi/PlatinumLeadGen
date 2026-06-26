interface HeroSectionProps {
  headline: string;
  subheadline: string;
  cityName: string;
}

/** Full-width brand-blue gradient hero. Server-rendered, no client JS. */
export default function HeroSection({ headline, subheadline, cityName }: HeroSectionProps) {
  return (
    <section className="bg-gradient-to-br from-brand-blue to-[#16304d] text-white">
      <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:py-28">
        <h1 className="text-3xl font-bold leading-tight sm:text-5xl">{headline}</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-200 sm:text-xl">{subheadline}</p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="#valuation"
            className="inline-flex items-center justify-center rounded-md bg-brand-red px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-[#b8141f]"
          >
            Get My Free Home Value
          </a>
          <a
            href="#recent-sales"
            className="inline-flex items-center justify-center rounded-md border border-white/70 bg-transparent px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-white/10"
          >
            See Recent Sales in {cityName}
          </a>
        </div>
      </div>
    </section>
  );
}
