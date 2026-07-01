import { Badge } from '@/components/ui';

export interface RotationRow {
  rank: number | null; // null = paused (shown as —)
  name: string;
  initials: string;
  color: string; // bg-* for avatar
  activeLeads: number;
  weight: number;
  paused: boolean;
  nextUp: boolean;
}
export interface DistRow {
  name: string;
  count: number;
  pct: number;
  color: string;
}

/**
 * Admin Round-Robin queue, matching the design mockup: rotation order with
 * weight + active/paused, a NEXT UP card, and weekly distribution bars.
 * Weight comes from the score-weighted rotation; paused = agent isAvailable false.
 */
export default function RoundRobinView({
  rotation,
  nextAgent,
  distribution,
}: {
  rotation: RotationRow[];
  nextAgent: { name: string; initials: string; waiting: number } | null;
  distribution: DistRow[];
}) {
  return (
    <div className="space-y-6">
      <div className="border-b border-line pb-5">
        <h1 className="text-2xl font-bold text-charcoal">Round-Robin Queue</h1>
        <p className="text-sm text-mute">Automatic lead distribution settings</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Rotation order */}
        <div className="rounded-card border border-line bg-white lg:col-span-2">
          <div className="px-5 py-4">
            <h2 className="font-bold text-charcoal">Rotation order</h2>
            <p className="text-sm text-mute">
              Unassigned leads are distributed top-to-bottom. Paused agents are skipped.
            </p>
          </div>
          <ul className="divide-y divide-line-hair">
            {rotation.map((r) => (
              <li
                key={r.name}
                className={`flex items-center gap-4 px-5 py-4 ${r.nextUp ? 'bg-[#EEF3FF]' : ''}`}
              >
                <span className="w-4 text-center font-numeric text-lg font-bold text-mute-lighter">
                  {r.rank ?? '—'}
                </span>
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${r.color}`}
                >
                  {r.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-bold text-charcoal">{r.name}</p>
                    {r.nextUp ? (
                      <span className="rounded-pill border border-platinum-blue px-2 py-0.5 text-[10px] font-bold uppercase text-platinum-blue">
                        Next up
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-mute-light">{r.activeLeads} active leads</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-mute-lighter">Weight</p>
                  <p className="font-numeric font-bold text-charcoal">{r.weight}×</p>
                </div>
                <Badge tone={r.paused ? 'neutral' : 'success'}>{r.paused ? 'Paused' : 'Active'}</Badge>
              </li>
            ))}
            {rotation.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-mute">No active agents.</li>
            )}
          </ul>
        </div>

        {/* Next up + distribution */}
        <div className="space-y-6">
          <div className="rounded-card bg-platinum-blue px-5 py-5 text-white">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/70">Next up</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/40 text-sm font-bold">
                {nextAgent?.initials ?? '—'}
              </span>
              <div>
                <p className="text-lg font-bold">{nextAgent?.name ?? 'No active agents'}</p>
                <p className="text-sm text-white/80">{nextAgent?.waiting ?? 0} leads waiting in queue</p>
              </div>
            </div>
          </div>

          <div className="rounded-card border border-line bg-white px-5 py-4">
            <h2 className="font-bold text-charcoal">Distribution this week</h2>
            <ul className="mt-4 space-y-3">
              {distribution.map((d) => (
                <li key={d.name} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 truncate text-mute">{d.name}</span>
                  <div className="h-2 flex-1 rounded-pill bg-line-hair">
                    <div className={`h-2 rounded-pill ${d.color}`} style={{ width: `${d.pct}%` }} />
                  </div>
                  <span className="w-6 text-right font-numeric font-bold text-charcoal">{d.count}</span>
                </li>
              ))}
              {distribution.length === 0 && <li className="text-sm text-mute">No data yet.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
