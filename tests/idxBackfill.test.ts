import { describe, it, expect } from 'vitest';
import { activeBackfillJobs } from '../lib/idxSync';

describe('activeBackfillJobs (month-windowed, two-pass photos)', () => {
  const jobs = activeBackfillJobs();

  it('is 12 monthly feed-wide windows plus one gallery pass', () => {
    const monthly = jobs.filter((j) => j.key.startsWith('active:'));
    expect(monthly).toHaveLength(12);
    expect(jobs[jobs.length - 1].key).toBe('active-galleries');
    expect(monthly.every((j) => j.galleries === false)).toBe(true);
    expect(jobs[jobs.length - 1].galleries).toBe(true);
  });

  it('uses bounded month windows and NO $orderby (the sort that timed out)', () => {
    const monthly = jobs[0];
    expect(monthly.params.$orderby).toBeUndefined();
    expect(monthly.params.$filter).toContain('ModificationTimestamp ge');
    expect(monthly.params.$filter).toContain('ModificationTimestamp lt');
  });

  it('primary passes fetch only the top photo; the gallery pass fetches all', () => {
    const monthly = jobs[0];
    const gallery = jobs[jobs.length - 1];
    expect(monthly.params.$expand).toContain('$top=1');
    expect(gallery.params.$expand).not.toContain('$top=1');
    expect(gallery.params.$filter).toContain('ActiveUnderContract');
  });
});
