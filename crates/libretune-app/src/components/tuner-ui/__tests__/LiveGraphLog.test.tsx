/**
 * LiveGraphLog tests — the live strip-chart feed for the startup dash.
 *
 * Covers the pure sample builder (history buffers → GraphSample rows);
 * the component itself is a thin interval wrapper around GraphLog, which
 * has its own interaction suite.
 */
import { describe, expect, it } from 'vitest';
import { buildLiveSamples } from '../LiveGraphLog';
import { CHANNEL_HISTORY_MS_PER_SAMPLE } from '../../../stores/realtimeStore';

describe('buildLiveSamples', () => {
  it('returns no samples when every history is empty', () => {
    expect(buildLiveSamples({ rpm: [] }, 1_000_000)).toEqual([]);
    expect(buildLiveSamples({}, 1_000_000)).toEqual([]);
  });

  it('maps oldest→newest values with reconstructed timestamps', () => {
    const samples = buildLiveSamples({ rpm: [1000, 2000, 3000] }, 10_000, 100);
    expect(samples).toHaveLength(3);
    expect(samples[0]).toEqual({ t: 9800, values: { rpm: 1000 } });
    expect(samples[2]).toEqual({ t: 10_000, values: { rpm: 3000 } });
  });

  it('uses the documented realtime cadence by default', () => {
    const samples = buildLiveSamples({ rpm: [1, 2] }, 1000);
    expect(samples[1].t - samples[0].t).toBe(CHANNEL_HISTORY_MS_PER_SAMPLE);
  });

  it('merges channels and aligns late joiners to the latest sample', () => {
    const samples = buildLiveSamples(
      { rpm: [1000, 2000, 3000], tps: [50, 60] },
      10_000,
      100,
    );
    expect(samples).toHaveLength(3);
    // tps joined mid-stream: absent from the oldest row...
    expect(samples[0].values).toEqual({ rpm: 1000 });
    expect(samples[0].values.tps).toBeUndefined();
    // ...and aligned to the tail afterwards.
    expect(samples[1].values).toEqual({ rpm: 2000, tps: 50 });
    expect(samples[2]).toEqual({ t: 10_000, values: { rpm: 3000, tps: 60 } });
  });
});
