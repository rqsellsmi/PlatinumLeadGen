const STEPS = [
  {
    title: 'Enter your address',
    body: 'Tell us where your home is and get an instant value estimate in seconds.',
  },
  {
    title: 'Review with a local expert',
    body: 'Get a personalized market report from a RE/MAX Platinum agent who knows your area.',
  },
  {
    title: 'List with confidence',
    body: 'Go to market with a pricing strategy designed to maximize your sale price.',
  },
];

/** Static 3-step explainer (identical copy across all cities). */
export default function HowItWorks() {
  return (
    <section className="bg-brand-light">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold text-brand-blue">How It Works</h2>
        <ol className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-blue text-lg font-bold text-white">
                {i + 1}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-brand-blue">{step.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
