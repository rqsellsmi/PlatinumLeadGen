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
          system uses. One thing to know up front:{' '}
          <a href="#availability" className="font-semibold text-charcoal underline">
            each lead is a 30% referral back to RE/MAX Platinum
          </a>
          , and turning on your availability is how you accept that.
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
          ['#texting', 'Texting'],
          ['#availability', 'Availability & referral'],
          ['#signin', 'Signing in'],
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
            You&apos;re notified by email (and text, if enabled). Tap{' '}
            <strong>Accept</strong> and it claims the lead, signs you in, and
            drops you straight on the lead page with the seller&apos;s details —
            no password, no extra taps. By text, just reply{' '}
            <strong>YES</strong>. If you don&apos;t respond within{' '}
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

        <Callout tone="blue" title="Leads nobody covers go to the office" compact>
          If a home falls outside <em>every</em> agent&apos;s radius, it is{' '}
          <strong>never</strong> handed to whoever happens to be least far away.
          It goes to the admin, who will look for an agent willing to cover that
          area. Same for anything outside Michigan. So a wider radius isn&apos;t
          needed to &ldquo;catch&rdquo; distant leads — set yours to the area you
          genuinely want to drive to.
        </Callout>

        <Callout tone="amber" title="You join the line by turning yourself Available">
          Until you flip that switch for the first time you are{' '}
          <strong>not in the rotation at all</strong> — no leads are offered to
          you. Turning it on is what puts you in line, and{' '}
          <strong>the order people turn it on is the order of the line</strong>.
          Someone who activates today sits ahead of someone who activates next
          week. Nothing else moves you up, so if you intend to take leads, do this
          first.
        </Callout>

        <Callout tone="blue" title="New-agent head start">
          The first time you switch yourself <strong>Available</strong>, you get a
          one-time <strong>+50 Queue Score</strong> — enough for{' '}
          <strong>3 slots</strong> instead of 1, so you get three turns per lap
          from day one. Your first turn comes once everyone already in the
          rotation has had one, and your three slots are spread through the line
          rather than bunched together. The credit only affects your queue slots
          (not the leaderboards or your tier) and fades away over the following
          year.
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
            note="This is the one that decides how often leads reach you. Points age out after a year, so recent activity matters most — including your +50 head start, which drops off about a year after you activate."
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
        <Callout tone="blue" title="What these look like when you start" compact>
          Your <strong>Queue Score is 50</strong> the moment you go Available —
          that&apos;s the head start, and it&apos;s worth 3 slots. <strong>This
          Month</strong> and <strong>Year to Date</strong> both start at{' '}
          <strong>0</strong>; the head start deliberately doesn&apos;t touch them,
          so nobody starts a leaderboard ahead of anyone else. Your{' '}
          <strong>Tier</strong> compares lifetime scores, and every agent begins
          from the same baseline — so until points are earned the whole roster
          sits mid-pack at <strong>Good Standing</strong>. That&apos;s a starting
          position, not a grade.
        </Callout>

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
            Risk is the bottom 10%. These are <strong>relative</strong> — they
            rank you against the other agents, not against a fixed target, so the
            bands always stay filled no matter how well everyone is doing. On a
            small team a single closing can move you several bands.
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
            <PointRow
              label="Update with no stage change"
              sub="Always free — checking in on a lead that hasn't moved never costs you"
              delta="0"
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
          stage you set is what the system scores. You can also log an update
          <em> without</em> changing the stage — that&apos;s the normal way to
          check in on a lead that&apos;s sitting still.
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
              penalty. A brand-new lead has to be moved to{' '}
              <strong>Attempted contact</strong> first; Lost opens up straight
              after, with bad number / wrong number / email bounced as reasons.
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
          clock runs out. Open the lead, hit{' '}
          <span className="font-semibold">Save update</span>, and the clock
          resets.
        </p>
        <Callout tone="blue" title="You don't have to move the lead" compact>
          The stage box already defaults to{' '}
          <strong>where the lead is now</strong>, so a check-in on a lead that
          hasn&apos;t moved takes no clicks — add a note if you have one, or just
          save. A seller you nurture for months only needs a periodic update, not
          a fake stage change. By text, send the stage word on its own —{' '}
          <span className="font-semibold">NURTURE 1234</span> — and it stays put
          and counts.
        </Callout>
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

      {/* 6b — Texting */}
      <Section id="texting" kicker="Step 7" title="Working leads by text">
        <p className="-mt-1 mb-1 max-w-2xl text-sm text-mute">
          If you have a mobile number on file, new offers and update reminders
          also come by text — and you can do almost everything by replying. You
          never have to open the portal to claim a lead or log an update.
        </p>

        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-hair bg-line-hair/40 text-left">
                <th className="px-4 py-2.5 font-semibold text-mute">To do this</th>
                <th className="px-4 py-2.5 font-semibold text-mute">Reply with</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hair">
              {[
                ['Take the lead', 'YES', 'also Y, ACCEPT'],
                ['Pass on it', 'NO', 'also N, PASS, DECLINE'],
                ['Log an attempt', 'LEFT VM 1234', 'also CALLED, NO ANSWER, ATTEMPTED CONTACT'],
                ['You spoke with them', 'CONNECTED 1234', 'also SPOKE, CONTACTED, MADE CONTACT'],
                ['Still working it, no change', 'NURTURE 1234', 'resets your update clock'],
                ['Appointment booked', 'APPT SET 1234', 'also APPOINTMENT SET'],
                ['Listing signed', 'SIGNED 1234', 'also LISTING SIGNED'],
                ['Closed and won', 'CLOSED 1234', 'also CLOSED WON'],
                ['Stop all texts', 'STOP', 'START to turn them back on'],
                ['See the command list', 'HELP', ''],
              ].map(([what, cmd, alt]) => (
                <tr key={what}>
                  <td className="px-4 py-2.5 text-charcoal">{what}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono font-bold text-charcoal">{cmd}</span>
                    {alt ? <span className="ml-2 text-xs text-mute-light">{alt}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FactCard title="Add a note">
            Anything after the lead number is saved as your note —{' '}
            <span className="font-mono text-[13px]">CONNECTED 1234 wants to list in spring</span>.
          </FactCard>
          <FactCard title="The lead number">
            <strong>YES</strong> and <strong>NO</strong> don&apos;t need one when
            you only have one open offer. Status updates need it as soon as
            you&apos;re working more than one lead — it&apos;s in every text we
            send you.
          </FactCard>
          <FactCard title="Marking one Lost">
            The only thing you can&apos;t do by text. Lost needs a reason that
            fits the stage, so we&apos;ll point you to the lead page to pick one.
          </FactCard>
        </div>

        <Callout tone="amber" title="STOP only stops texts" compact>
          Replying <strong>STOP</strong> opts you out of every text from us,
          including lead offers — but <strong>email keeps coming</strong>, and
          your leads and queue position are unaffected. Reply{' '}
          <strong>START</strong> any time to turn texts back on.
        </Callout>
      </Section>

      {/* 8 — Availability */}
      <Section id="availability" kicker="Step 8" title="Availability & the referral">
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

        {/* The commercial term. Deliberately the most prominent block on the
            page — turning availability on IS the acceptance, and the wording
            matches the invite email and the toggle panel verbatim so there is
            one statement of what was agreed, not three paraphrases. */}
        <div className="rounded-card border-2 border-charcoal bg-charcoal p-5 text-white">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-mute-lighter">
            Referral terms
          </p>
          <p className="mt-2 text-base leading-relaxed">
            Each lead generated by the system is a{' '}
            <strong className="font-bold">30% referral back to RE/MAX Platinum</strong>. By
            turning on your availability you are agreeing to this referral.
          </p>

          <dl className="mt-4 space-y-3 border-t border-white/15 pt-4">
            <Term label="How much">
              <strong className="font-bold text-white">30% of the gross commission</strong> on
              the deal.
            </Term>
            <Term label="When it's owed">
              <strong className="font-bold text-white">At closing.</strong> A lead that never
              closes owes nothing.
            </Term>
            <Term label="How many deals">
              Up to <strong className="font-bold text-white">two per client</strong>. The first
              deal always carries the referral. A second one does too — a listing then a
              purchase, or a purchase then a listing —{' '}
              <strong className="font-bold text-white">
                only if it closes within one year of the first
              </strong>
              . Past two deals, or a second deal more than a year later, no referral is due.
            </Term>
            <Term label="Desk fees">
              <strong className="font-bold text-white">No desk fee</strong> is taken out of a
              deal that pays a referral. The referral amount does{' '}
              <strong className="font-bold text-white">not</strong> count toward your desk fee
              cap.
            </Term>
          </dl>

          <div className="mt-4 rounded-lg bg-white/5 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-mute-lighter">
              Example
            </p>
            <p className="mt-1 text-sm leading-relaxed text-white/85">
              You list Sarah&apos;s home and it closes in March — that deal pays the referral.
              She buys through you in September: within the year, so that one pays it too.
              Had she instead bought two years later, only the March listing would have paid.
            </p>
          </div>

          <p className="mt-4 text-xs text-mute-lighter">
            The one-line term is shown again next to the switch itself. We record the date you
            first turn it on. Pausing later doesn&apos;t withdraw the agreement — it applies to
            leads the system sends you. Questions on how a specific deal is treated go to your
            broker.
          </p>
        </div>

        <Callout tone="blue" title="Pausing doesn't cost you your place" compact>
          You keep your slots and your standing the whole time. If one of your
          turns comes up while you&apos;re paused you simply forfeit{' '}
          <strong>that turn</strong> — it passes to the next agent and yours
          rotates around as normal. Pause for a day and if your turn never comes
          up, it costs you nothing at all. Switching back on doesn&apos;t move you
          forward either, so there&apos;s no advantage to toggling.
        </Callout>
        <p className="text-xs text-mute-light">
          Toggle it any time from your dashboard or{' '}
          <span className="font-semibold">Settings</span>, where you also set your
          coverage area and radius.
        </p>
      </Section>

      {/* 9 — Signing in */}
      <Section id="signin" kicker="Reference" title="Signing in">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-card border border-line bg-white p-4">
            <p className="font-bold text-charcoal">The first time</p>
            <p className="mt-1.5 text-sm text-mute">
              The office emails you a setup link that is{' '}
              <strong>personal to you</strong> — it works once and expires after{' '}
              <strong>7 days</strong>. Open it and choose a password. There&apos;s
              no shared code, so if the link has expired or been used, ask the
              office to send a new one.
            </p>
          </div>
          <div className="rounded-card border border-line bg-white p-4">
            <p className="font-bold text-charcoal">After that</p>
            <p className="mt-1.5 text-sm text-mute">
              Email and password on the sign-in page. Forgot it? Enter your email
              there and we&apos;ll send a reset link good for{' '}
              <strong>2 hours</strong> — it goes to your address on file, so only
              you can use it.
            </p>
          </div>
        </div>

        <Callout tone="amber" title="Links in your lead emails and texts sign you in" compact>
          Tapping <strong>Accept</strong>, or a lead link in a text, signs you in
          and opens the lead — no password needed. That means those links are{' '}
          <strong>as good as your password</strong>: don&apos;t forward them.
          Each new message replaces the link in the last one, so always use your
          most recent email or text — an older link will have stopped working.
          Once signed in you stay signed in on that device for{' '}
          <strong>7 days</strong>.
        </Callout>
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

/** A labelled term inside the dark referral block. */
function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sm:flex sm:gap-4">
      <dt className="shrink-0 text-xs font-bold uppercase tracking-[0.06em] text-mute-lighter sm:w-36 sm:pt-0.5">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm leading-relaxed text-white/85 sm:mt-0">{children}</dd>
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
