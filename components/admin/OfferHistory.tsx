'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Select, statusTone } from '@/components/ui';

export interface OfferHistoryItem {
  id: number;
  agentId: number;
  agentName: string;
  status: string;
  offerSentAt: string | null;
  respondedAt: string | null;
  createdAt: string | null;
}

export interface AgentOption {
  id: number;
  name: string;
  city: string | null;
  isAvailable: boolean;
}

function rel(date: string | null): string {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function responseTime(o: OfferHistoryItem): string {
  if (!o.offerSentAt || !o.respondedAt) return '';
  const mins = Math.round((new Date(o.respondedAt).getTime() - new Date(o.offerSentAt).getTime()) / 60000);
  if (mins < 60) return `in ${mins}m`;
  return `in ${Math.round(mins / 60)}h`;
}

function label(o: OfferHistoryItem): { line2: string; tone: ReturnType<typeof statusTone> } {
  switch (o.status) {
    case 'accepted':
      return { line2: `Accepted ${responseTime(o)}`, tone: 'success' };
    case 'declined':
      return { line2: `Declined ${responseTime(o)}`, tone: 'neutral' };
    case 'expired':
      return { line2: 'No response — expired after 3 hours', tone: 'danger' };
    case 'closed_manual':
      return { line2: 'Manually reassigned by admin', tone: 'neutral' };
    default:
      return { line2: `Awaiting response · ${rel(o.offerSentAt ?? o.createdAt)}`, tone: 'warning' };
  }
}

const dotColors: Record<string, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-platinum-red',
  neutral: 'bg-mute-lighter',
};

export default function OfferHistory({
  leadId,
  offers,
  agents,
}: {
  leadId: number;
  offers: OfferHistoryItem[];
  agents: AgentOption[];
}) {
  const router = useRouter();
  const [showPicker, setShowPicker] = React.useState(false);
  const [selected, setSelected] = React.useState<number | ''>('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const accepted = [...offers].reverse().find((o) => o.status === 'accepted');
  const mostRecent = offers[offers.length - 1];

  let assignedLine: string;
  if (accepted) assignedLine = `Currently assigned to ${accepted.agentName}`;
  else if (mostRecent?.status === 'closed_manual')
    assignedLine = 'Currently unassigned — manually closed';
  else if (mostRecent && (mostRecent.status === 'declined' || mostRecent.status === 'expired'))
    assignedLine = 'Currently unassigned — awaiting next offer';
  else assignedLine = 'Currently unassigned';

  const outstanding = offers.find((o) => o.status === 'offered');
  const selectedAgent = agents.find((a) => a.id === selected);

  async function confirm() {
    if (selected === '') return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selected }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Reassignment failed.');
      setShowPicker(false);
      setSelected('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reassignment failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Currently-assigned indicator + reassign control (Section 17.4 / 18.2) */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card bg-offwhite px-4 py-3">
        <div className="flex items-center gap-3">
          {accepted ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-platinum-blue text-xs font-bold text-white">
              {accepted.agentName.slice(0, 2).toUpperCase()}
            </span>
          ) : null}
          <span className="text-sm font-semibold text-charcoal">{assignedLine}</span>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setShowPicker((s) => !s)}>
          Reassign
        </Button>
      </div>

      {showPicker && (
        <div className="mb-5 animate-fadeIn rounded-card border border-line p-4">
          <label className="mb-1.5 block text-sm font-semibold text-charcoal">
            Assign directly to an agent
          </label>
          <Select value={selected} onChange={(e) => setSelected(Number(e.target.value) || '')}>
            <option value="">— choose an agent —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.city ? ` · ${a.city}` : ''}
                {!a.isAvailable ? ' (paused)' : ''}
              </option>
            ))}
          </Select>

          {selectedAgent && !selectedAgent.isAvailable && (
            <p className="mt-2 text-xs text-warning">
              {selectedAgent.name} has paused their own lead routing — admin assignment still works.
            </p>
          )}
          {outstanding && selected !== '' && outstanding.agentId !== selected && (
            <p className="mt-2 text-xs text-platinum-red">
              {outstanding.agentName}&apos;s current offer will be closed and they will no longer be
              able to accept this lead.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-platinum-red">{error}</p>}

          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={confirm} disabled={selected === '' || busy}>
              {busy ? 'Assigning…' : 'Confirm Reassignment'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowPicker(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Timeline (Section 17.3) */}
      {offers.length === 0 ? (
        <p className="text-sm text-mute">No offers yet.</p>
      ) : (
        <ol className="relative space-y-5 border-l border-line pl-6">
          {offers.map((o) => {
            const l = label(o);
            return (
              <li key={o.id} className="relative">
                <span
                  className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ${dotColors[l.tone] ?? 'bg-mute-lighter'}`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-charcoal">
                    Offered to {o.agentName}
                  </span>
                  <Badge tone={statusTone(o.status)}>{o.status.replace('_', ' ')}</Badge>
                  <span className="text-xs text-mute-light">{rel(o.createdAt)}</span>
                </div>
                <p className="text-sm text-mute">{l.line2}</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
