import { describe, it, expect } from 'vitest';
import { seedPeak, nextPeakState, type PeakState } from '../peakTracking';
import type { TsGaugeConfig } from '../../dashboards/dashTypes';

type PeakFields = Pick<TsGaugeConfig, 'peak_hold' | 'history_value' | 'min' | 'max'>;

const cfg = (overrides: Partial<PeakFields>): PeakFields => ({
  peak_hold: true,
  history_value: 0,
  min: 0,
  max: 100,
  ...overrides,
});

describe('seedPeak (issue #129: history_value applied at render time)', () => {
  it('seeds the marker from the persisted history_value', () => {
    expect(seedPeak(cfg({ history_value: 73 }), 10)).toBe(73);
  });

  it('clamps the seeded peak into the gauge range', () => {
    expect(seedPeak(cfg({ history_value: 500 }), 10)).toBe(100);
    expect(seedPeak(cfg({ history_value: -40 }), 10)).toBe(0);
  });

  it('falls back to the current value when history is absent or peak-hold is off', () => {
    expect(seedPeak(cfg({ history_value: Number.NaN }), 42)).toBe(42);
    expect(seedPeak(cfg({ peak_hold: false, history_value: 73 }), 42)).toBe(42);
  });
});

describe('nextPeakState (issue #129: history_delay applied at render time)', () => {
  const held = (peak: number, at: number): PeakState => ({ peak, lastNewPeakAt: at });

  it('ratchets upward and stamps the time of the new peak', () => {
    const next = nextPeakState(held(50, 1000), 80, 2000, 15000);
    expect(next.peak).toBe(80);
    expect(next.lastNewPeakAt).toBe(2000);
  });

  it('holds the peak while the delay has not elapsed', () => {
    const next = nextPeakState(held(80, 1000), 50, 1000 + 14999, 15000);
    expect(next.peak).toBe(80);
  });

  it('lets the marker fall back to the present value once the delay elapses', () => {
    const next = nextPeakState(held(80, 1000), 50, 1000 + 15000, 15000);
    expect(next.peak).toBe(50);
    expect(next.lastNewPeakAt).toBe(16000);
  });

  it('a new peak within the delay window restarts the hold', () => {
    // Peak at t=1000, nearly decays at t=15999, new peak at t=16000 →
    // the marker must hold from the NEW peak's timestamp.
    let state = nextPeakState(held(80, 1000), 50, 15999, 15000);
    state = nextPeakState(state, 90, 16000, 15000);
    expect(state.peak).toBe(90);
    const after = nextPeakState(state, 50, 16000 + 14999, 15000);
    expect(after.peak).toBe(90);
  });

  it('treats history_delay <= 0 as hold-forever', () => {
    for (const history_delay of [0, -1]) {
      const next = nextPeakState(held(80, 1000), 50, 1_000_000, history_delay);
      expect(next.peak, `history_delay=${history_delay}`).toBe(80);
    }
  });

  it('starts the decay clock on the first frame without moving a seeded peak', () => {
    const seeded: PeakState = { peak: 73, lastNewPeakAt: null };
    const started = nextPeakState(seeded, 10, 5000, 15000);
    expect(started.peak).toBe(73);
    expect(started.lastNewPeakAt).toBe(5000);
    // ...and the seeded peak then decays like a freshly observed one.
    const decayed = nextPeakState(started, 10, 5000 + 15000, 15000);
    expect(decayed.peak).toBe(10);
  });
});
