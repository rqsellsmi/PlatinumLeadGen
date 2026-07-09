import { Card, CardBody, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import LocalTime from '@/components/LocalTime';
import { formatCurrency } from '@/lib/utils';
import { browseIdxListings, idxCities } from '@/lib/idxAdmin';

export const dynamic = 'force-dynamic';

const STATUSES = ['Active', 'Pending', 'Closed', 'Withdrawn', 'Expired'];

/** /admin/idx-listings — read-only browser of synced IDX data (IDX spec §8.2). */
export default async function IdxListingsPage({
  searchParams,
}: {
  searchParams: { city?: string; status?: string; q?: string };
}) {
  await requireAdmin();
  const city = (searchParams.city ?? '').trim();
  const status = (searchParams.status ?? '').trim();
  const q = (searchParams.q ?? '').trim();

  const [{ rows, total }, cities] = await Promise.all([
    browseIdxListings({ city: city || undefined, status: status || undefined, search: q || undefined, limit: 100 }),
    idxCities(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">IDX Listings</h1>
        <p className="text-sm text-mute">
          Read-only view of synced Realcomp data — for debugging and confirming coverage.
        </p>
      </div>

      <Card>
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold text-mute">City</span>
              <select name="city" defaultValue={city} className="rounded-lg border border-line px-3 py-2 text-sm">
                <option value="">All cities</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold text-mute">Status</span>
              <select name="status" defaultValue={status} className="rounded-lg border border-line px-3 py-2 text-sm">
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold text-mute">Search address / MLS #</span>
              <input
                name="q"
                defaultValue={q}
                placeholder="123 Main or MLS number"
                className="rounded-lg border border-line px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-charcoal px-4 py-2 text-sm font-semibold text-white hover:bg-charcoal-light"
            >
              Filter
            </button>
          </form>
        </CardBody>
      </Card>

      <p className="text-sm text-mute">
        Showing {rows.length} of {total.toLocaleString()} matching listings.
      </p>

      <Card>
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-mute-light">
                <th className="py-2 pr-4">Address</th>
                <th className="py-2 pr-4">City</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">List price</th>
                <th className="py-2 pr-4">Bd/Ba</th>
                <th className="py-2 pr-4">DOM</th>
                <th className="py-2 pr-4">Yours</th>
                <th className="py-2">Last synced</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-4 text-mute">
                    No listings match. (The feed may not be synced yet.)
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-line-hair">
                    <td className="py-2 pr-4">{r.address ?? '—'}</td>
                    <td className="py-2 pr-4">{r.city ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={r.standardStatus === 'Active' ? 'success' : r.standardStatus === 'Closed' ? 'info' : 'neutral'}>
                        {r.standardStatus}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">{formatCurrency(r.standardStatus === 'Closed' ? r.closePrice : r.listPrice)}</td>
                    <td className="py-2 pr-4">
                      {r.bedsTotal ?? '—'}/{r.bathsTotal ?? '—'}
                    </td>
                    <td className="py-2 pr-4">{r.daysOnMarket ?? '—'}</td>
                    <td className="py-2 pr-4">{r.isOfficeListing ? '✓' : ''}</td>
                    <td className="py-2">
                      <LocalTime value={r.lastSyncedAt} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
