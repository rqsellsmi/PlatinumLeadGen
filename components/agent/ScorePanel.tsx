'use client';

import * as React from 'react';

interface ScoreEvent {
  id: number;
  delta: number;
  label: string;
  note: string | null;
  isNegated: boolean;
  createdAt: string | null;
}

interface ScoreData {
  score: number;
  tier: string;
  tierColor: string;
  recentEvents: ScoreEvent[];
}

const SCORE_MAX = 200;

/**
 * Agent score panel (v1.6 §F). Shows the agent's current score, tier label, and
 * a collapsible log of their last 15 score events. Markers at 0 / 50 (start) /
 * 200 (max). Collapse state is local UI only (§K.8).
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

  const pct = Math.max(0, Math.min(100, (data.score / SCORE_MAX) * 100));

  return (
    <div className="rounded-card border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <div className="flex items-baseline gap-3">
          <span className="font-numeric text-4xl font-bold text-charcoal">
            {Math.round(data.score)}
          </span>
          <span className={`text-sm font-bold ${data.tierColor}`}>{data.tier}</span>
        </div>
        <span className="text-xs font-semibold text-platinum-blue">
          {open ? 'Hide history ▲' : 'Score history ▼'}
        </span>
      </button>

      <div className="px-5 pb-4">
        {/* Score bar with 0 / 50 / 200 markers */}
        <div className="relative mt-1 h-2 rounded-pill bg-line">
          <div className="absolute inset-y-0 left-0 rounded-pill bg-platinum-blue" style={{ width: `${pct}%` }} />
          {/* start marker at 50/200 = 25% */}
          <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-mute-light" style={{ left: '25%' }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-mute-light">
          <span>0</span>
          <span>50 start</span>
          <span>200 max</span>
        </div>
      </div>

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
                      {e.createdAt ? new Date(e.createdAt).toLocaleDateString('en-US') : ''}
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
