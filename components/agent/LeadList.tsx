'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'closed' | 'lost' | 'reopened';

export interface LeadListItem {
  leadOfferId: number;
  name: string;
  address: string | null;
  status: LeadStatus;
  daysSinceAccepted: number | null;
}

const statusStyles: Record<LeadStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  contacted: 'bg-amber-100 text-amber-800',
  qualified: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-200 text-slate-700',
  lost: 'bg-red-100 text-brand-red',
  reopened: 'bg-purple-100 text-purple-800',
};

function daysLabel(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function LeadList({ items }: { items: LeadListItem[] }) {
  const [order, setOrder] = useState<LeadListItem[]>(items);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  async function persist(next: LeadListItem[]) {
    setSaving(true);
    try {
      await fetch('/api/agent/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map((i) => i.leadOfferId) }),
      });
    } catch {
      // Best-effort; order state is already updated optimistically.
    } finally {
      setSaving(false);
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
    <div>
      {saving && <p className="mb-2 text-xs text-slate-400">Saving order…</p>}
      <ul className="space-y-3">
        {order.map((item, index) => (
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
              'transition-opacity',
              dragIndex === index && 'opacity-50',
              overIndex === index && dragIndex !== index && 'ring-2 ring-brand-blue rounded-lg',
            )}
          >
            <Card className="hover:border-brand-blue">
              <div className="flex items-center gap-3 p-4">
                <span
                  className="cursor-grab select-none text-slate-300 active:cursor-grabbing"
                  aria-hidden
                  title="Drag to reorder"
                >
                  ⠿
                </span>
                <Link
                  href={`/agent/leads/${item.leadOfferId}`}
                  className="flex flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{item.name}</p>
                    <p className="truncate text-sm text-slate-500">{item.address || '—'}</p>
                  </div>
                  <div className="flex items-center gap-3 sm:justify-end">
                    <Badge className={cn('capitalize', statusStyles[item.status])}>
                      {item.status}
                    </Badge>
                    <span className="whitespace-nowrap text-xs text-slate-400">
                      {daysLabel(item.daysSinceAccepted)}
                    </span>
                  </div>
                </Link>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
