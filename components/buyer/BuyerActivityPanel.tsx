import Link from 'next/link';
import { getBuyerActivity, type BuyerActivityListing } from '@/lib/buyerActivity';
import { formatCurrency } from '@/lib/utils';

/**
 * Read-only buyer-activity panel shown on the agent + admin lead pages when a
 * lead is linked to a buyer account. Surfaces what the buyer saved and viewed so
 * the agent can tailor outreach. Server component — scoped to this lead's buyer.
 */
export default async function BuyerActivityPanel({ buyerUserId }: { buyerUserId: number }) {
  const activity = await getBuyerActivity(buyerUserId);
  if (!activity) return null;

  return (
    <div className="rounded-card border border-line bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-charcoal">Buyer activity</h2>
        {activity.representedElsewhere ? (
          <span className="rounded bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
            Represented elsewhere
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-mute-light">
        {activity.name ? `${activity.name} · ` : ''}
        {activity.email}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-3">
        <ListingColumn title="Saved homes" items={activity.favorites} empty="No saved homes." />

        <div>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">Saved searches</h3>
          {activity.savedSearches.length === 0 ? (
            <p className="text-sm text-mute">No saved searches.</p>
          ) : (
            <ul className="space-y-1.5">
              {activity.savedSearches.map((s) => (
                <li key={s.id} className="text-sm text-charcoal">
                  {s.description}
                </li>
              ))}
            </ul>
          )}
        </div>

        <ListingColumn title="Recently viewed" items={activity.recentViews} empty="No recent views." showViews />
      </div>
    </div>
  );
}

function ListingColumn({
  title,
  items,
  empty,
  showViews,
}: {
  title: string;
  items: BuyerActivityListing[];
  empty: string;
  showViews?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-mute">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.listingKey} className="text-sm">
              <Link href={`/listing/${encodeURIComponent(it.listingKey)}`} className="text-charcoal hover:text-platinum-blue">
                {it.address ?? it.listingKey}
                {it.city ? <span className="text-mute-light">, {it.city}</span> : null}
              </Link>
              <span className="ml-1 text-xs text-mute-light">
                {it.price != null ? formatCurrency(it.price) : ''}
                {showViews && it.viewCount ? ` · ${it.viewCount}×` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
