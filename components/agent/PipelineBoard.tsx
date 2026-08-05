'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ALLOWED_TRANSITIONS } from '@/lib/leadLifecycle';
import type { AgentLeadRow, AgentLeadStatus } from '@/lib/agentLeads';

const COLUMNS: { key: AgentLeadStatus; name: string; accent: string; dot: string }[] = [
  { key: 'new', name: 'New', accent: '#0043FF', dot: 'bg-platinum-blue' },
  { key: 'attempted_contact', name: 'Attempted', accent: '#0284C7', dot: 'bg-sky-500' },
  { key: 'connected', name: 'Connected', accent: '#C97A13', dot: 'bg-warning' },
  { key: 'nurturing', name: 'Nurturing', accent: '#7C3AED', dot: 'bg-purple-500' },
  { key: 'appointment_set', name: 'Appt Set', accent: '#0D9488', dot: 'bg-teal-500' },
  { key: 'signed', name: 'Signed', accent: '#1F7A4A', dot: 'bg-success' },
  { key: 'closed', name: 'Closed', accent: '#232323', dot: 'bg-charcoal' },
];

/**
 * Kanban view of the agent's accepted leads. Dragging a card to another column
 * updates the lead status through the same /api/agent/status-update endpoint the
 * list view uses — no new backend. "Lost" leads are hidden from the board, and
 * Lost is deliberately not a column: it needs a stage-scoped reason, which only
 * the lead page can collect.
 *
 * Columns the dragged card cannot legally move to are DIMMED and refuse the
 * drop, from the same `ALLOWED_TRANSITIONS` table the server validates against.
 * Previously every column accepted every card and an illegal move was reverted
 * with no explanation at all — the card just sprang back, which reads as a
 * broken app rather than a rule. The server is still the authority; the dimming
 * only stops the mistake being made.
 */
export default function PipelineBoard({ initial }: { initial: AgentLeadRow[] }) {
  const [cards, setCards] = React.useState<AgentLeadRow[]>(initial);
  const [dragId, setDragId] = React.useState<number | null>(null);
  const [overCol, setOverCol] = React.useState<AgentLeadStatus | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const draggedCard = dragId != null ? cards.find((c) => c.leadOfferId === dragId) ?? null : null;

  /** Can the card being dragged legally land in this column? */
  function canDropIn(col: AgentLeadStatus): boolean {
    if (!draggedCard) return true;
    return (ALLOWED_TRANSITIONS[draggedCard.status] ?? []).includes(col);
  }

  /** Is this the column the dragged card already sits in? */
  function isHomeColumn(col: AgentLeadStatus): boolean {
    if (!draggedCard) return false;
    return draggedCard.status === col || (col === 'new' && draggedCard.status === 'reopened');
  }

  async function moveTo(leadOfferId: number, status: AgentLeadStatus) {
    const current = cards.find((c) => c.leadOfferId === leadOfferId);
    // Dropping a card back where it started is a cancelled drag, not an update.
    // (Logging a no-change update is a real action — it lives on the lead page
    // and in the SMS commands, where it is explicit rather than a stray gesture.)
    if (!current || current.status === status) return;
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.leadOfferId === leadOfferId ? { ...c, status } : c)));
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/status-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadOfferId, newStatus: status }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setCards(prev); // revert
        setError(
          data?.error === 'invalid_transition'
            ? "That move isn't allowed from the stage the lead is in now."
            : data?.error === 'offer_not_found'
              ? 'That lead is no longer active.'
              : 'Could not save that move. Please try again.',
        );
      }
    } catch {
      setCards(prev); // revert on failure
      setError('Could not save that move — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-charcoal">Pipeline</h1>
          <p className="text-sm text-mute">
            Drag a lead between stages to update its status. Stages it can&apos;t move to are
            greyed out while you drag. To mark one <span className="font-semibold">Lost</span>,
            open the lead — it needs a reason.
          </p>
        </div>
        {saving ? <span className="text-xs font-semibold text-mute-light">Saving…</span> : null}
      </div>

      {error ? (
        <div
          role="status"
          className="flex items-start justify-between gap-4 rounded-card border border-platinum-red/30 bg-danger-bg px-4 py-3"
        >
          <p className="text-sm font-semibold text-platinum-red">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-xs font-semibold text-platinum-red/70 hover:text-platinum-red"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        {COLUMNS.map((col) => {
          // Reopened leads (came back after Lost) surface in "New" so the agent
          // re-engages them; "Lost" leads stay hidden from the board.
          const colCards = cards.filter(
            (c) => c.status === col.key || (col.key === 'new' && c.status === 'reopened'),
          );
          const dragging = draggedCard != null;
          const droppable = canDropIn(col.key);
          const home = isHomeColumn(col.key);
          // Dim only real dead ends — the card's own column isn't a wrong
          // answer, it's where the card already is.
          const blocked = dragging && !droppable && !home;

          return (
            <div
              key={col.key}
              aria-disabled={blocked || undefined}
              onDragOver={(e) => {
                // Not calling preventDefault is what makes the browser show a
                // "no drop" cursor and suppress the drop event entirely.
                if (!droppable) return;
                e.preventDefault();
                if (overCol !== col.key) setOverCol(col.key);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (droppable && dragId != null) void moveTo(dragId, col.key);
                setDragId(null);
                setOverCol(null);
              }}
              className={cn(
                'min-w-0 rounded-card p-1 transition-all',
                overCol === col.key ? 'bg-offwhite' : 'bg-transparent',
                blocked && 'pointer-events-none opacity-35 grayscale',
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
