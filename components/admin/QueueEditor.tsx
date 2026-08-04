'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Badge } from '@/components/ui';

export interface QueueSlot {
  key: string; // stable per render position
  agentId: number;
  agentName: string;
  score: number;
  slotIndex: number; // 1-based within the agent's slots
  slotCount: number;
  /** Agent is not accepting leads: keeps the slot, skipped when it surfaces. */
  isPaused: boolean;
}

export interface DistRow {
  name: string;
  count: number;
  pct: number;
  color: string;
}

/**
 * Interactive round-robin queue (v1.6 §G.3). Each slot is a draggable row;
 * Save persists the new order, Discard reverts, Rebuild recomputes from scores.
 * Uses native HTML5 drag-and-drop (no extra dependency).
 */
export default function QueueEditor({
  initialSlots,
  distribution,
}: {
  initialSlots: QueueSlot[];
  distribution: DistRow[];
}) {
  const router = useRouter();
  const [slots, setSlots] = React.useState<QueueSlot[]>(initialSlots);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  // Default to the servable rotation — the order leads will actually follow.
  // Toggling paused agents back in shows where they sit while skipped.
  const [showPaused, setShowPaused] = React.useState(false);

  const pausedCount = React.useMemo(() => slots.filter((s) => s.isPaused).length, [slots]);
  /**
   * View-only lens. `slots` stays the complete rotation and is what Save posts —
   * filtering must never drop a hidden agent from the persisted list. Drag is
   * disabled while filtered, because dropping a row at a visible index says
   * nothing about where it belongs among the hidden ones.
   */
  const visible = React.useMemo(
    () => (showPaused ? slots : slots.filter((s) => !s.isPaused)),
    [slots, showPaused],
  );
  const filtering = !showPaused && pausedCount > 0;
  /**
   * The slot a lead would actually go to: the first one whose agent isn't
   * paused. The front of the list can be a paused agent, and labelling that row
   * "next up" would be a lie — it gets skipped and moved to the back.
   */
  const nextUpKey = React.useMemo(() => slots.find((s) => !s.isPaused)?.key ?? null, [slots]);

  const dirty = React.useMemo(
    () => slots.map((s) => s.key).join(',') !== initialSlots.map((s) => s.key).join(','),
    [slots, initialSlots],
  );

  function onDragStart(i: number) {
    setDragIndex(i);
  }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) return;
    setSlots((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIndex(i);
  }
  function onDragEnd() {
    setDragIndex(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/queue/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotationList: slots.map((s) => s.agentId) }),
      });
      if (!res.ok) throw new Error();
      setMsg('Queue order saved.');
      router.refresh();
    } catch {
      setMsg('Failed to save. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    setSlots(initialSlots);
    setMsg(null);
  }

  async function rebuild() {
    if (!confirm('Rebuild the rotation from current agent scores? This discards the manual order.')) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/queue/rebuild', { method: 'POST' });
      if (!res.ok) throw new Error();
      setMsg('Queue rebuilt from scores.');
      router.refresh();
    } catch {
      setMsg('Failed to rebuild. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Round-Robin Queue</h1>
          <p className="text-sm text-mute">
            Drag slots to reorder. Agents with higher scores hold more slots.
          </p>
        </div>
        <div className="flex gap-2">
          {dirty ? (
            <>
              <Button onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save Order'}
              </Button>
              <Button variant="secondary" onClick={discard} disabled={busy}>
                Discard
              </Button>
            </>
          ) : null}
          <Button variant="outline" onClick={rebuild} disabled={busy}>
            Rebuild Queue
          </Button>
        </div>
      </div>

      {msg ? (
        <div className="rounded-lg border border-line bg-cream px-4 py-2 text-sm text-charcoal">{msg}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-card border border-line bg-white lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="font-bold text-charcoal">Rotation (expanded slots)</h2>
              <p className="text-xs text-mute-light">
                The highlighted row is next up. {visible.length} slot
                {visible.length === 1 ? '' : 's'} shown
                {pausedCount > 0
                  ? showPaused
                    ? ` · ${pausedCount} paused (skipped when reached)`
                    : ` · ${pausedCount} paused slot${pausedCount === 1 ? '' : 's'} hidden`
                  : ''}
                .
              </p>
            </div>
            {pausedCount > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-mute">
                <input
                  type="checkbox"
                  checked={showPaused}
                  onChange={(e) => setShowPaused(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-platinum-blue"
                />
                Show paused agents
              </label>
            ) : null}
          </div>
          {filtering ? (
            <p className="border-t border-line-hair bg-cream px-5 py-2 text-xs text-mute">
              Reordering is disabled while paused agents are hidden — dropping a row here
              wouldn&apos;t say where it belongs among the hidden slots. Show them to drag.
            </p>
          ) : null}
          <ul>
            {visible.map((s, i) => {
              const isNext = s.key === nextUpKey && !dirty;
              return (
                <li
                  key={s.key}
                  draggable={!filtering}
                  onDragStart={() => !filtering && onDragStart(i)}
                  onDragOver={(e) => !filtering && onDragOver(e, i)}
                  onDragEnd={onDragEnd}
                  className={`flex items-center gap-4 border-t border-line-hair px-5 py-3 ${
                    filtering ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                  } ${isNext ? 'bg-[#EEF3FF]' : s.isPaused ? 'bg-offwhite' : 'bg-white'}`}
                >
                  <span className="w-6 text-center font-numeric text-sm font-bold text-mute-lighter">
                    {i + 1}
                  </span>
                  <span className={`select-none ${filtering ? 'opacity-30' : ''} text-mute-lighter`}>
                    ⋮⋮
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`truncate font-bold ${s.isPaused ? 'text-mute' : 'text-charcoal'}`}>
                        {s.agentName}
                      </p>
                      {isNext ? (
                        <span className="rounded-pill border border-platinum-blue px-2 py-0.5 text-[10px] font-bold uppercase text-platinum-blue">
                          Next up
                        </span>
                      ) : null}
                      {s.isPaused ? (
                        <span className="rounded-pill border border-line bg-offwhite px-2 py-0.5 text-[10px] font-bold uppercase text-mute-light">
                          Paused
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-mute-light">
                      Slot {s.slotIndex} of {s.slotCount} · score {Math.round(s.score)}
                    </p>
                  </div>
                  <Badge tone="neutral">{s.slotCount}×</Badge>
                </li>
              );
            })}
            {visible.length === 0 ? (
              <li className="border-t border-line-hair px-5 py-8 text-center text-sm text-mute">
                {slots.length === 0
                  ? 'No agents in the rotation yet. Agents join when they turn on their own lead routing.'
                  : `No agents are accepting leads — all ${pausedCount} slot${pausedCount === 1 ? ' is' : 's are'} paused.`}
              </li>
            ) : null}
          </ul>
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
            {distribution.length === 0 ? <li className="text-sm text-mute">No data yet.</li> : null}
          </ul>
        </div>
      </div>
    </div>
  );
}
