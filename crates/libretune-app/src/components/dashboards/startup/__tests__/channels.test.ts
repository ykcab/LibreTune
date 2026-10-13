/**
 * Channel catalogue tests.
 *
 * These pin the behaviour the dashboard's honesty depends on: resolution order,
 * gap semantics, threshold band lookup in both directions, engine-state
 * derivation, and the measured/commanded pairing.
 */
import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  bandFor,
  effectiveBoost,
  engineState,
  flagActive,
  FLAGS,
  formatNumber,
  formatSigned,
  fuelRatio,
  isGap,
  resolveKey,
  resolveKeys,
  toneFor,
} from '../channels';

const set = (...names: string[]) => new Set(names);

describe('resolveKey', () => {
  it('prefers the canonical name, then the ECU-specific candidates in order', () => {
    expect(resolveKey(CHANNELS.coolant, set('coolant', 'clt'))).toBe('coolant');
    expect(resolveKey(CHANNELS.coolant, set('CLT'))).toBe('CLT');
    expect(resolveKey(CHANNELS.coolant, set('coolantTemp'))).toBe('coolantTemp');
  });

  it('returns undefined when the ECU publishes nothing in the group', () => {
    expect(resolveKey(CHANNELS.oilPressure, set('rpm', 'map'))).toBeUndefined();
  });

  it('resolves reference channels separately from the measured value', () => {
    expect(resolveKeys(CHANNELS.rpm.reference?.keys ?? [], set('revLimit'))).toBe('revLimit');
    expect(resolveKeys(CHANNELS.rpm.reference?.keys ?? [], set('rpm'))).toBeUndefined();
  });
});

describe('bands and tones', () => {
  it('walks ascending bands for a high-is-bad channel', () => {
    const coolant = CHANNELS.coolant;
    expect(bandFor(coolant, 90)?.tone).toBe('ok');
    expect(bandFor(coolant, 105)?.tone).toBe('ok');
    expect(bandFor(coolant, 106)?.tone).toBe('warn');
    expect(bandFor(coolant, 116)?.tone).toBe('crit');
    expect(toneFor(coolant, 120)).toBe('crit');
  });

  it('walks ascending bands for a low-is-bad channel', () => {
    const oil = CHANNELS.oilPressure;
    expect(toneFor(oil, 40)).toBe('crit');
    expect(toneFor(oil, 90)).toBe('warn');
    expect(toneFor(oil, 300)).toBe('ok');
  });

  it('treats a missing reading as dim, never as healthy', () => {
    expect(toneFor(CHANNELS.coolant, undefined)).toBe('dim');
    expect(toneFor(CHANNELS.lambda, Number.NaN)).toBe('dim');
  });

  it('has no invented limits on load channels', () => {
    // Manifold pressure is an axis, not a limit: a boost ceiling is only
    // meaningful relative to the ECU's own target.
    expect(CHANNELS.map.bands).toBeUndefined();
    expect(CHANNELS.boost.bands).toBeUndefined();
    expect(CHANNELS.advance.bands).toBeUndefined();
  });
});

describe('gap semantics', () => {
  it('treats raw 0 as missing where a zero reading is physically impossible', () => {
    expect(isGap(CHANNELS.oilPressure, 0)).toBe(true);
    expect(isGap(CHANNELS.lambda, 0)).toBe(true);
    expect(isGap(CHANNELS.battery, 0)).toBe(true);
    expect(isGap(CHANNELS.fuelPressure, 0)).toBe(true);
    // ...but not on channels where 0 is a legitimate reading.
    expect(isGap(CHANNELS.rpm, 0)).toBe(false);
    expect(isGap(CHANNELS.tps, 0)).toBe(false);
    expect(isGap(CHANNELS.advance, 0)).toBe(false);
  });

  it('never flags a temperature at 0 °C as a dead sensor', () => {
    // 0 °C is an ordinary winter reading: the flag would manufacture a false
    // dropout event and break the trace on a healthy sensor.
    for (const id of ['coolant', 'iat', 'oilTemp', 'egt']) {
      expect(isGap(CHANNELS[id], 0)).toBe(false);
      expect(toneFor(CHANNELS[id], 0)).not.toBe('dim');
    }
  });

  it('does not claim trigger sync from a MAP-validity bit', () => {
    // `isMapValid` exists in several INIs and is NOT a crank/cam trigger state.
    expect(CHANNELS.sync.keys).not.toContain('isMapValid');
  });

  it('reports a zero-as-missing channel as dim rather than alarming', () => {
    expect(toneFor(CHANNELS.oilPressure, 0)).toBe('dim');
    expect(toneFor(CHANNELS.lambda, 0)).toBe('dim');
  });
});

describe('formatting', () => {
  it('renders an em dash for missing values instead of zero', () => {
    expect(formatNumber(undefined, 1)).toBe('—');
    expect(formatNumber(Number.NaN, 1)).toBe('—');
    expect(formatNumber(0, 1)).toBe('0.0');
  });

  it('signs deltas', () => {
    expect(formatSigned(2.345, 2)).toBe('+2.35');
    expect(formatSigned(-2.345, 2)).toBe('-2.35');
    expect(formatSigned(0, 1)).toBe('0.0');
  });
});

describe('engine state', () => {
  it('reports a phase from live channels and explains its basis', () => {
    expect(engineState({ rpm: 0 }).phase).toBe('off');
    expect(engineState({ rpm: 250 }).phase).toBe('cranking');
    expect(engineState({ rpm: 850, tps: 1, map: 35 }).phase).toBe('idle');
    expect(engineState({ rpm: 3000, tps: 80, map: 180 }).phase).toBe('load');
    expect(engineState({ rpm: 2500, tps: 0, map: 30 }).phase).toBe('overrun');
    expect(engineState({ rpm: 2200, tps: 25, map: 60 }).phase).toBe('running');
    expect(engineState({}).phase).toBe('unknown');
  });

  it('lets the ECU’s own limiter and launch flags win over the heuristic', () => {
    expect(engineState({ rpm: 7000, softLimit: true }).label).toBe('SOFT LIMIT');
    expect(engineState({ rpm: 7000, hardLimit: true }).label).toBe('HARD LIMIT');
    expect(engineState({ rpm: 3000, launch: true }).label).toBe('LAUNCH');
  });

  it('always returns a basis string so the label is never a black box', () => {
    expect(engineState({ rpm: 850, tps: 1, map: 35 }).basis).toContain('rpm');
  });
});

describe('fuel ratio pairing', () => {
  it('derives lambda from AFR with the configured stoichiometry', () => {
    const ratio = fuelRatio({ afr: 12.75, afrTarget: 12.0 }, set('afr', 'afrTarget'), 'Lambda', 15);
    expect(ratio?.unit).toBe('λ');
    expect(ratio?.measured).toBeCloseTo(0.85, 6);
    expect(ratio?.target).toBeCloseTo(0.8, 6);
    expect(ratio?.measuredDerived).toBe(true);
    expect(ratio?.targetDerived).toBe(true);
  });

  it('converts a lambda measurement into AFR for an AFR-preferring user', () => {
    const ratio = fuelRatio({ lambda: 0.9, lambdaTarget: 0.85 }, set('lambda', 'lambdaTarget'), 'AFR', 14.7);
    expect(ratio?.unit).toBe('AFR');
    expect(ratio?.measured).toBeCloseTo(13.23, 2);
    expect(ratio?.target).toBeCloseTo(12.495, 3);
    expect(ratio?.measuredDerived).toBe(true);
  });

  it('marks ECU-published values as measured, not derived', () => {
    const ratio = fuelRatio(
      { lambda: 0.9, afrTarget: 13.5 },
      set('lambda', 'afrTarget'),
      'Lambda',
      14.7,
    );
    expect(ratio?.measuredDerived).toBe(false);
    expect(ratio?.targetDerived).toBe(true);
    expect(ratio?.target).toBeCloseTo(13.5 / 14.7, 6);
  });

  it('returns undefined when neither side exists', () => {
    expect(fuelRatio({ rpm: 3000 }, set('rpm'), 'AFR', 14.7)).toBeUndefined();
  });

  it('ignores a collapsed wideband instead of reporting it as very rich', () => {
    const ratio = fuelRatio({ lambda: 0, afrTarget: 12.6 }, set('lambda', 'afrTarget'), 'Lambda', 14.7);
    expect(ratio?.measured).toBeUndefined();
  });
});

describe('boost', () => {
  it('uses the ECU channel when it exists', () => {
    expect(effectiveBoost({ boost: 120, map: 220 }, set('boost', 'map'))).toEqual({ value: 120, derived: false });
  });

  it('derives gauge pressure from MAP and baro and says so', () => {
    const result = effectiveBoost({ map: 200, baro: 100 }, set('map', 'baro'));
    expect(result.value).toBe(100);
    expect(result.derived).toBe(true);
  });

  it('falls back to standard atmosphere for a 0 kPa baro (no sensor)', () => {
    const result = effectiveBoost({ map: 150, baro: 0 }, set('map', 'baro'));
    expect(result.value).toBeCloseTo(48.675, 3);
  });

  it('reports nothing when MAP is missing or collapsed', () => {
    expect(effectiveBoost({}, set()).value).toBeUndefined();
    expect(effectiveBoost({ map: 0 }, set('map')).value).toBeUndefined();
  });
});

describe('ECU state flags', () => {
  it('reads boolean-ish channels', () => {
    const limiter = FLAGS.find((f) => f.id === 'limiterSoft')!;
    expect(flagActive({ softLimit: 1 }, limiter)).toBe(true);
    expect(flagActive({ softLimit: 0 }, limiter)).toBe(false);
    expect(flagActive({ rpm: 1000 }, limiter)).toBeUndefined();
  });

  it('accepts a percentage-style flag', () => {
    const fan = FLAGS.find((f) => f.id === 'fan')!;
    expect(flagActive({ fan: 100 }, fan)).toBe(true);
    expect(flagActive({ fan: 0 }, fan)).toBe(false);
  });
});
