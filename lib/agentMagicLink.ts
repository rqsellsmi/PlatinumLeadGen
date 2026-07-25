/**
 * Build a magic-link URL that signs the agent in and (optionally) lands them on
 * a specific portal page — so links texted/emailed to an agent don't force a
 * manual login. Reuses the agent's current magic-link token when it's still
 * valid (mirroring the offer email in lib/autoOffer.ts, so earlier links keep
 * working) and only mints a new one when missing/expired.
 *
 * The `next` path is carried as a query param the login page redirects to after
 * a successful token login; the login page validates it (agent-portal paths
 * only) to prevent an open redirect.
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { agents } from '../drizzle/schema';
import { generateMagicLinkToken, magicLinkExpiry, isTokenExpired } from './agentPortalAuth';
import { siteUrl } from './siteUrl';

export async function buildAgentMagicLink(
  agent: { id: number; magicLinkToken: string | null; magicLinkExpiresAt: Date | null },
  nextPath?: string,
): Promise<string> {
  const now = new Date();
  let token = agent.magicLinkToken;
  if (!token || isTokenExpired(agent.magicLinkExpiresAt, now)) {
    token = generateMagicLinkToken();
    await db
      .update(agents)
      .set({ magicLinkToken: token, magicLinkExpiresAt: magicLinkExpiry(now), updatedAt: now })
      .where(eq(agents.id, agent.id));
  }
  const base = `${siteUrl()}/agent/login?token=${token}`;
  return nextPath ? `${base}&next=${encodeURIComponent(nextPath)}` : base;
}
