import Link from 'next/link';
import { Button } from '@/components/ui';

export interface Kpi {
  label: string;
  value: string;
  sub: string;
  subTone?: 'neutral' | 'success' | 'danger';
}
export interface HotLead {
  id: number;
  name: string;
  address: string;
  city: string;
  priceRange: string;
  assignee: string | null;
}
export interface CityStat {
  city: string;
  leads: number;
  volume: string;
  pct: number; // 0-100 bar width
  color: string; // tailwind bg-* class
}

const subToneClass: Record<string, string> = {
  neutral: 'text-mute-light',
  success: 'text-success',
  danger: 'text-platinum-red',
};

/**
 * Admin "Lead Console" overview, matching the design mockup: KPI row, hot-leads
 * list, leads-by-city bars, and round-robin status. Presentational — the page
 * supplies data.
 */
export default function OverviewDashboard({
  kpis,
  hotLeads,
  cityStats,
  nextAgent,
}: {
  kpis: Kpi[];
  hotLeads: HotLead[];
  cityStats: CityStat[];
  nextAgent: { name: string; initials: string } | null;
}) {
  return (
    <div className="space-y-7">
      {/* Top bar */}
      <div className="border-b border-line pb-5">
        <h1 className="text-2xl font-bold text-charcoal">Overview</h1>
        <p className="text-sm text-mute">Lead flow across all four markets</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-card border border-line bg-white px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-mute-light">{k.label}</p>
            <p className="mt-1 font-numeric text-4xl font-bold text-charcoal">{k.value}</p>
            <p className={`mt-1 text-xs ${subToneClass[k.subTone ?? 'neutral']}`}>{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Hot leads */}
        <div className="rounded-card border border-line bg-white lg:col-span-2">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-bold text-charcoal">Hot leads needing attention</h2>
            <Link href="/admin/leads" className="text-sm font-semibold text-platinum-blue hover:underline">
              View all leads →
            </Link>
          </div>
          <ul className="divide-y divide-line-hair">
            {hotLeads.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/admin/leads/${l.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-offwhite"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger-bg text-sm font-bold text-platinum-red">
                    {initials(l.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-charcoal">{l.name}</p>
                    <p className="truncate text-sm text-mute-light">
                      {l.address}
                      {l.city ? ` · ${l.city}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-numeric font-bold text-charcoal">{l.priceRange}</p>
                    {l.assignee ? (
                      <span className="mt-1 inline-block rounded-pill bg-line-hair px-2.5 py-0.5 text-[11px] font-bold text-mute">
                        {l.assignee}
                      </span>
                    ) : (
                      <span className="mt-1 inline-block rounded-pill bg-danger-bg px-2.5 py-0.5 text-[11px] font-bold text-platinum-red">
                        Unassigned
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
            {hotLeads.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-mute">No active leads yet.</li>
            )}
          </ul>
        </div>

        {/* Leads by city + round-robin status */}
        <div className="space-y-6">
          <div className="rounded-card border border-line bg-white px-5 py-4">
            <h2 className="font-bold text-charcoal">Leads by city</h2>
            <ul className="mt-4 space-y-4">
              {cityStats.map((c) => (
                <li key={c.city}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-bold text-charcoal">{c.city}</span>
                    <span className="text-mute-light">
                      {c.leads} leads · {c.volume}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-pill bg-line-hair">
                    <div className={`h-2 rounded-pill ${c.color}`} style={{ width: `${c.pct}%` }} />
                  </div>
                </li>
              ))}
              {cityStats.length === 0 && <li className="text-sm text-mute">No cities yet.</li>}
            </ul>
          </div>

          <div className="rounded-card border border-line bg-white px-5 py-4">
            <h2 className="font-bold text-charcoal">Round-robin status</h2>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-platinum-blue text-sm font-bold text-white">
                {nextAgent?.initials ?? '—'}
              </span>
              <div className="flex-1">
                <p className="text-xs text-mute-light">Next assignment goes to</p>
                <p className="font-bold text-charcoal">{nextAgent?.name ?? 'No active agents'}</p>
              </div>
              <Link href="/admin/round-robin">
                <Button size="sm" variant="secondary">
                  Manage
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
