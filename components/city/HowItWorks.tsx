const STEPS = [
  {
    title: 'Enter your address',
    body: 'Get an instant home value estimate built from recent area sales — in seconds.',
  },
  {
    title: 'Review with a local expert',
    body: 'A Platinum agent walks you through a personalized market report tailored to your home and street.',
  },
  {
    title: 'List with confidence',
    body: 'Price it right, market it everywhere, and maximize your final sale price with Platinum behind you.',
  },
];

/** Static 3-step explainer (identical copy across all cities). */
export default function HowItWorks() {
  return (
    <section className="bg-cream">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <p className="text-center text-[13px] font-bold uppercase tracking-[0.14em] text-platinum-red">
          How it works
        </p>
        <h2 className="mt-3.5 text-center text-3xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
          Three steps to a confident sale
        </h2>
        <ol className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-card border border-line bg-white p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-platinum-red font-numeric text-2xl font-bold text-white">
                {i + 1}
              </div>
              <h3 className="mt-5 text-xl font-bold text-charcoal">{step.title}</h3>
              <p className="mt-2.5 leading-relaxed text-mute">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
