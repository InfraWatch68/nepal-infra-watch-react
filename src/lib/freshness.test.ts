import { describe, it, expect } from 'vitest';
import { freshnessLabel } from './freshness';

const NOW = new Date('2026-05-12T12:00:00Z');

describe('freshnessLabel', () => {
  it('returns gray "No activity" for null / undefined / unparseable input', () => {
    expect(freshnessLabel(null, NOW)).toMatchObject({ color: 'gray', days: null });
    expect(freshnessLabel(undefined, NOW)).toMatchObject({ color: 'gray', days: null });
    expect(freshnessLabel('not-a-date', NOW)).toMatchObject({ color: 'gray', days: null });
  });

  it('reports green for < 14 days old', () => {
    expect(freshnessLabel('2026-05-12T08:00:00Z', NOW)).toMatchObject({ color: 'green', text: 'Updated today', days: 0 });
    expect(freshnessLabel('2026-05-11T12:00:00Z', NOW)).toMatchObject({ color: 'green', text: 'Updated yesterday', days: 1 });
    expect(freshnessLabel('2026-05-01T12:00:00Z', NOW)).toMatchObject({ color: 'green', text: 'Updated 11d ago', days: 11 });
  });

  it('reports amber for 14-29 days old', () => {
    expect(freshnessLabel('2026-04-28T12:00:00Z', NOW)).toMatchObject({ color: 'amber', days: 14 });
    expect(freshnessLabel('2026-04-14T12:00:00Z', NOW)).toMatchObject({ color: 'amber', days: 28 });
  });

  it('reports gray for 30+ days old with month/year formatting', () => {
    expect(freshnessLabel('2026-04-12T12:00:00Z', NOW)).toMatchObject({ color: 'gray', text: 'Updated 1mo ago' });
    expect(freshnessLabel('2025-05-12T12:00:00Z', NOW)).toMatchObject({ color: 'gray', text: 'Updated 1y ago' });
  });

  it('clamps future timestamps to 0 days', () => {
    expect(freshnessLabel('2027-01-01T00:00:00Z', NOW)).toMatchObject({ color: 'green', days: 0 });
  });
});
