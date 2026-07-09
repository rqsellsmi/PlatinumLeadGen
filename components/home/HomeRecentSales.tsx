import Image from 'next/image';
import Link from 'next/link';
import type { HomeRecentSale } from '@/lib/queries';
import { formatCurrency, formatMonthYear } from '@/lib/utils';

const FALLBACK_IMAGE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#232323"/><text x="50%" y="50%" fill="#F7F5EE" font-family="sans-serif" font-size="28" text-anchor="middle" dominant-baseline="middle">RE/MAX Platinum</text></svg>`,
  );

/** Aggregate recent-sales grid for the homepage. Renders nothing when empty. */
export default function HomeRecentSales({ sales }: { sales: HomeRecentSale[] }) {
  if (!sales.length) return null;

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <p className="mb-3.5 text-[13px] font-bold uppercase tracking-[0.14em] text-platinum-red">
          Recently sold by Platinum
        </p>
        <h2 className="text-3xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
          Recent Home Sales Across Southeast Michigan
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {sales.map((sale) => {
            const cls =
              'block overflow-hidden rounded-lg border border-line bg-white transition-shadow hover:shadow-[0_12px_32px_rgba(20,20,24,0.12)]';
            const inner = (
              <>
                <div className="relative h-52 w-full bg-line-hair">
                  <Image
                    src={sale.photoUrl ?? FALLBACK_IMAGE}
                    alt={`Recently sold home at ${sale.address}`}
                    width={600}
                    height={400}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute left-3.5 top-3.5 rounded bg-platinum-red px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-white">
                    Sold
                  </span>
                </div>
                <div className="px-5 py-5">
                  <p className="font-numeric text-3xl font-bold leading-none text-charcoal">
                    {formatCurrency(sale.soldPrice)}
                  </p>
                  <p className="mt-2.5 font-semibold text-charcoal">{sale.address}</p>
                  {sale.cityName ? (
                    <p className="text-sm text-mute-light">{sale.cityName.split(',')[0]}</p>
                  ) : null}
                  <div className="mt-3.5 flex items-center justify-between border-t border-line pt-3.5 text-sm text-mute-light">
                    {sale.daysOnMarket != null ? (
                      <span className="font-bold text-success">{sale.daysOnMarket} days on market</span>
                    ) : (
                      <span />
                    )}
                    {sale.closeDate ? <span>Sold {formatMonthYear(sale.closeDate)}</span> : null}
                  </div>
                </div>
              </>
            );
            return sale.listingKey ? (
              <Link key={sale.id} href={`/listing/${encodeURIComponent(sale.listingKey)}`} className={cls}>
                {inner}
              </Link>
            ) : (
              <div key={sale.id} className={cls}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
