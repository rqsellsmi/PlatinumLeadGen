'use client';

import * as React from 'react';
import LocalTime from '@/components/LocalTime';

interface ScoreEvent {
  id: number;
  delta: number;
  label: string;
  note: string | null;
  isNegated: boolean;
  createdAt: string | null;
}

interface ScoreData {
  queueScore: number;
  slots: number;
  pointsToNextSlot: number;
  slotProgressPct: number;
  lifetime: number;
  tier: string;
  tierColor: string;
  monthly: number;
  ytd: number;
  recentEvents: ScoreEvent[];
}

/**
 * Agent score panel (v1.6 §F, reworked per spec v2 §1/§6). Surfaces all four
 * score tracks:
 *  - Queue Score (rolling-365): the hero — drives rotation slots, with a
 *    progress meter toward the next slot.
 *  - Tier: standing vs. the active cohort, from the lifetime score.
 *  - This Month / Year to Date: the two leaderboard tracks.
 * Keeps the collapsible log of the agent's last 15 score events (§K.8).
 */
export default function ScorePanel() {
  const [data, setData] = React.useState<ScoreData | null>(null);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    fetch('/api/agent/score')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: ScoreData) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return null;
  if (!data) {
    return (
      <div className="rounded-card border border-line bg-white p-5">
        <p className="text-sm text-mute">Loading your score…</p>
      </div>
    );
  }

  const slotProgressPct = Math.max(0, Math.min(100, data.slotProgressPct));

  return (
    <div className="rounded-card border border-line bg-white">
      <div className="px-5 pt-4">
        {/* Hero: Queue Score */}
        <div className="flex items-baseline gap-3">
          <span className="font-numeric text-4xl font-bold text-charcoal">
            {Math.round(data.queueScore)}
          </span>
          <span className="text-sm font-semibold text-mute">Queue Score</span>
        </div>
        <p className="mt-1 text-sm font-bold text-charcoal">
          {data.slots} slot{data.slots === 1 ? '' : 's'} in the lead queue
        </p>

        <div className="relative mt-2 h-2 rounded-pill bg-line">
          <div
            className="absolute inset-y-0 left-0 rounded-pill bg-platinum-blue"
            style={{ width: `${slotProgressPct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-mute-light">
          {data.pointsToNextSlot > 0
            ? `${Math.round(data.pointsToNextSlot)} more points to gain another slot in the queue`
            : `You just reached ${data.slots} slots`}
        </p>
        <p className="mt-1 text-xs text-mute">More Queue Score = more turns at nearby leads.</p>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-line-hair px-5 py-3">
        <span className={`text-sm font-bold ${data.tierColor}`}>{data.tier}</span>
        <span className="text-xs text-mute-light">Tier — your standing vs. the team.</span>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-line-hair px-5 py-3">
        <div className="rounded-card bg-line-hair/40 p-3">
          <p className="font-numeric text-xl font-bold text-charcoal">
            {Math.round(data.monthly)}
          </p>
          <p className="text-xs font-semibold text-mute">This Month</p>
          <p className="text-[10px] text-mute-light">monthly leaderboard</p>
        </div>
        <div className="rounded-card bg-line-hair/40 p-3">
          <p className="font-numeric text-xl font-bold text-charcoal">{Math.round(data.ytd)}</p>
          <p className="text-xs font-semibold text-mute">Year to Date</p>
          <p className="text-[10px] text-mute-light">resets Jan 1</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 border-t border-line-hair px-5 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm text-mute">Score history</span>
        <span className="text-xs font-semibold text-platinum-blue">
          {open ? 'Hide history ▲' : 'Score history ▼'}
        </span>
      </button>

      {open ? (
        <div className="border-t border-line-hair px-5 py-3">
          {data.recentEvents.length === 0 ? (
            <p className="text-sm text-mute">No score changes yet.</p>
          ) : (
            <ul className="divide-y divide-line-hair">
              {data.recentEvents.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-charcoal">
                      {e.label}
                      {e.isNegated ? <span className="ml-2 text-xs text-mute-light">(reversed)</span> : null}
                    </p>
                    <p className="text-xs text-mute-light">
                      <LocalTime value={e.createdAt} dateOnly fallback="" />
                      {e.note ? ` · ${e.note}` : ''}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-numeric font-bold ${
                      e.delta >= 0 ? 'text-success' : 'text-platinum-red'
                    }`}
                  >
                    {e.delta >= 0 ? '+' : ''}
                    {e.delta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
