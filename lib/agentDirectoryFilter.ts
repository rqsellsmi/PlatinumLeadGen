/**
 * Pure filter for the admin agent directory (shared logic, unit-tested).
 *
 * Key rule: a text search spans the ENTIRE roster. The status tab (which
 * defaults to "Active only") narrows results only while browsing with no
 * query, so searching a name always finds the agent — including one who has
 * been deactivated, which the default active-only view would otherwise hide.
 * That was the "search doesn't work" bug: you couldn't find a deactivated
 * agent by name (e.g. to re-activate them) because the default filter dropped
 * them before the text match ran.
 */
export type AgentStatusFilter = 'all' | 'active' | 'inactive';

export interface FilterableAgent {
  firstName: string | null;
  lastName: string | null;
  email: string;
  officeName: string | null;
  officeCity: string | null;
  isActive: boolean;
}

export function agentFullName(
  a: Pick<FilterableAgent, 'firstName' | 'lastName' | 'email'>,
): string {
  return `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.email;
}

export function filterAgents<T extends FilterableAgent>(
  agents: T[],
  opts: { search: string; office: string; status: AgentStatusFilter },
): T[] {
  const q = opts.search.trim().toLowerCase();
  return agents.filter((a) => {
    // Status tab applies only when there's no active search (browse mode). A
    // query searches everyone so a deactivated agent is still findable by name.
    if (!q) {
      if (opts.status === 'active' && !a.isActive) return false;
      if (opts.status === 'inactive' && a.isActive) return false;
    }
    // The office dropdown is an explicit choice, so it's always respected.
    if (opts.office && a.officeName !== opts.office) return false;
    if (q) {
      const hay =
        `${agentFullName(a)} ${a.email} ${a.officeName ?? ''} ${a.officeCity ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
