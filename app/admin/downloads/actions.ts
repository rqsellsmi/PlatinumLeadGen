'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { guides } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';

function str(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}
function intOrZero(v: FormDataEntryValue | null): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
/** Split a textarea (one per line) into a JSON array string. */
function linesToJson(v: FormDataEntryValue | null): string {
  const lines = String(v ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return JSON.stringify(lines);
}
/** Split a comma-separated field into a JSON array string. */
function csvToJson(v: FormDataEntryValue | null): string {
  const items = String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return JSON.stringify(items);
}

function revalidate() {
  revalidatePath('/admin/downloads');
  revalidatePath('/', 'page');
  revalidatePath('/sell/[slug]', 'page');
}

function values(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  const fileUrl = String(formData.get('fileUrl') ?? '').trim();
  if (!title || !fileUrl) throw new Error('Title and file URL are required');
  return {
    title,
    coverTitle: str(formData.get('coverTitle')),
    subtitle: str(formData.get('subtitle')),
    fileUrl,
    coverImageUrl: str(formData.get('coverImageUrl')),
    pagesLabel: str(formData.get('pagesLabel')),
    bulletsJson: linesToJson(formData.get('bullets')),
    ctaLabel: str(formData.get('ctaLabel')),
    placement: csvToJson(formData.get('placement')),
    isActive: formData.get('isActive') === 'on',
    displayOrder: intOrZero(formData.get('displayOrder')),
    updatedAt: new Date(),
  };
}

export async function createGuide(formData: FormData) {
  await requireAdmin();
  await db.insert(guides).values(values(formData));
  revalidate();
}

export async function updateGuide(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('guideId'));
  if (!id) throw new Error('Invalid download');
  await db.update(guides).set(values(formData)).where(eq(guides.id, id));
  revalidate();
}

export async function deleteGuide(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('guideId'));
  if (!id) throw new Error('Invalid download');
  await db.delete(guides).where(eq(guides.id, id));
  revalidate();
}
