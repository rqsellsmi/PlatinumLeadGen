'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations, marketStats } from '@/drizzle/schema';
import { invalidateLocationCache } from '@/lib/redis';
import { requireAdmin } from '@/components/admin/requireAdmin';

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : Math.trunc(n);
}

export async function saveStats(formData: FormData) {
  await requireAdmin();
  const locationId = Number(formData.get('locationId'));
  if (!locationId) throw new Error('Invalid location');

  const values = {
    avgSalePrice: num(formData.get('avgSalePrice')),
    daysToSell: num(formData.get('daysToSell')),
    homesSold: num(formData.get('homesSold')),
    percentOfListPrice: num(formData.get('percentOfListPrice')),
    percentAboveList: num(formData.get('percentAboveList')),
    updatedAt: new Date(),
  };

  const existing = await db
    .select({ id: marketStats.id })
    .from(marketStats)
    .where(eq(marketStats.locationId, locationId))
    .limit(1);

  if (existing[0]) {
    await db.update(marketStats).set(values).where(eq(marketStats.id, existing[0].id));
  } else {
    await db.insert(marketStats).values({ locationId, ...values });
  }

  const loc = await db
    .select({ slug: locations.slug })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  if (loc[0]?.slug) await invalidateLocationCache(loc[0].slug);
  revalidatePath('/sell/[slug]', 'page');
  revalidatePath(`/admin/locations/${locationId}/stats`);
}
