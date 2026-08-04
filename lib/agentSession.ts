/**
 * Server-side helpers for reading/writing the agent session cookie in
 * Route Handlers and Server Components (Section 9.1).
 *
 * This module holds the AUTHORITATIVE session check (review #18). The signed
 * cookie proves authenticity and freshness; only a database read can prove the
 * session has not been revoked, so `getCurrentAgent()` compares the cookie's
 * `sessionVersion` against the agent's current one and re-checks `isActive`.
 */
import { cookies } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import {
  AGENT_SESSION_COOKIE,
  createAgentSession,
  verifyAgentSession,
  type AgentSessionClaims,
} from './agentPortalAuth';
import { db } from './db';
import { agents, type Agent } from '../drizzle/schema';

/**
 * Read and verify the agent session cookie's signature and expiry.
 *
 * Returns claims, NOT an authenticated agent — the revocation check has not run
 * yet. Callers that need an authenticated agent must use `getCurrentAgent()`.
 */
export async function getAgentSessionClaims(): Promise<AgentSessionClaims | null> {
  const store = await cookies();
  const value = store.get(AGENT_SESSION_COOKIE)?.value;
  return verifyAgentSession(value);
}

/** Read the agent id from a cryptographically valid cookie (no revocation check). */
export async function getAgentIdFromCookie(): Promise<number | null> {
  return (await getAgentSessionClaims())?.agentId ?? null;
}

/**
 * Load the currently signed-in agent, or null.
 *
 * Three gates, all required:
 *   1. the cookie is authentic and unexpired (checked above),
 *   2. the agent is still active,
 *   3. the cookie's session version still matches the agent's.
 *
 * (3) is what makes a session revocable. A password reset, a deactivation, or
 * an admin "sign out everywhere" bumps `agents.session_version`, and every
 * outstanding cookie for that agent stops authenticating on its next request —
 * including one minted from a leaked 14-day magic link.
 */
export async function getCurrentAgent(): Promise<Agent | null> {
  const claims = await getAgentSessionClaims();
  if (!claims) return null;
  const rows = await db.select().from(agents).where(eq(agents.id, claims.agentId)).limit(1);
  const agent = rows[0];
  if (!agent || !agent.isActive) return null;
  if ((agent.sessionVersion ?? 0) !== claims.sessionVersion) return null; // revoked
  return agent;
}

/**
 * Set the signed agent session cookie (httpOnly, 7-day).
 *
 * Reads the agent's current session version so the cookie is minted against it;
 * a later bump then invalidates this cookie along with all the others.
 */
export async function setAgentSessionCookie(agentId: number): Promise<void> {
  let sessionVersion = 0;
  try {
    const rows = await db
      .select({ v: agents.sessionVersion })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    sessionVersion = rows[0]?.v ?? 0;
  } catch (err) {
    // A cookie minted against the wrong version simply fails the revocation
    // check on the next request, so failing open here costs a re-login at
    // worst — it can never grant access.
    console.error('[agentSession] could not read sessionVersion:', err);
  }
  const { value, maxAge } = createAgentSession(agentId, sessionVersion);
  const store = await cookies();
  store.set(AGENT_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

/** Clear the agent session cookie (logout on this device). */
export async function clearAgentSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(AGENT_SESSION_COOKIE);
}

/**
 * Revoke EVERY session for an agent, everywhere (review #18).
 *
 * Called on password reset, on deactivation, and from the admin when a link or
 * device is believed compromised. Also clears the magic link, so a leaked URL
 * cannot simply mint a fresh session immediately afterwards — revoking sessions
 * while leaving a working 14-day login link would be theatre.
 */
export async function revokeAgentSessions(agentId: number): Promise<void> {
  await db
    .update(agents)
    .set({
      sessionVersion: sql`${agents.sessionVersion} + 1`,
      magicLinkToken: null,
      magicLinkTokenHash: null,
      magicLinkExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));
}
