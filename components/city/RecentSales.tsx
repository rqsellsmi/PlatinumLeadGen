import Image from 'next/image';
import type { RecentSale } from '@/drizzle/schema';
import { formatCurrency, formatMonthYear } from '@/lib/utils';

interface RecentSalesProps {
  sales: RecentSale[];
  cityName: string;
}

const FALLBACK_IMAGE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#1E3A5F"/><text x="50%" y="50%" fill="#F5F7FA" font-family="sans-serif" font-size="28" text-anchor="middle" dominant-baseline="middle">RE/MAX Platinum</text></svg>`,
  );

/** Grid of up to 6 recently sold homes. Renders nothing when empty. */
export default function RecentSales({ sales, cityName }: RecentSalesProps) {
  if (!sales.length) return null;

  return (
    <section id="recent-sales" className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold text-brand-blue">
          Recent Home Sales in {cityName}
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {sales.slice(0, 6).map((sale) => (
            <article
              key={sale.id}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
            >
              <div className="relative aspect-[3/2] w-full bg-slate-100">
                <Image
                  src={sale.photoUrl ?? FALLBACK_IMAGE}
                  alt={`Recently sold home at ${sale.address}`}
                  width={600}
                  height={400}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="px-5 py-4">
                <p className="font-semibold text-slate-800">{sale.address}</p>
                <p className="mt-1 text-xl font-bold text-brand-blue">
                  {formatCurrency(sale.soldPrice)}
                </p>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-500">
                  {sale.daysOnMarket != null ? (
                    <span>{sale.daysOnMarket} days on market</span>
                  ) : (
                    <span />
                  )}
                  {sale.closeDate ? <span>{formatMonthYear(sale.closeDate)}</span> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
