/**
 * Build a magic-link URL that signs the agent in and (optionally) lands them on
 * a specific portal page — so links texted/emailed to an agent don't force a
 * manual login.
 *
 * P0.8a / D6: the token is now stored only as a SHA-256 HASH. The raw value
 * exists in the message that was sent and nowhere else, so reading the database
 * row no longer yields a working login.
 *
 * That has one unavoidable consequence, and it is the right trade: because we
 * no longer hold the plaintext, we cannot re-send an agent's CURRENT link. Each
 * new outbound message therefore mints a fresh token, which supersedes the
 * previous one. Older links stop working sooner than they used to — and an
 * expired or superseded link lands on the "request a new link / sign in with
 * password" page rather than a dead error (D6), so the agent is never stuck.
 *
 * The `next` path is carried as a query param the login page redirects to after
 * a successful token login; the login page validates it (agent-portal paths
 * only) to prevent an open redirect.
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { agents } from '../drizzle/schema';
import { generateMagicLinkToken, magicLinkExpiry, hashToken } from './agentPortalAuth';
import { siteUrl } from './siteUrl';

/**
 * Mint a fresh magic-link token for an agent, persist only its hash, and return
 * the raw token for the caller to put in exactly one outbound message.
 */
export async function issueMagicLinkToken(agentId: number): Promise<string> {
  const now = new Date();
  const token = generateMagicLinkToken();
  await db
    .update(agents)
    .set({
      magicLinkTokenHash: hashToken(token),
      // Clear any legacy plaintext token still on the row; the hash is now the
      // only lookup key, and leaving the old value would keep a readable
      // credential in the database.
      magicLinkToken: null,
      magicLinkExpiresAt: magicLinkExpiry(now),
      updatedAt: now,
    })
    .where(eq(agents.id, agentId));
  return token;
}

export async function buildAgentMagicLink(
  agent: { id: number },
  nextPath?: string,
): Promise<string> {
  const token = await issueMagicLinkToken(agent.id);
  const base = `${siteUrl()}/agent/login?token=${token}`;
  return nextPath ? `${base}&next=${encodeURIComponent(nextPath)}` : base;
}
