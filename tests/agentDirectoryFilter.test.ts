import { describe, it, expect } from 'vitest';
import { filterAgents, agentFullName, type FilterableAgent } from '../lib/agentDirectoryFilter';

const AGENTS: FilterableAgent[] = [
  { firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com', officeName: 'Brighton', officeCity: 'Brighton', isActive: true },
  { firstName: 'John', lastName: 'Smith', email: 'john@x.com', officeName: 'Howell', officeCity: 'Howell', isActive: false },
  { firstName: 'Amy', lastName: 'Adams', email: 'amy@x.com', officeName: 'Brighton', officeCity: 'Brighton', isActive: true },
];

const names = (list: FilterableAgent[]) => list.map(agentFullName);

describe('filterAgents', () => {
  it('matches by name, email, office, and city (case-insensitive)', () => {
    expect(names(filterAgents(AGENTS, { search: 'jane', office: '', status: 'all' }))).toEqual(['Jane Doe']);
    expect(names(filterAgents(AGENTS, { search: 'AMY@X', office: '', status: 'all' }))).toEqual(['Amy Adams']);
    expect(names(filterAgents(AGENTS, { search: 'brighton', office: '', status: 'all' }))).toEqual(['Jane Doe', 'Amy Adams']);
  });

  it('finds a DEACTIVATED agent by name even under the default active-only tab', () => {
    // The regression: John is inactive; searching his name from the default
    // "active" tab must still find him (search spans the whole roster).
    expect(names(filterAgents(AGENTS, { search: 'john', office: '', status: 'active' }))).toEqual(['John Smith']);
  });

  it('applies the status tab only when browsing (no search query)', () => {
    expect(names(filterAgents(AGENTS, { search: '', office: '', status: 'active' }))).toEqual(['Jane Doe', 'Amy Adams']);
    expect(names(filterAgents(AGENTS, { search: '', office: '', status: 'inactive' }))).toEqual(['John Smith']);
    expect(filterAgents(AGENTS, { search: '', office: '', status: 'all' })).toHaveLength(3);
  });

  it('respects an explicit office selection alongside a search', () => {
    expect(names(filterAgents(AGENTS, { search: 'a', office: 'Brighton', status: 'all' }))).toEqual(['Jane Doe', 'Amy Adams']);
  });

  it('returns everything for an empty query on the "all" tab', () => {
    expect(filterAgents(AGENTS, { search: '   ', office: '', status: 'all' })).toHaveLength(3);
  });
});
