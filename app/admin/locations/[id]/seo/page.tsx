import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations } from '@/drizzle/schema';
import { parseFaqJson } from '@/lib/seo';
import { Card, CardHeader, CardBody } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { SeoForm } from '@/components/admin/SeoForm';

export const dynamic = 'force-dynamic';

export default async function LocationSeoPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!id) notFound();

  const rows = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  const loc = rows[0];
  if (!loc) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/locations" className="text-sm text-brand-blue hover:underline">
          ← Back to locations
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">SEO — {loc.name}</h1>
        <p className="text-sm text-slate-500">/sell/{loc.slug}</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Page copy & FAQ</h2>
        </CardHeader>
        <CardBody>
          <SeoForm
            locationId={loc.id}
            initial={{
              metaTitle: loc.metaTitle ?? '',
              metaDescription: loc.metaDescription ?? '',
              heroHeadline: loc.heroHeadline ?? '',
              heroSubheadline: loc.heroSubheadline ?? '',
              guideUrl: loc.guideUrl ?? '',
              faq: parseFaqJson(loc.faqJson),
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
