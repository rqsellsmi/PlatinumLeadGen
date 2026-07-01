/**
 * POST /api/admin/queue/save — persist an admin-reordered rotation list.
 * (v1.6 §G.4)
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { saveQueueOrder } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { rotationList?: unknown } | null;
  const list = body?.rotationList;
  if (!Array.isArray(list) || !list.every((n) => typeof n === 'number')) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  await saveQueueOrder(list as number[]);
  return NextResponse.json({ ok: true });
}
