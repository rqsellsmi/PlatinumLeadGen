'use server';

import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { applyScore } from '@/lib/scoring';
import { geocodeAddress } from '@/lib/geocode';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { toE164 } from '@/lib/sms';

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export async function updateAgent(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('agentId'));
  if (!id) throw new Error('Invalid agent');
  const firstName = String(formData.get('firstName') ?? '').trim();
  const lastName = String(formData.get('lastName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  if (!firstName || !lastName || !email) {
    throw new Error('First name, last name, and email are required');
  }

  const anchor = String(formData.get('proximityAnchor') ?? 'office') === 'custom' ? 'custom' : 'office';
  const locationCity = String(formData.get('locationCity') ?? '').trim() || null;
  const radiusMiles = num(formData.get('radiusMiles'));

  // Geocode the custom city so proximity has coordinates; on 'office' or a
  // blank/failed city, coordinates clear and routing uses the office anchor.
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (anchor === 'custom' && locationCity) {
    const geo = await geocodeAddress({ city: locationCity });
    if (geo) {
      latitude = geo.lat;
      longitude = geo.lng;
    }
  }

  const rawPhone = String(formData.get('phone') ?? '').trim();
  const phone = rawPhone ? (toE164(rawPhone) ?? rawPhone) : null;
  await db
    .update(agents)
    .set({
      firstName,
      lastName,
      email,
      phone,
      officeId: num(formData.get('officeId')),
      proximityAnchor: anchor,
      locationCity,
      latitude,
      longitude,
      proximityRadiusMiles: radiusMiles != null && radiusMiles > 0 ? radiusMiles : null,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, id));
  revalidatePath(`/admin/agents/${id}`);
  revalidatePath('/admin/agents');
}

export async function setAgentPassword(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('agentId'));
  const password = String(formData.get('password') ?? '');
  if (!id) throw new Error('Invalid agent');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const passwordHash = await bcrypt.hash(password, 12);
  await db
    .update(agents)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(agents.id, id));
  revalidatePath(`/admin/agents/${id}`);
}

export async function adjustScore(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('agentId'));
  const delta = Number(formData.get('delta'));
  const note = String(formData.get('note') ?? '').trim();
  if (!id) throw new Error('Invalid agent');
  if (Number.isNaN(delta) || delta === 0) throw new Error('Delta must be a non-zero number');
  if (!note) throw new Error('A reason note is required for manual adjustments');
  await applyScore({ agentId: id, reason: 'manual_adjustment', delta, note });
  revalidatePath(`/admin/agents/${id}`);
  revalidatePath('/admin/agents');
}

export async function deactivateAgent(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('agentId'));
  if (!id) throw new Error('Invalid agent');
  await db
    .update(agents)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(agents.id, id));
  revalidatePath(`/admin/agents/${id}`);
  revalidatePath('/admin/agents');
}
