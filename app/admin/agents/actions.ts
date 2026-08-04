'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { toE164 } from '@/lib/sms';
import { setAgentAvailability } from '@/lib/agentAvailability';
import { revokeAgentSessions } from '@/lib/agentSession';
import { sendAgentInvite, runLaunchInvites } from '@/lib/agentInvites';

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
  redirect('/admin/agents');
}

export async function toggleAgentActive(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('agentId'));
  const isActive = String(formData.get('isActive')) === 'true';
  if (!id) throw new Error('Invalid agent');
  const nowActive = !isActive;
  await db
    .update(agents)
    .set({ isActive: nowActive, updatedAt: new Date() })
    .where(eq(agents.id, id));
  // Marking an agent Departed must actually lock them out (review #18).
  // Without this they keep a working session for up to 7 days and a working
  // magic link for up to 14 — while continuing to see every seller's contact
  // details. The middleware gate can't catch it (no DB access on the edge), so
  // revocation is what closes it.
  if (!nowActive) await revokeAgentSessions(id);
  revalidatePath('/admin/agents');
  revalidatePath(`/admin/agents/${id}`);
}

/**
 * Sign an agent out everywhere and kill their magic link (review #18/#67).
 *
 * For the "I think my link got forwarded" / lost-device case, which previously
 * had no answer short of deactivating the agent entirely.
 */
export async function signOutAgentEverywhere(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('agentId'));
  if (!id) throw new Error('Invalid agent');
  await revokeAgentSessions(id);
  revalidatePath('/admin/agents');
  revalidatePath(`/admin/agents/${id}`);
}

/** Send (or re-send) one agent's account invite (D7 / #17). */
export async function resendAgentInvite(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('agentId'));
  if (!id) throw new Error('Invalid agent');
  await sendAgentInvite(id);
  revalidatePath('/admin/agents');
  revalidatePath(`/admin/agents/${id}`);
}

/**
 * The one-time Launch send (D7): email a unique, single-use, expiring invite to
 * every active agent with no password yet, and set the roster to opt-in
 * availability.
 *
 * Guarded by launch_invites_sent_at so a second click can't mass-re-email
 * everyone; `force` is the deliberate retry for a genuinely failed first run.
 */
export async function launchAgentInvites(formData: FormData) {
  await requireAdmin();
  const force = String(formData.get('force')) === 'true';
  await runLaunchInvites({ force });
  revalidatePath('/admin/agents');
}

/**
 * Flip an agent's availability from the admin — identical to the agent doing it
 * in their own portal (`setAgentAvailability`, incl. the first-activation credit)
 * with ONE exception: it does not pass `recordOptIn`, so an admin switching an
 * agent on never stamps referral-terms acceptance. Only the agent's own click
 * can do that, because only the agent saw the terms.
 */
export async function toggleAgentAvailable(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('agentId'));
  const isAvailable = String(formData.get('isAvailable')) === 'true';
  if (!id) throw new Error('Invalid agent');
  await setAgentAvailability(id, !isAvailable);
  revalidatePath('/admin/agents');
  revalidatePath(`/admin/agents/${id}`);
}
