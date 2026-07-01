/**
 * POST /api/revalidate — on-demand ISR revalidation (Section 7.4).
 * Called by admin content-save actions. Header x-revalidate-secret must match
 * REVALIDATE_SECRET. Body: { slug: string }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (req.headers.get('x-revalidate-secret') !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { slug?: string } | null;
  if (!body?.slug) {
    return NextResponse.json({ error: 'missing_slug' }, { status: 400 });
  }
  revalidatePath(`/sell/${body.slug}`);
  revalidatePath(`/ads/${body.slug}`);
  return NextResponse.json({ revalidated: true });
}
