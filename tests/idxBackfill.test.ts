import { describe, it, expect } from 'vitest';
import { activeBackfillJobs } from '../lib/idxSync';

describe('activeBackfillJobs (two-pass photo fetch)', () => {
  const jobs = activeBackfillJobs();

  it('is a feed-wide primary pass then an Active/UC gallery pass', () => {
    expect(jobs.map((j) => j.key)).toEqual(['active', 'active-galleries']);
    expect(jobs[0].galleries).toBe(false);
    expect(jobs[1].galleries).toBe(true);
  });

  it('primary pass fetches only the top photo; gallery pass fetches all', () => {
    const primary = jobs[0].buildParams(null);
    const gallery = jobs[1].buildParams(null);
    expect(primary.$expand).toContain('$top=1');
    expect(gallery.$expand).not.toContain('$top=1');
    // The gallery pass only targets gallery-eligible statuses.
    expect(gallery.$filter).toContain('ActiveUnderContract');
    // Both order by ModificationTimestamp so a partial run resumes without gaps.
    expect(primary.$orderby).toBe('ModificationTimestamp');
    expect(gallery.$orderby).toBe('ModificationTimestamp');
  });

  it('resumes inclusively from a checkpoint (ge), fresh run is exclusive (gt)', () => {
    expect(jobs[0].buildParams(null).$filter).toContain('ModificationTimestamp gt');
    const resumed = jobs[0].buildParams('2026-01-01T00:00:00.000Z').$filter;
    expect(resumed).toContain('ModificationTimestamp ge 2026-01-01T00:00:00.000Z');
  });
});
