'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, statusTone } from '@/components/ui';
import { cn } from '@/lib/utils';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'closed' | 'lost';

export interface AgentLeadItem {
  leadOfferId: number;
  name: string;
  address: string | null;
  status: LeadStatus;
  priceRange: string | null;
  timeframe: string | null;
  agoLabel: string | null;
  daysSinceAccepted: number | null;
}

export interface AgentKpi {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'danger' | 'success';
}

const TABS: { key: LeadStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'closed', label: 'Closed' },
  { key: 'lost', label: 'Lost' },
];

const kpiToneClass: Record<string, string> = {
  neutral: 'text-charcoal',
  danger: 'text-platinum-red',
  success: 'text-success',
};

export default function AgentDashboard({
  greeting,
  subline,
  kpis,
  items,
}: {
  greeting: string;
  subline: string;
  kpis: AgentKpi[];
  items: AgentLeadItem[];
}) {
  const [order, setOrder] = useState<AgentLeadItem[]>(items);
  const [tab, setTab] = useState<LeadStatus | 'all'>('all');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const newLeads = useMemo(() => order.filter((i) => i.status === 'new'), [order]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: order.length };
    for (const i of order) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [order]);
  const filtered = tab === 'all' ? order : order.filter((i) => i.status === tab);

  async function persist(next: AgentLeadItem[]) {
    try {
      await fetch('/api/agent/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map((i) => i.leadOfferId) }),
      });
    } catch {
      /* optimistic */
    }
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...order];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    setOrder(next);
    setDragIndex(null);
    setOverIndex(null);
    void persist(next);
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">{greeting}</h1>
        <p className="text-sm text-mute">{subline}</p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-card border border-line bg-white px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
              {k.label}
            </p>
            <p className={cn('mt-2 font-numeric text-[38px] font-bold leading-none', kpiToneClass[k.tone ?? 'neutral'])}>
              {k.value}
            </p>
            {k.sub ? <p className="mt-1.5 text-xs text-mute-light">{k.sub}</p> : null}
          </div>
        ))}
      </div>

      {/* New leads to contact */}
      {newLeads.length > 0 && (
        <div className="rounded-card border border-platinum-red/20 bg-danger-bg/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-platinum-red" aria-hidden>
              ⚠
            </span>
            <h2 className="font-bold text-charcoal">New leads to contact</h2>
            <span className="rounded-pill bg-white px-2 py-0.5 text-[11px] font-bold text-platinum-red">
              {newLeads.length} waiting
            </span>
          </div>
          <ul className="space-y-2.5">
            {newLeads.map((l) => (
              <li
                key={l.leadOfferId}
                className="flex items-center gap-3 rounded-card border border-line bg-white px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <Link href={`/agent/leads/${l.leadOfferId}`} className="font-bold text-charcoal hover:underline">
                    {l.name}
                  </Link>
                  <p className="truncate text-sm text-mute-light">
                    {l.address ?? '—'}
                    {l.timeframe ? ` · wants to sell ${l.timeframe}` : ''}
                  </p>
                </div>
                {l.agoLabel ? <span className="text-xs text-mute-light">{l.agoLabel}</span> : null}
                <Link
                  href={`/agent/leads/${l.leadOfferId}`}
                  className="rounded-pill bg-platinum-red px-4 py-2 text-[13px] font-bold text-white hover:bg-platinum-redHover"
                >
                  Log call
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-pill px-4 py-1.5 text-sm font-bold',
              tab === t.key
                ? 'bg-charcoal text-white'
                : 'border border-line text-charcoal hover:bg-offwhite',
            )}
          >
            {t.label} {counts[t.key] ?? 0}
          </button>
        ))}
      </div>

      {/* Lead list (drag to reorder) */}
      {filtered.length === 0 ? (
        <div className="rounded-card border border-line bg-white px-5 py-10 text-center text-sm text-mute">
          No leads in this view.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((item) => {
            const index = order.indexOf(item);
            return (
              <li
                key={item.leadOfferId}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overIndex !== index) setOverIndex(index);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(index);
                }}
                className={cn(
                  'rounded-card border border-line bg-white transition-shadow',
                  dragIndex === index && 'opacity-50',
                  overIndex === index && dragIndex !== index && 'ring-2 ring-platinum-blue',
                )}
              >
                <div className="grid grid-cols-[24px_1fr_auto] items-center gap-4 px-4 py-3.5 sm:grid-cols-[24px_1.7fr_1fr_1fr_auto]">
                  <span className="cursor-grab select-none text-mute-lighter active:cursor-grabbing" aria-hidden title="Drag to reorder">
                    ⠿
                  </span>
                  <Link href={`/agent/leads/${item.leadOfferId}`} className="min-w-0">
                    <p className="truncate font-bold text-charcoal">{item.name}</p>
                    <p className="truncate text-sm text-mute-light">{item.address ?? '—'}</p>
                  </Link>
                  <span className="hidden font-numeric text-lg font-bold text-charcoal sm:block">
                    {item.priceRange ?? ''}
                  </span>
                  <span className="hidden truncate text-sm font-semibold text-mute sm:block">
                    {item.timeframe ?? ''}
                  </span>
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
