import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';

/** Shared chrome + typography for static legal pages (v1.6 §I). */
export default function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold text-charcoal">{title}</h1>
        <p className="mt-1 text-sm text-mute">Last Updated: {lastUpdated}</p>
        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold text-charcoal">{heading}</h2>
      {children}
    </section>
  );
}

export function LegalSub({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-charcoal">{children}</h3>;
}

export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-6 text-mute">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
