'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { toE164 } from '@/lib/sms';

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export async function createAgent(formData: FormData) {
  await requireAdmin();
  const firstName = String(formData.get('firstName') ?? '').trim();
  const lastName = String(formData.get('lastName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  if (!firstName || !lastName || !email) {
    throw new Error('First name, last name, and email are required');
  }
  const rawPhone = String(formData.get('phone') ?? '').trim();
  const phone = rawPhone ? (toE164(rawPhone) ?? rawPhone) : null;
  await db.insert(agents).values({
    firstName,
    lastName,
    email,
    phone,
    officeId: num(formData.get('officeId')),
    latitude: num(formData.get('lat')),
    longitude: num(formData.get('lng')),
  });
  revalidatePath('/admin/agents');
}

export async function toggleAgentActive(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('agentId'));
  const isActive = String(formData.get('isActive')) === 'true';
  if (!id) throw new Error('Invalid agent');
  await db
    .update(agents)
    .set({ isActive: !isActive, updatedAt: new Date() })
    .where(eq(agents.id, id));
  revalidatePath('/admin/agents');
  revalidatePath(`/admin/agents/${id}`);
}
