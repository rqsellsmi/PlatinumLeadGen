'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { notificationSettings } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';

function int(v: FormDataEntryValue | null, fallback: number): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : Math.trunc(n);
}

export async function saveSettings(formData: FormData) {
  await requireAdmin();
  const notificationEmail = String(formData.get('notificationEmail') ?? '').trim() || null;
  const offerWindowStartHour = int(formData.get('offerWindowStartHour'), 7);
  const offerWindowEndHour = int(formData.get('offerWindowEndHour'), 20);
  const proximityRadiusMiles = int(formData.get('proximityRadiusMiles'), 20);
  const agentSetupCode = String(formData.get('agentSetupCode') ?? '').trim() || null;

  const existing = await db.select({ id: notificationSettings.id }).from(notificationSettings).limit(1);
  const values = {
    notificationEmail,
    offerWindowStartHour,
    offerWindowEndHour,
    proximityRadiusMiles,
    agentSetupCode,
    updatedAt: new Date(),
  };

  if (existing[0]) {
    await db.update(notificationSettings).set(values).where(eq(notificationSettings.id, existing[0].id));
  } else {
    await db.insert(notificationSettings).values(values);
  }
  revalidatePath('/admin/settings');
}
