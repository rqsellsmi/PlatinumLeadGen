import Link from 'next/link';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { Card, CardHeader, CardBody, Button, Input, Label } from '@/components/ui';
import PropertyDetails from '@/components/PropertyDetails';
import { getPropertyRecord } from '@/lib/propertyRecords';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Property Lookup | Admin' };

/**
 * Admin tool: enter any address and see the full AVM-provider property record
 * (characteristics, lot, tax/assessment, last sale, owner of record). Results
 * are cached by address; "Refresh from provider" forces a fresh billed call.
 */
export default async function PropertyLookupPage({
  searchParams,
}: {
  searchParams: { address?: string; refresh?: string };
}) {
  await requireAdmin();

  const address = (searchParams.address ?? '').trim();
  const force = searchParams.refresh === '1';
  const result = address ? await getPropertyRecord(address, { force }).catch(() => null) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Property Lookup</h1>
        <p className="mt-1 text-sm text-mute-light">
          Enter an address to pull the full property record from the AVM provider — characteristics,
          tax &amp; assessment, last sale, and owner of record.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Address</h2>
        </CardHeader>
        <CardBody>
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="address">Property address</Label>
              <Input
                id="address"
                name="address"
                defaultValue={address}
                placeholder="123 Main St, Brighton, MI 48116"
                autoComplete="off"
              />
            </div>
            <Button type="submit">Look up</Button>
          </form>
        </CardBody>
      </Card>

      {address && !result ? (
        <Card>
          <CardBody>
            <p className="text-sm text-mute">
              No property record found for <span className="font-semibold">{address}</span>. Check the
              address, or the provider may have no data for it.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {result ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-mute-lighter">
              {result.cached ? 'Cached result' : 'Fresh from provider'} · fetched{' '}
              {result.fetchedAt.toISOString().slice(0, 10)}
            </p>
            <Link
              href={`/admin/property-lookup?address=${encodeURIComponent(address)}&refresh=1`}
              className="text-xs font-semibold text-platinum-blue hover:underline"
            >
              Refresh from provider ↻
            </Link>
          </div>
          <PropertyDetails
            record={result.record}
            fetchedAt={result.fetchedAt}
            provider={result.provider}
            raw={result.raw}
            showRaw
          />
        </div>
      ) : null}
    </div>
  );
}
