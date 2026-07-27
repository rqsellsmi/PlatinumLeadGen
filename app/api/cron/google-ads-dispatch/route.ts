/**
 * Cron: deliver pending Google Ads offline conversions to the Data Manager API.
 * Pinged by GitHub Actions (cron.yml every ~10 min; scheduled-daily.yml runs the
 * same route as the daily reconciliation, which re-drives due retryable errors).
 * Each send is a single quick HTTP call, so this stays inside the serverless
 * budget — unlike the IDX sync it does not need to run on the GH runner.
 */
import { NextRequest, NextResponse } from 'next/server';
import { dispatchGoogleAdsConversions } from '@/lib/googleAdsWorker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const summary = await dispatchGoogleAdsConversions();
    return NextResponse.json(summary);
  } catch (err) {
    console.error('[cron/google-ads-dispatch] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
