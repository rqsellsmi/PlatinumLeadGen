import { redirect } from 'next/navigation';
import { getCurrentAgent } from '@/lib/agentSession';

export const dynamic = 'force-dynamic';

/**
 * Agent help / "how it works" guide. A static, scannable explainer of how leads
 * are routed, how the four score tracks work, how points are earned and lost,
 * the lead pipeline, and the update clock. Numbers here mirror the live engine
 * (`lib/scoring.ts`, `lib/offerActions.ts`, `lib/statusUpdates.ts`,
 * `lib/autoOffer.ts`, `lib/scoreTiers.ts`) — keep them in sync if the engine
 * changes.
 */
export default async function AgentHelpPage() {
  const agent = await getCurrentAgent();
  if (!agent) redirect('/agent/login');

  return (
    <div className="space-y-8">
      {/* Intro */}
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-platinum-red">
          Agent guide
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-charcoal sm:text-3xl">
          How the lead system works
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-mute">
          Everything that decides which leads reach you, and how your score and
          queue standing move. Skim the cards — the numbers are exactly what the
          system uses.
        </p>
      </header>

      {/* Jump links */}
      <nav className="flex flex-wrap gap-2">
        {[
          ['#queue', 'Getting leads'],
          ['#scores', 'Your 4 scores'],
          ['#slots', 'Queue slots'],
          ['#points', 'Earning points'],
          ['#pipeline', 'The pipeline'],
          ['#clock', 'Update clock'],
          ['#availability', 'Availability'],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="rounded-pill border border-line bg-white px-3 py-1.5 text-xs font-semibold text-charcoal transition-colors hover:border-charcoal/30"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* 1 — How you get leads (the queue) */}
      <Section id="queue" kicker="Step 1" title="How you get leads">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StepCard n={1} title="A seller asks for a home value">
            Someone requests a valuation on one of our sites. That creates a new
            lead with the property location.
          </StepCard>
          <StepCard n={2} title="We find who's nearby">
            Only agents whose <strong>coverage area covers that home</strong>{' '}
            are eligible — your area is your office (or a custom city) plus the
            radius you set in <span className="font-semibold">Settings</span>.
          </StepCard>
          <StepCard n={3} title="The queue picks the next agent">
            Among eligible agents we go in queue order and offer it to the one
            whose turn is next. More <span className="font-semibold">Queue Score</span>{' '}
            = more turns (see below).
          </StepCard>
          <StepCard n={4} title="You get 3 hours to accept">
            You&apos;re notified by email (and text, if enabled). Accept to claim
            the lead; if you don&apos;t respond within{' '}
            <strong>3 hours</strong> it moves to the next agent.
          </StepCard>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FactCard title="Fair rotation">
            When you&apos;re offered a lead you move to the back of the line. If
            you&apos;re skipped only because a lead was outside your area, you{' '}
            <strong>keep your spot</strong> — a distance skip never costs you a turn.
          </FactCard>
          <FactCard title="Sending hours">
            Offers send <strong>7am–8pm ET</strong>. A lead that comes in
            overnight waits and goes out first thing at 7am.
          </FactCard>
          <FactCard title="No lead cap">
            There&apos;s no limit on how many active leads you can hold — staying
            responsive is what keeps offers coming.
          </FactCard>
        </div>

        <Callout tone="blue" title="New-agent head start">
          The first time you switch yourself <strong>Available</strong>, you get a
          one-time <strong>+50 Queue Score</strong> so you start with real
          standing in the rotation instead of at the very back. It only affects
          your queue slots (not the leaderboards or your tier) and fades away over
          the following year.
        </Callout>
      </Section>

      {/* 2 — The four scores */}
      <Section id="scores" kicker="Step 2" title="Your four scores">
        <p className="-mt-1 mb-1 max-w-2xl text-sm text-mute">
          You have four scores and they each do a different job. Don&apos;t expect
          them to match — they count different windows of time.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ScoreCard
            name="Queue Score"
            window="Last 365 days"
            drives="How many queue slots (turns) you get"
            note="This is the one that decides how often leads reach you. Points age out after a year, so recent activity matters most."
            hero
          />
          <ScoreCard
            name="Tier"
            window="Lifetime, vs. the team"
            drives="Your standing badge — Top Performer down to At Risk"
            note="A percentile ranking against other active agents. It never resets."
          />
          <ScoreCard
            name="This Month"
            window="Resets the 1st"
            drives="The monthly leaderboard"
          />
          <ScoreCard
            name="Year to Date"
            window="Resets Jan 1"
            drives="The YTD leaderboard"
          />
        </div>
        <div className="mt-3 rounded-card border border-line bg-white p-4">
          <p className="text-sm font-bold text-charcoal">Tiers, best to worst</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <TierChip className="text-green-700">Top Performer</TierChip>
            <TierChip className="text-green-600">Strong</TierChip>
            <TierChip className="text-blue-600">Good Standing</TierChip>
            <TierChip className="text-amber-600">Average</TierChip>
            <TierChip className="text-orange-600">Needs Improvement</TierChip>
            <TierChip className="text-red-600">At Risk</TierChip>
          </div>
          <p className="mt-2 text-xs text-mute-light">
            Top Performer is the top 10% of active agents by lifetime score; At
            Risk is the bottom 10%.
          </p>
        </div>
      </Section>

      {/* 3 — Queue Score → slots */}
      <Section id="slots" kicker="Step 3" title="Queue Score turns into queue slots">
        <p className="-mt-1 mb-1 max-w-2xl text-sm text-mute">
          Every slot is another turn in the rotation, so more Queue Score means
          leads reach you more often. Slots step up on this curve:
        </p>
        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-hair bg-line-hair/40 text-left">
                <th className="px-4 py-2.5 font-semibold text-mute">Queue Score</th>
                <th className="px-4 py-2.5 font-semibold text-mute">Slots (turns)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hair">
              {[
                ['0 – 9', '1 slot'],
                ['10 – 39', '2 slots'],
                ['40 – 89', '3 slots'],
                ['90 – 159', '4 slots'],
                ['160 – 249', '5 slots'],
                ['250+', '6+ slots'],
              ].map(([range, slots]) => (
                <tr key={range}>
                  <td className="px-4 py-2.5 font-numeric text-charcoal">{range}</td>
                  <td className="px-4 py-2.5 font-semibold text-charcoal">{slots}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-mute-light">
          Your live Queue Score, current slots, and progress to the next slot are
          on your dashboard and Performance page.
        </p>
      </Section>

      {/* 4 — Earning & losing points */}
      <Section id="points" kicker="Step 4" title="How you earn & lose points">
        <p className="-mt-1 mb-1 max-w-2xl text-sm text-mute">
          Every point below counts toward all four scores at once. Speed early
          and moving leads forward is where the points are.
        </p>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <PointGroup
            title="Responding to an offer"
            sub="How fast you accept after we send it"
          >
            <PointRow label="Accept in under 15 min" delta="+4" />
            <PointRow label="Accept in 15–30 min" delta="+3" />
            <PointRow label="Accept in 30–60 min" delta="+2" />
            <PointRow label="Accept in 1–3 hrs" delta="+1" />
            <PointRow label="Decline the lead" delta="−3" />
            <PointRow
              label="No response"
              sub="Offer expires after 3 hrs — ties the lead up, so it costs the most"
              delta="−4"
            />
          </PointGroup>

          <PointGroup
            title="Fast-engagement bonus"
            sub="One-time per lead. The timer starts the moment you accept — you earn it by logging your first update (moving the lead to Attempted contact or Connected)."
          >
            <PointRow label="First update within 15 min of accepting" delta="+4" />
            <PointRow label="Within 15–30 min" delta="+3" />
            <PointRow label="Within 30–60 min" delta="+2" />
            <PointRow label="Within 1–3 hrs" delta="+1" />
            <PointRow label="After 3 hrs — no bonus" delta="0" />
          </PointGroup>

          <PointGroup
            title="Moving the lead forward"
            sub="Each milestone pays once per lead"
          >
            <PointRow label="Attempted contact" delta="+1" />
            <PointRow label="Connected" delta="+2" />
            <PointRow label="Nurturing" delta="0" />
            <PointRow label="Appointment set" delta="+4" />
            <PointRow label="Signed listing" delta="+10" />
            <PointRow label="Closed — won" sub="The big one" delta="+25" />
            <PointRow label="Lost" delta="0" />
          </PointGroup>

          <PointGroup title="Keeping leads updated" sub="See the update clock below">
            <PointRow
              label="Missed update check-in"
              sub="Repeats each cycle until you log an update"
              delta="−2"
            />
          </PointGroup>
        </div>

        <Callout tone="amber" title="You can't farm milestones">
          Each milestone (Attempted, Connected, Appointment, Signed) pays{' '}
          <strong>once per lead</strong>. Moving a lead backward and forward
          won&apos;t re-pay it — so update honestly and focus on new progress.
        </Callout>
      </Section>

      {/* 5 — The pipeline */}
      <Section id="pipeline" kicker="Step 5" title="The lead pipeline">
        <p className="-mt-1 mb-1 max-w-2xl text-sm text-mute">
          As you work a lead, move it through these stages on the lead page. The
          stage you set is what the system scores.
        </p>
        <div className="rounded-card border border-line bg-white p-4">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {PIPELINE.map((s, i) => (
              <span key={s.name} className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-offwhite px-3 py-1.5 text-xs font-bold text-charcoal">
                  <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                  {s.name}
                </span>
                {i < PIPELINE.length - 1 ? (
                  <span aria-hidden className="text-mute-lighter">
                    ›
                  </span>
                ) : null}
              </span>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MiniFact label="Lost" tone="red">
              Didn&apos;t work out. Pick the reason that fits — no points, no
              penalty.
            </MiniFact>
            <MiniFact label="Reopened" tone="blue">
              A past Lost seller comes back and resubmits. The lead reopens like
              new and the clock restarts — you keep any milestones you already
              earned.
            </MiniFact>
          </div>
        </div>
      </Section>

      {/* 6 — The update clock */}
      <Section id="clock" kicker="Step 6" title="The update clock">
        <p className="-mt-1 mb-1 max-w-2xl text-sm text-mute">
          One simple rule keeps leads from going cold: log an update before the
          clock runs out. Any status change or note counts as an update and
          resets it.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ClockCard when="24 hours" label="After you accept">
            Make first contact (or log an attempt) within a day.
          </ClockCard>
          <ClockCard when="Every 7 days" label="While you're working it">
            Each update buys another week before the next check-in.
          </ClockCard>
          <ClockCard when="Every 14 days" label="Once it's Signed">
            More breathing room once a listing is signed.
          </ClockCard>
          <ClockCard when="Clock stops" label="At Closed or Lost">
            Finished leads don&apos;t need updates.
          </ClockCard>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Callout tone="blue" title="You'll get a heads-up" compact>
            A reminder email goes out about <strong>24 hours before</strong> a
            check-in is due, so a missed update is avoidable.
          </Callout>
          <Callout tone="amber" title="Miss it and it's −2" compact>
            Blowing the deadline is <strong>−2</strong>, and it repeats each cycle
            until you log an update. Small, but it adds up.
          </Callout>
        </div>
      </Section>

      {/* 7 — Availability */}
      <Section id="availability" kicker="Step 7" title="Available vs. Paused">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-card border border-success/30 bg-success-bg p-5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-success" />
              <p className="font-bold text-charcoal">Available</p>
            </div>
            <p className="mt-2 text-sm text-mute">
              You&apos;re in the rotation and receive new lead offers. Your
              current leads are unaffected either way.
            </p>
          </div>
          <div className="rounded-card border border-line bg-white p-5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-mute-lighter" />
              <p className="font-bold text-charcoal">Paused</p>
            </div>
            <p className="mt-2 text-sm text-mute">
              You keep every lead you already have but get{' '}
              <strong>no new offers</strong> until you switch back on. Good for
              vacations or a full plate.
            </p>
          </div>
        </div>
        <p className="text-xs text-mute-light">
          Toggle it any time from your dashboard or{' '}
          <span className="font-semibold">Settings</span>, where you also set your
          coverage area and radius.
        </p>
      </Section>

      <p className="border-t border-line-hair pt-6 text-center text-xs text-mute-light">
        Questions the guide doesn&apos;t answer? Reach out to your broker or the
        Platinum admin team.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Presentational helpers (server-rendered, no client JS)             */
/* ------------------------------------------------------------------ */

const PIPELINE = [
  { name: 'New', dot: 'bg-platinum-blue' },
  { name: 'Attempted', dot: 'bg-sky-500' },
  { name: 'Connected', dot: 'bg-warning' },
  { name: 'Nurturing', dot: 'bg-purple-500' },
  { name: 'Appt Set', dot: 'bg-teal-500' },
  { name: 'Signed', dot: 'bg-success' },
  { name: 'Closed', dot: 'bg-charcoal' },
];

function Section({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-platinum-blue">
          {kicker}
        </p>
        <h2 className="text-lg font-bold text-charcoal sm:text-xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function StepCard({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-charcoal font-numeric text-sm font-bold text-white">
          {n}
        </span>
        <p className="font-bold text-charcoal">{title}</p>
      </div>
      <p className="mt-2 text-sm text-mute">{children}</p>
    </div>
  );
}

function FactCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card bg-cream p-4">
      <p className="text-sm font-bold text-charcoal">{title}</p>
      <p className="mt-1 text-sm text-mute">{children}</p>
    </div>
  );
}

function ScoreCard({
  name,
  window,
  drives,
  note,
  hero = false,
}: {
  name: string;
  window: string;
  drives: string;
  note?: string;
  hero?: boolean;
}) {
  return (
    <div
      className={`rounded-card border p-5 ${
        hero ? 'border-platinum-blue/40 bg-platinum-blue/[0.04]' : 'border-line bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-charcoal">{name}</p>
        <span className="rounded-pill bg-line-hair px-2.5 py-1 text-[11px] font-semibold text-mute">
          {window}
        </span>
      </div>
      <p className="mt-2 text-sm text-charcoal">
        <span className="text-mute">Drives:</span> {drives}
      </p>
      {note ? <p className="mt-1.5 text-xs text-mute-light">{note}</p> : null}
    </div>
  );
}

function TierChip({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={`rounded-pill border border-line bg-white px-3 py-1 text-xs font-bold ${className}`}
    >
      {children}
    </span>
  );
}

function PointGroup({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-white">
      <div className="border-b border-line-hair px-4 py-3">
        <p className="text-sm font-bold text-charcoal">{title}</p>
        {sub ? <p className="text-xs text-mute-light">{sub}</p> : null}
      </div>
      <ul className="divide-y divide-line-hair px-4">{children}</ul>
    </div>
  );
}

function PointRow({ label, sub, delta }: { label: string; sub?: string; delta: string }) {
  const isZero = delta === '0';
  const isNeg = delta.startsWith('−') || delta.startsWith('-');
  const cls = isZero
    ? 'bg-line-hair text-mute'
    : isNeg
      ? 'bg-danger-bg text-platinum-red'
      : 'bg-success-bg text-success';
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-charcoal">{label}</p>
        {sub ? <p className="text-xs text-mute-light">{sub}</p> : null}
      </div>
      <span
        className={`inline-flex min-w-[3rem] shrink-0 justify-center rounded-pill px-2.5 py-1 font-numeric text-sm font-bold ${cls}`}
      >
        {delta}
      </span>
    </li>
  );
}

function MiniFact({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'red' | 'blue';
  children: React.ReactNode;
}) {
  const dot = tone === 'red' ? 'bg-platinum-red' : 'bg-platinum-blue';
  return (
    <div className="rounded-lg bg-offwhite p-3">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <p className="text-sm font-bold text-charcoal">{label}</p>
      </div>
      <p className="mt-1 text-xs text-mute">{children}</p>
    </div>
  );
}

function ClockCard({
  when,
  label,
  children,
}: {
  when: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="font-numeric text-lg font-bold text-charcoal">{when}</p>
      <p className="text-xs font-semibold uppercase tracking-[0.04em] text-platinum-blue">
        {label}
      </p>
      <p className="mt-1.5 text-sm text-mute">{children}</p>
    </div>
  );
}

function Callout({
  tone,
  title,
  children,
  compact = false,
}: {
  tone: 'blue' | 'amber';
  title: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const styles =
    tone === 'blue'
      ? 'border-platinum-blue/30 bg-platinum-blue/[0.05]'
      : 'border-warning/30 bg-warning-bg';
  return (
    <div className={`rounded-card border p-4 ${styles} ${compact ? '' : 'mt-3'}`}>
      <p className="text-sm font-bold text-charcoal">{title}</p>
      <p className="mt-1 text-sm text-mute">{children}</p>
    </div>
  );
}
