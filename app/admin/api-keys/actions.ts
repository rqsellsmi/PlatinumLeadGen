'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { apiKeys } from '@/drizzle/schema';
import { generateApiKey } from '@/lib/apiKeys';
import { requireAdmin } from '@/components/admin/requireAdmin';

export async function createApiKey(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('A name is required');
  const { raw, prefix, hash } = await generateApiKey();
  await db.insert(apiKeys).values({ name, keyPrefix: prefix, keyHash: hash });
  revalidatePath('/admin/api-keys');
  // Show the raw key once via a searchParam (cleared after the user navigates away).
  redirect(`/admin/api-keys?created=${encodeURIComponent(raw)}`);
}

export async function revokeApiKey(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('keyId'));
  if (!id) throw new Error('Invalid key');
  await db
    .update(apiKeys)
    .set({ isActive: false, revokedAt: new Date() })
    .where(eq(apiKeys.id, id));
  revalidatePath('/admin/api-keys');
}
