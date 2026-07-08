'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { AgentLeadRow, AgentLeadStatus } from '@/lib/agentLeads';

const COLUMNS: { key: AgentLeadStatus; name: string; accent: string; dot: string }[] = [
  { key: 'new', name: 'New', accent: '#0043FF', dot: 'bg-platinum-blue' },
  { key: 'contacted', name: 'Contacted', accent: '#C97A13', dot: 'bg-warning' },
  { key: 'qualified', name: 'Qualified', accent: '#1F7A4A', dot: 'bg-success' },
  { key: 'closed', name: 'Closed', accent: '#232323', dot: 'bg-charcoal' },
];

/**
 * Kanban view of the agent's accepted leads. Dragging a card to another column
 * updates the lead status through the same /api/agent/status-update endpoint the
 * list view uses — no new backend. "Lost" leads are hidden from the board.
 */
export default function PipelineBoard({ initial }: { initial: AgentLeadRow[] }) {
  const [cards, setCards] = React.useState<AgentLeadRow[]>(initial);
  const [dragId, setDragId] = React.useState<number | null>(null);
  const [overCol, setOverCol] = React.useState<AgentLeadStatus | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function moveTo(leadOfferId: number, status: AgentLeadStatus) {
    const current = cards.find((c) => c.leadOfferId === leadOfferId);
    if (!current || current.status === status) return;
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.leadOfferId === leadOfferId ? { ...c, status } : c)));
    setSaving(true);
    try {
      const res = await fetch('/api/agent/status-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadOfferId, newStatus: status }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setCards(prev); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-charcoal">Pipeline</h1>
          <p className="text-sm text-mute">Drag a lead between stages to update its status.</p>
        </div>
        {saving ? <span className="text-xs font-semibold text-mute-light">Saving…</span> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          // Reopened leads (came back after Lost) surface in "New" so the agent
          // re-engages them; "Lost" leads stay hidden from the board.
          const colCards = cards.filter(
            (c) => c.status === col.key || (col.key === 'new' && c.status === 'reopened'),
          );
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== col.key) setOverCol(col.key);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId != null) void moveTo(dragId, col.key);
                setDragId(null);
                setOverCol(null);
              }}
              className={cn(
                'min-w-0 rounded-card p-1 transition-colors',
                overCol === col.key ? 'bg-offwhite' : 'bg-transparent',
              )}
            >
              <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <div className="flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full', col.dot)} />
                  <span className="font-bold text-charcoal">{col.name}</span>
                </div>
                <span className="rounded-pill border border-line bg-white px-2.5 py-0.5 text-xs font-bold text-mute-light">
                  {colCards.length}
                </span>
              </div>

              <div className="flex flex-col gap-2.5">
                {colCards.map((card) => (
                  <div
                    key={card.leadOfferId}
                    draggable
                    onDragStart={() => setDragId(card.leadOfferId)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverCol(null);
                    }}
                    style={{ borderTopColor: col.accent }}
                    className={cn(
                      'cursor-grab rounded-xl border border-line border-t-[3px] bg-white p-4 active:cursor-grabbing',
                      dragId === card.leadOfferId && 'opacity-50',
                    )}
                  >
                    <Link href={`/agent/leads/${card.leadOfferId}`} className="block">
                      <p className="truncate font-bold text-charcoal">{card.name}</p>
                      <p className="truncate text-xs text-mute-light">{card.address ?? '—'}</p>
                    </Link>
                    <div className="mt-3 flex items-center justify-between border-t border-line-hair pt-2.5">
                      <span className="font-numeric text-base font-bold text-charcoal">
                        {card.priceRange ?? '—'}
                      </span>
                      {card.timeframe ? (
                        <span className="truncate text-xs font-semibold text-mute">
                          {card.timeframe}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
                {colCards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-mute-lighter">
                    No leads here
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
