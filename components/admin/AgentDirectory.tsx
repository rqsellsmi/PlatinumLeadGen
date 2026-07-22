'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button, Input, Select, Badge } from '@/components/ui';
import { toggleAgentActive, toggleAgentAvailable } from '@/app/admin/agents/actions';

export interface AgentRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  officeName: string | null;
  officeCity: string | null;
  isActive: boolean;
  /** Self/admin availability — receiving new leads (independent of isActive). */
  isAvailable: boolean;
  score: number;
  /** Cohort-relative tier (computed server-side from lifetime percentiles). */
  tierLabel: string;
  tierColor: string;
  activeLeads: number;
  /** null = no accepted offers yet (shown as —). */
  conversionPct: number | null;
  /** avg accept latency in minutes; null = no data. */
  avgResponseMins: number | null;
}

const AVATAR_BG = ['bg-platinum-blue', 'bg-platinum-red', 'bg-charcoal', 'bg-brandpurple', 'bg-success'];

function initials(first: string | null, last: string | null): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';
}
function fullName(a: AgentRow): string {
  return `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.email;
}
function fmtConversion(p: number | null): string {
  return p == null ? '—' : `${p}%`;
}
function fmtResponse(m: number | null): string {
  if (m == null) return '—';
  return m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 60)}h`;
}

type SortKey = 'default' | 'name' | 'score' | 'activeLeads' | 'conversion' | 'response';
type StatusFilter = 'all' | 'active' | 'inactive';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'default', label: 'Default (available first)' },
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'score', label: 'Score (high→low)' },
  { key: 'activeLeads', label: 'Active leads (high→low)' },
  { key: 'conversion', label: 'Conversion (high→low)' },
  { key: 'response', label: 'Response (fast→slow)' },
];

export default function AgentDirectory({ agents }: { agents: AgentRow[] }) {
  const [view, setView] = React.useState<'tiles' | 'list'>('tiles');
  const [search, setSearch] = React.useState('');
  const [office, setOffice] = React.useState('');
  // Default view: active roster only (leavers are deactivated), available first.
  const [status, setStatus] = React.useState<StatusFilter>('active');
  const [sort, setSort] = React.useState<SortKey>('default');

  const offices = React.useMemo(
    () => Array.from(new Set(agents.map((a) => a.officeName).filter(Boolean))).sort() as string[],
    [agents],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = agents.filter((a) => {
      if (status === 'active' && !a.isActive) return false;
      if (status === 'inactive' && a.isActive) return false;
      if (office && a.officeName !== office) return false;
      if (q) {
        const hay = `${fullName(a)} ${a.email} ${a.officeName ?? ''} ${a.officeCity ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const byName = (a: AgentRow, b: AgentRow) =>
      fullName(a).localeCompare(fullName(b), 'en', { sensitivity: 'base' });

    const sorted = [...list];
    switch (sort) {
      case 'name':
        sorted.sort(byName);
        break;
      case 'score':
        sorted.sort((a, b) => b.score - a.score || byName(a, b));
        break;
      case 'activeLeads':
        sorted.sort((a, b) => b.activeLeads - a.activeLeads || byName(a, b));
        break;
      case 'conversion':
        sorted.sort((a, b) => (b.conversionPct ?? -1) - (a.conversionPct ?? -1) || byName(a, b));
        break;
      case 'response':
        sorted.sort(
          (a, b) => (a.avgResponseMins ?? Infinity) - (b.avgResponseMins ?? Infinity) || byName(a, b),
        );
        break;
      default: // available first, then active, then name
        sorted.sort(
          (a, b) =>
            Number(b.isAvailable) - Number(a.isAvailable) ||
            Number(b.isActive) - Number(a.isActive) ||
            byName(a, b),
        );
    }
    return sorted;
  }, [agents, search, office, status, sort]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-white p-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, office…"
          aria-label="Search agents"
          className="w-full sm:w-64"
        />
        <Select value={office} onChange={(e) => setOffice(e.target.value)} aria-label="Filter by office">
          <option value="">All offices</option>
          {offices.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
        <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-line">
          <button
            type="button"
            onClick={() => setView('tiles')}
            className={`px-3 py-1.5 text-sm font-semibold ${view === 'tiles' ? 'bg-charcoal text-white' : 'bg-white text-charcoal hover:bg-offwhite'}`}
          >
            Tiles
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={`px-3 py-1.5 text-sm font-semibold ${view === 'list' ? 'bg-charcoal text-white' : 'bg-white text-charcoal hover:bg-offwhite'}`}
          >
            List
          </button>
        </div>
      </div>

      <p className="text-sm text-mute">
        {filtered.length} of {agents.length} agents
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-card border border-line bg-white px-5 py-12 text-center text-sm text-mute">
          No agents match your filters.
        </div>
      ) : view === 'tiles' ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((agent, i) => {
            const tier = { label: agent.tierLabel, color: agent.tierColor };
            return (
              <div key={agent.id} className="rounded-card border border-line bg-white p-5">
                <div className="flex items-center gap-3.5">
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${AVATAR_BG[i % AVATAR_BG.length]}`}
                  >
                    {initials(agent.firstName, agent.lastName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/agents/${agent.id}`}
                      className="block truncate font-bold text-charcoal hover:text-platinum-red"
                    >
                      {fullName(agent)}
                    </Link>
                    <p className="truncate text-[13px] text-mute-light">
                      {[agent.officeName, agent.officeCity].filter(Boolean).join(' · ') || agent.email}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={agent.isActive ? 'success' : 'neutral'}>
                      {agent.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {agent.isActive && (
                      <Badge tone={agent.isAvailable ? 'success' : 'warning'}>
                        {agent.isAvailable ? 'Available' : 'Paused'}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  <Metric value={String(agent.activeLeads)} label="Active leads" />
                  <Metric value={fmtConversion(agent.conversionPct)} label="Conversion" tone="success" />
                  <Metric value={fmtResponse(agent.avgResponseMins)} label="Avg response" />
                </div>

                <p className="mt-3 text-xs text-mute-light">
                  Score <span className="font-bold text-charcoal">{Math.round(agent.score)}</span> ·{' '}
                  <span className={`font-bold ${tier.color}`}>{tier.label}</span>
                </p>

                <div className="mt-4 space-y-2.5">
                  <form action={toggleAgentAvailable}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <input type="hidden" name="isAvailable" value={String(agent.isAvailable)} />
                    <Button
                      type="submit"
                      size="sm"
                      variant={agent.isAvailable ? 'outline' : 'primary'}
                      className="w-full"
                    >
                      {agent.isAvailable ? 'Pause new leads' : 'Resume new leads'}
                    </Button>
                  </form>
                  <div className="flex gap-2.5">
                    <form action={toggleAgentActive} className="flex-1">
                      <input type="hidden" name="agentId" value={agent.id} />
                      <input type="hidden" name="isActive" value={String(agent.isActive)} />
                      <Button type="submit" size="sm" variant="outline" className="w-full">
                        {agent.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </form>
                    <Link href={`/admin/agents/${agent.id}`} className="flex-1">
                      <Button type="button" variant="secondary" size="sm" className="w-full">
                        View profile
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-charcoal text-white">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Agent</th>
                <th className="px-4 py-2.5 text-left font-semibold">Office</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Score</th>
                <th className="px-4 py-2.5 text-right font-semibold">Active</th>
                <th className="px-4 py-2.5 text-right font-semibold">Conv.</th>
                <th className="px-4 py-2.5 text-right font-semibold">Response</th>
                <th className="px-4 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hair">
              {filtered.map((agent) => {
                const tier = { label: agent.tierLabel, color: agent.tierColor };
                return (
                  <tr key={agent.id} className="hover:bg-offwhite">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/agents/${agent.id}`}
                        className="font-semibold text-charcoal hover:text-platinum-red"
                      >
                        {fullName(agent)}
                      </Link>
                      <div className="text-xs text-mute-light">{agent.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-mute">
                      {[agent.officeName, agent.officeCity].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={agent.isActive ? 'success' : 'neutral'}>
                          {agent.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        {agent.isActive && (
                          <Badge tone={agent.isAvailable ? 'success' : 'warning'}>
                            {agent.isAvailable ? 'Available' : 'Paused'}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-numeric">
                      {Math.round(agent.score)}
                      <span className={`ml-1.5 text-xs font-bold ${tier.color}`}>{tier.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-numeric">{agent.activeLeads}</td>
                    <td className="px-4 py-2.5 text-right font-numeric">
                      {fmtConversion(agent.conversionPct)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-numeric">
                      {fmtResponse(agent.avgResponseMins)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-2">
                        <form action={toggleAgentAvailable}>
                          <input type="hidden" name="agentId" value={agent.id} />
                          <input type="hidden" name="isAvailable" value={String(agent.isAvailable)} />
                          <Button
                            type="submit"
                            size="sm"
                            variant={agent.isAvailable ? 'outline' : 'primary'}
                          >
                            {agent.isAvailable ? 'Pause' : 'Resume'}
                          </Button>
                        </form>
                        <form action={toggleAgentActive}>
                          <input type="hidden" name="agentId" value={agent.id} />
                          <input type="hidden" name="isActive" value={String(agent.isActive)} />
                          <Button type="submit" size="sm" variant="outline">
                            {agent.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        </form>
                        <Link href={`/admin/agents/${agent.id}`}>
                          <Button type="button" size="sm" variant="secondary">
                            View
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metric({ value, label, tone }: { value: string; label: string; tone?: 'success' }) {
  return (
    <div className="rounded-lg bg-offwhite p-3">
      <p
        className={`font-numeric text-2xl font-bold leading-none ${tone === 'success' ? 'text-success' : 'text-charcoal'}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-mute-light">{label}</p>
    </div>
  );
}
