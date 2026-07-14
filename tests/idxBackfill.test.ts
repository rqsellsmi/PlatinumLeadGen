import { describe, it, expect } from 'vitest';
import { activeBackfillJobs } from '../lib/idxSync';

describe('activeBackfillJobs (month-windowed)', () => {
  const jobs = activeBackfillJobs();

  it('is 12 monthly feed-wide windows', () => {
    expect(jobs).toHaveLength(12);
    expect(jobs.every((j) => j.key.startsWith('active:'))).toBe(true);
    // galleries stored per status inside the same pass.
    expect(jobs.every((j) => j.galleries === true)).toBe(true);
  });

  it('uses bounded month windows and NO $orderby (the sort that timed out)', () => {
    const j = jobs[0];
    expect(j.params.$orderby).toBeUndefined();
    expect(j.params.$filter).toContain('ModificationTimestamp ge');
    expect(j.params.$filter).toContain('ModificationTimestamp lt');
  });

  it('fetches the full Media set (nested $top=1 was slower on Realcomp)', () => {
    expect(jobs[0].params.$expand).not.toContain('$top');
    expect(jobs[0].params.$expand).toContain('Media(');
  });
});
