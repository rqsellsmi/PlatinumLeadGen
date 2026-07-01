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
  pointer,
  distribution,
}: {
  initialSlots: QueueSlot[];
  pointer: number;
  distribution: DistRow[];
}) {
  const router = useRouter();
  const [slots, setSlots] = React.useState<QueueSlot[]>(initialSlots);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

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
          <div className="px-5 py-4">
            <h2 className="font-bold text-charcoal">Rotation (expanded slots)</h2>
            <p className="text-xs text-mute-light">
              The highlighted row is next up. {slots.length} total slots.
            </p>
          </div>
          <ul>
            {slots.map((s, i) => {
              const isNext = i === pointer && !dirty;
              return (
                <li
                  key={s.key}
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={(e) => onDragOver(e, i)}
                  onDragEnd={onDragEnd}
                  className={`flex cursor-grab items-center gap-4 border-t border-line-hair px-5 py-3 active:cursor-grabbing ${
                    isNext ? 'bg-[#EEF3FF]' : 'bg-white'
                  }`}
                >
                  <span className="w-6 text-center font-numeric text-sm font-bold text-mute-lighter">
                    {i + 1}
                  </span>
                  <span className="select-none text-mute-lighter">⋮⋮</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-bold text-charcoal">{s.agentName}</p>
                      {isNext ? (
                        <span className="rounded-pill border border-platinum-blue px-2 py-0.5 text-[10px] font-bold uppercase text-platinum-blue">
                          Next up
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
            {slots.length === 0 ? (
              <li className="border-t border-line-hair px-5 py-8 text-center text-sm text-mute">
                No routable agents. Activate agents and ensure they are available.
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
