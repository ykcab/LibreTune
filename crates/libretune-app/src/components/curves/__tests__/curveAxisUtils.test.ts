import { describe, expect, it } from 'vitest';
import { buildAxisTickValues, safeAxisRange } from '../curveAxisUtils';

describe('safeAxisRange', () => {
  it('expands zero-width ranges', () => {
    const { min, max, span } = safeAxisRange(50, 50);
    expect(span).toBeGreaterThan(0);
    expect(min).toBeLessThan(50);
    expect(max).toBeGreaterThan(50);
  });
});

describe('buildAxisTickValues', () => {
  it('returns ticks for a normal range', () => {
    const ticks = buildAxisTickValues(0, 100);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]).toBeGreaterThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(100);
  });

  it('does not hang when min equals max', () => {
    const ticks = buildAxisTickValues(42, 42);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(64);
  });
});
