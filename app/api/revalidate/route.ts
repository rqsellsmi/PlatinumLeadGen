/**
 * POST /api/revalidate — on-demand ISR revalidation (Section 7.4).
 * Header x-revalidate-secret must match REVALIDATE_SECRET.
 *
 * Body is either:
 *   { slug: "brighton-mi" }  → refresh that one city page
 *   { all: true }            → refresh every city page + the homepage
 *
 * WHO CALLS THIS: out-of-process writers only. The admin save actions run inside
 * this app and call revalidatePath() directly (see app/admin/locations/actions.ts
 * and friends), so they never need the HTTP hop. The IDX sync does: it runs as a
 * standalone script on a GitHub runner (scripts/idx-incremental-sync.ts), a
 * different process with no access to Next's cache, and its updateMetricsFromIdx()
 * pass rewrites the market_stats + home_page_metrics that every city page renders.
 * Without this call those pages would serve stale numbers until the hourly
 * `revalidate` window in app/sell/[slug]/page.tsx expired.
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (req.headers.get('x-revalidate-secret') !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { slug?: string; all?: boolean } | null;

  if (body?.all) {
    // Same two calls the admin content actions make, so a feed-driven stats change
    // and an admin edit converge on identical cache state. The '[slug]' form is the
    // route pattern, not a literal path — it refreshes every city page at once.
    revalidatePath('/sell/[slug]', 'page');
    revalidatePath('/', 'page');
    return NextResponse.json({ revalidated: true, scope: 'all' });
  }

  if (!body?.slug) {
    return NextResponse.json({ error: 'missing_slug_or_all' }, { status: 400 });
  }
  revalidatePath(`/sell/${body.slug}`);
  return NextResponse.json({ revalidated: true, scope: body.slug });
}
