/**
 * Per-agent account invites and the one-time Launch send (decision D7, review
 * #17/#70).
 *
 * Replaces the shared brokerage setup code. An invite is unique to one agent,
 * single-use, expiring, hashed at rest, and delivered only to the address on
 * the roster — so completing setup proves control of that inbox.
 *
 * Relative imports only (lessons-learned §17).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { agents, notificationSettings } from '../drizzle/schema';
import { generateInviteToken, inviteExpiry, hashToken } from './agentPortalAuth';
import { sendEmail, agentInviteEmail } from './email';
import { siteUrl } from './siteUrl';

/** Build the URL an invited agent follows to choose a password. */
export function inviteUrl(token: string): string {
  return `${siteUrl()}/agent/set-password?token=${token}`;
}

/**
 * Mint and email an invite to one agent. Supersedes any outstanding invite for
 * them, so re-sending is always safe. Returns whether the email went out.
 */
export async function sendAgentInvite(agentId: number): Promise<boolean> {
  const rows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const agent = rows[0];
  if (!agent) return false;
  // An agent who already has a password does not need an invite, and issuing
  // one would create a redeemable credential for a live account.
  if (agent.passwordHash) return false;
  if (!agent.isActive) return false;

  const token = generateInviteToken();
  const now = new Date();
  await db
    .update(agents)
    .set({
      inviteTokenHash: hashToken(token),
      inviteExpiresAt: inviteExpiry(now),
      inviteSentAt: now,
      updatedAt: now,
    })
    .where(eq(agents.id, agentId));

  const res = await sendEmail(
    agentInviteEmail({
      to: agent.email,
      agentName: agent.firstName,
      inviteUrl: inviteUrl(token),
      relatedAgentId: agent.id,
    }),
  );
  return res.ok;
}

export interface LaunchResult {
  ok: boolean;
  /** Set when the one-time guard already fired. */
  alreadySent?: Date;
  invited: number;
  skipped: number;
  failed: number;
}

/**
 * The one-time Launch send (D7).
 *
 * Emails a unique invite to every ACTIVE agent who has no password yet, and
 * sets them unavailable so availability is opt-in from day one. Skips anyone
 * already set up.
 *
 * Guarded by `notification_settings.launch_invites_sent_at`: without it, a
 * second click would mass-re-email the whole roster — the kind of mistake that
 * is obvious in hindsight and expensive in trust. `force` exists for the case
 * where the first run genuinely failed and the admin needs to retry.
 */
export async function runLaunchInvites(opts: { force?: boolean } = {}): Promise<LaunchResult> {
  const settingsRows = await db.select().from(notificationSettings).limit(1);
  const settings = settingsRows[0];
  if (settings?.launchInvitesSentAt && !opts.force) {
    return {
      ok: false,
      alreadySent: settings.launchInvitesSentAt,
      invited: 0,
      skipped: 0,
      failed: 0,
    };
  }

  // Active agents with no password yet. Anyone already set up is skipped, so a
  // re-run after a partial failure does not disturb working accounts.
  const pending = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.isActive, true), isNull(agents.passwordHash)));

  let invited = 0;
  let failed = 0;
  for (const a of pending) {
    try {
      if (await sendAgentInvite(a.id)) invited++;
      else failed++;
    } catch (err) {
      console.error(`[agentInvites] invite failed for agent ${a.id}:`, err);
      failed++;
    }
  }

  // Availability becomes opt-in (D7): agents are active but not in the queue
  // until they choose to be. Applied to the whole active roster, not just the
  // invited ones, so the lifecycle model is consistent from launch.
  await db.update(agents).set({ isAvailable: false, updatedAt: new Date() }).where(eq(agents.isActive, true));

  const now = new Date();
  if (settings) {
    await db
      .update(notificationSettings)
      .set({ launchInvitesSentAt: now, updatedAt: now })
      .where(eq(notificationSettings.id, settings.id));
  } else {
    await db.insert(notificationSettings).values({ launchInvitesSentAt: now });
  }

  const skipped = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    .where(and(eq(agents.isActive, true), sql`${agents.passwordHash} is not null`));

  return { ok: true, invited, skipped: skipped[0]?.n ?? 0, failed };
}
