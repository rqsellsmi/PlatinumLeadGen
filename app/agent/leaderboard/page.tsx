import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';

export const dynamic = 'force-dynamic';

const TOP_N = 20;

interface Row {
  id: number;
  name: string;
  score: number;
  rank: number;
}

function rank(list: { id: number; name: string; score: number }[]): Row[] {
  return [...list]
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function Board({
  title,
  subtitle,
  rows,
  meId,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  meId: number;
}) {
  const top = rows.slice(0, TOP_N);
  const me = rows.find((r) => r.id === meId) ?? null;
  const meInTop = me != null && me.rank <= TOP_N;
  const percentile = me && rows.length > 0 ? Math.round(((rows.length - me.rank + 1) / rows.length) * 100) : null;

  return (
    <div className="rounded-card border border-line bg-white">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-bold text-charcoal">{title}</h2>
        <p className="text-xs text-mute-light">{subtitle}</p>
      </div>
      <ol className="divide-y divide-line-hair">
        {top.map((r) => (
          <li
            key={r.id}
            className={`flex items-center gap-3 px-5 py-2.5 text-sm ${
              r.id === meId ? 'bg-[#EEF3FF] font-semibold' : ''
            }`}
          >
            <span className="w-6 text-right font-numeric text-mute-light">{r.rank}</span>
            <span className="flex-1 truncate text-charcoal">
              {r.name}
              {r.id === meId ? ' (you)' : ''}
            </span>
            <span className="font-numeric font-bold text-charcoal">{Math.round(r.score)}</span>
          </li>
        ))}
        {top.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-mute">No scores yet this period.</li>
        ) : null}
      </ol>
      {me && !meInTop ? (
        <div className="flex items-center gap-3 border-t border-line bg-offwhite px-5 py-2.5 text-sm font-semibold">
          <span className="w-6 text-right font-numeric text-mute-light">{me.rank}</span>
          <span className="flex-1 truncate text-charcoal">{me.name} (you)</span>
          <span className="font-numeric font-bold text-charcoal">{Math.round(me.score)}</span>
        </div>
      ) : null}
      {me ? (
        <div className="border-t border-line px-5 py-2.5 text-xs text-mute-light">
          Your rank: <span className="font-semibold text-charcoal">#{me.rank}</span> of {rows.length}
          {percentile != null ? ` · top ${100 - percentile + 1}%` : ''}
        </div>
      ) : null}
    </div>
  );
}

export default async function LeaderboardPage() {
  const me = await getCurrentAgent();
  if (!me) redirect('/agent/login');

  const rows = await db
    .select({
      id: agents.id,
      first: agents.firstName,
      last: agents.lastName,
      monthly: agents.scoreMonthly,
      ytd: agents.scoreYtd,
    })
    .from(agents)
    .where(eq(agents.isActive, true))
    .orderBy(desc(agents.scoreMonthly));

  const named = rows.map((r) => ({
    id: r.id,
    name: [r.first, r.last].filter(Boolean).join(' ') || `Agent #${r.id}`,
  }));
  const byId = new Map(named.map((n) => [n.id, n.name]));

  const monthly = rank(rows.map((r) => ({ id: r.id, name: byId.get(r.id)!, score: r.monthly ?? 0 })));
  const ytd = rank(rows.map((r) => ({ id: r.id, name: byId.get(r.id)!, score: r.ytd ?? 0 })));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Leaderboard</h1>
        <p className="text-sm text-mute">
          Where you stand this month and this year. Your lifetime score and tier are private —
          see them on your Performance page.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Board title="This month" subtitle="Resets on the 1st" rows={monthly} meId={me.id} />
        <Board title="Year to date" subtitle="Resets Jan 1" rows={ytd} meId={me.id} />
      </div>
    </div>
  );
}
