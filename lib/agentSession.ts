/**
 * Server-side helpers for reading/writing the agent session cookie in
 * Route Handlers and Server Components (Section 9.1).
 */
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import {
  AGENT_SESSION_COOKIE,
  createAgentSession,
  verifyAgentSession,
} from './agentPortalAuth';
import { db } from './db';
import { agents, type Agent } from '../drizzle/schema';

/** Read and verify the agent session cookie; returns the agentId or null. */
export async function getAgentIdFromCookie(): Promise<number | null> {
  const store = await cookies();
  const value = store.get(AGENT_SESSION_COOKIE)?.value;
  return verifyAgentSession(value);
}

/** Load the currently signed-in agent, or null. */
export async function getCurrentAgent(): Promise<Agent | null> {
  const agentId = await getAgentIdFromCookie();
  if (!agentId) return null;
  const rows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const agent = rows[0];
  if (!agent || !agent.isActive) return null;
  return agent;
}

/** Set the signed agent session cookie (httpOnly, 7-day). */
export async function setAgentSessionCookie(agentId: number): Promise<void> {
  const { value, maxAge } = createAgentSession(agentId);
  const store = await cookies();
  store.set(AGENT_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

/** Clear the agent session cookie (logout). */
export async function clearAgentSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(AGENT_SESSION_COOKIE);
}
