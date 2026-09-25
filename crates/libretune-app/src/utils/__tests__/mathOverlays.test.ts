import { describe, expect, it } from 'vitest';
import { applyMathOverlays, overlayChannelName } from '../mathOverlays';

describe('applyMathOverlays', () => {
  const rows = (values: Array<Record<string, number>>): Array<{ t: number; values: Record<string, number> }> =>
    values.map((v, i) => ({ t: i * 100, values: v }));

  it('injects overlay series as math: channels', () => {
    const samples = rows([{ rpm: 1000 }, { rpm: 2000 }]);
    const { samples: merged, channels } = applyMathOverlays(samples, {
      afr_err: [0.5, -0.5],
    });
    expect(channels).toEqual(['math:afr_err']);
    expect(merged[0].values['math:afr_err']).toBe(0.5);
    expect(merged[1].values['math:afr_err']).toBe(-0.5);
    // Input rows are not mutated.
    expect(samples[0].values['math:afr_err']).toBeUndefined();
    expect(overlayChannelName('afr_err')).toBe('math:afr_err');
  });

  it('leaves gaps for null and non-finite values', () => {
    const samples = rows([{ rpm: 1000 }, { rpm: 2000 }, { rpm: 3000 }]);
    const { samples: merged } = applyMathOverlays(samples, {
      ratio: [1, null, Number.POSITIVE_INFINITY],
    });
    expect(merged[0].values['math:ratio']).toBe(1);
    expect(merged[1].values['math:ratio']).toBeUndefined();
    expect(merged[2].values['math:ratio']).toBeUndefined();
  });
});
