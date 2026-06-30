'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads } from '@/drizzle/schema';
import { reassignLead } from '@/lib/autoOffer';
import { requireAdmin } from '@/components/admin/requireAdmin';

const STATUSES = ['new', 'contacted', 'qualified', 'closed', 'lost'] as const;
type LeadStatus = (typeof STATUSES)[number];

export async function updateLeadStatus(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('leadId'));
  const status = String(formData.get('status') ?? '');
  if (!id || !(STATUSES as readonly string[]).includes(status)) {
    throw new Error('Invalid status update');
  }
  const now = new Date();
  await db
    .update(leads)
    .set({ status: status as LeadStatus, lastStatusChangedAt: now, updatedAt: now })
    .where(eq(leads.id, id));
  revalidatePath(`/admin/leads/${id}`);
  revalidatePath('/admin/leads');
}

export async function softDeleteLead(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('leadId'));
  if (!id) throw new Error('Invalid lead');
  await db
    .update(leads)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(eq(leads.id, id));
  revalidatePath('/admin/leads');
  redirect('/admin/leads');
}

export async function reassignLeadAction(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('leadId'));
  if (!id) throw new Error('Invalid lead');
  await reassignLead(id);
  revalidatePath(`/admin/leads/${id}`);
}
