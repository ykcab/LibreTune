/**
 * Lane model tests — the unit-preference plumbing that keeps the *traces* in the
 * same units as the tiles.
 */
import { describe, expect, it } from 'vitest';
import {
  BOOST_LANE_IDS,
  buildLanes,
  laneForChannel,
  laneForSpec,
  laneLabel,
  laneLatestRaw,
  laneRawAt,
  laneWindowSamples,
  seriesVar,
  targetWindowSamples,
} from '../lanes';
import { CHANNELS, adaptSpecToUnit, unitFamily, unitTransform } from '../channels';
import type { UnitDisplay } from '../useStartupTelemetry';
import type { ChannelMeta } from '../types';

/** Identity conversion (metric default). */
const metric = (unit: string): UnitDisplay => {
  switch (unit) {
    case 'kPa':
      return { scale: 1, offset: 0, unit: 'kPa' };
    case '°C':
      return { scale: 1, offset: 0, unit: '°C' };
    case 'km/h':
      return { scale: 1, offset: 0, unit: 'km/h' };
    case 'λ':
      return { scale: 1, offset: 0, unit: 'λ' };
    case 'AFR':
      return { scale: 1, offset: 0, unit: 'AFR' };
    default:
      return { scale: 1, offset: 0, unit };
  }
};

/** US-style preferences: °F, PSI, mph, AFR. */
const us = (unit: string): UnitDisplay => {
  switch (unit) {
    case 'kPa':
      return { scale: 1 / 6.89476, offset: 0, unit: 'PSI' };
    case '°C':
      return { scale: 9 / 5, offset: 32, unit: '°F' };
    case 'km/h':
      return { scale: 0.621371, offset: 0, unit: 'mph' };
    case 'λ':
      return { scale: 14.7, offset: 0, unit: 'AFR' };
    case 'AFR':
      return { scale: 1, offset: 0, unit: 'AFR' };
    default:
      return { scale: 1, offset: 0, unit };
  }
};

const meta: ChannelMeta[] = [
  { name: 'vvtIntake', label: 'VVT intake', units: 'deg' },
  { name: 'oilTempF', label: 'Oil temp (F)', units: 'degF' },
  { name: 'boostPsi', label: 'Boost (psi)', units: 'psi' },
];

describe('laneForSpec', () => {
  it('keeps source units under metric preferences', () => {
    const lane = laneForSpec(CHANNELS.coolant, 'coolant', metric);
    expect(lane.unit).toBe('°C');
    expect(lane.min).toBe(0);
    expect(lane.max).toBe(140);
  });

  it('converts the range, the zones and the label under US preferences', () => {
    const lane = laneForSpec(CHANNELS.coolant, 'coolant', us);
    expect(lane.unit).toBe('°F');
    expect(lane.min).toBe(32);
    expect(lane.max).toBe(284); // 140 °C
    // Bands shift with the same linear transform, so the warn zone still starts
    // exactly where 105 °C falls in °F.
    expect(lane.bands?.[0].max).toBeCloseTo(221, 0);
    expect(lane.bands?.[1].max).toBeCloseTo(239, 0);
  });

  it('labels the fuel lane by the unit it draws in', () => {
    expect(laneForSpec(CHANNELS.lambda, 'lambda', metric).label).toBe('LAMBDA');
    expect(laneForSpec(CHANNELS.lambda, 'lambda', us).label).toBe('AFR');
  });

  it('carries a target trace with its own conversion', () => {
    const lane = laneForSpec(CHANNELS.lambda, 'lambda', us, { channel: 'targetLambda', unit: 'λ' });
    expect(lane.target).toEqual({ channel: 'targetLambda', scale: 14.7, offset: 0 });
  });

  it('never converts an infinite band boundary', () => {
    const lane = laneForSpec(CHANNELS.egt, 'egt', us);
    const last = lane.bands?.[lane.bands.length - 1];
    expect(last?.max).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('laneForChannel', () => {
  it('maps INI unit spellings onto real conversions', () => {
    // The INI publishes °F: under metric preferences it must become °C.
    const celsius = laneForChannel(meta[1], 0, metric);
    expect(celsius.unit).toBe('°C');
    expect(celsius.scale).toBeCloseTo(5 / 9, 6);
    expect(celsius.offset).toBeCloseTo(-32 * (5 / 9), 6);

    // ...and under °F preferences it passes through untouched.
    const fahrenheit = laneForChannel(meta[1], 0, us);
    expect(fahrenheit.unit).toBe('°F');
    expect(fahrenheit.scale).toBeCloseTo(1, 6);
    expect(fahrenheit.offset).toBeCloseTo(0, 6);

    const psi = laneForChannel(meta[2], 1, us);
    expect(psi.unit).toBe('PSI');
    // A channel that already publishes PSI is passed through, not converted twice.
    expect(psi.scale).toBeCloseTo(1, 6);

    const psiToKpa = laneForChannel(meta[2], 1, metric);
    expect(psiToKpa.unit).toBe('kPa');
    expect(psiToKpa.scale).toBeCloseTo(6.89476, 4);
  });

  it('marks free channels as auto-ranged', () => {
    const lane = laneForChannel(meta[0], 0, metric);
    expect(lane.autoRange).toBe(true);
    expect(lane.id).toBe('ch:vvtIntake');
    expect(seriesVar(0)).toBe('--sd-series-1');
  });
});

describe('buildLanes', () => {
  const resolved = new Map<string, string>([
    ['rpm', 'RPMValue'],
    ['lambda', 'lambdaValue'],
    ['lambdaTarget', 'targetLambda'],
  ]);

  it('skips channels the ECU does not publish instead of rendering them empty', () => {
    const lanes = buildLanes(['rpm', 'coolant', 'lambda'], resolved, CHANNELS, [], metric);
    expect(lanes.map((l) => l.id)).toEqual(['rpm', 'lambda']);
  });

  it('resolves free channels against the INI metadata', () => {
    const lanes = buildLanes(['rpm', 'ch:vvtIntake', 'ch:notInIni'], resolved, CHANNELS, meta, metric);
    expect(lanes.map((l) => l.id)).toEqual(['rpm', 'ch:vvtIntake']);
  });

  it('wires the commanded trace onto the fuel lane', () => {
    const lanes = buildLanes(['lambda'], resolved, CHANNELS, [], metric);
    expect(lanes[0].target).toEqual({ channel: 'targetLambda', scale: 1, offset: 0 });
  });

  it('gives the rpm lane the tall row', () => {
    const lanes = buildLanes(['rpm', 'lambda'], resolved, CHANNELS, [], metric);
    expect(lanes[0].height).toBe(64);
    expect(lanes[1].height).toBeUndefined();
  });
});

describe('laneLabel', () => {
  it('prefers the INI label for free channels', () => {
    expect(laneLabel('ch:vvtIntake', CHANNELS, meta)).toBe('VVT intake');
    expect(laneLabel('rpm', CHANNELS, meta)).toBe('RPM');
  });
});

describe('INI-declared source units', () => {
  it('classifies unit families', () => {
    expect(unitFamily('°C')).toBe('temperature');
    expect(unitFamily('degF')).toBe('temperature');
    expect(unitFamily('kPa')).toBe('pressure');
    expect(unitFamily('psi')).toBe('pressure');
    expect(unitFamily('mph')).toBe('speed');
    expect(unitFamily('λ')).toBe('ratio');
    expect(unitFamily('%')).toBe('none');
  });

  it('builds affine transforms inside a family and refuses across families', () => {
    expect(unitTransform('°C', '°F')).toEqual({ scale: 9 / 5, offset: 32 });
    expect(unitTransform('°F', '°C')?.scale).toBeCloseTo(5 / 9, 9);
    expect(unitTransform('kPa', 'PSI')?.scale).toBeCloseTo(1 / 6.89476, 9);
    expect(unitTransform('°C', 'kPa')).toBeNull();
    expect(unitTransform('λ', 'AFR')).toBeNull();
    expect(unitTransform('kPa', 'kPa')).toEqual({ scale: 1, offset: 0 });
  });

  it('re-expresses a spec — including its limits — in the INI’s unit', () => {
    // A MegaSquirt-style INI that publishes coolant in °F must be judged against
    // 221/239 °F, not 105/115.
    const adapted = adaptSpecToUnit(CHANNELS.coolant, 'degF');
    expect(adapted.unit).toBe('degF');
    expect(adapted.min).toBeCloseTo(32, 6);
    expect(adapted.max).toBeCloseTo(284, 6);
    expect(adapted.bands?.[0].max).toBeCloseTo(221, 6);
    expect(adapted.bands?.[1].max).toBeCloseTo(239, 6);
    expect(adapted.bands?.[2].max).toBe(Number.POSITIVE_INFINITY);
    // The original catalogue entry is not mutated.
    expect(CHANNELS.coolant.unit).toBe('°C');
    expect(CHANNELS.coolant.bands?.[0].max).toBe(105);
  });

  it('leaves an unrelated or empty declaration alone', () => {
    expect(adaptSpecToUnit(CHANNELS.coolant, '%')).toBe(CHANNELS.coolant);
    expect(adaptSpecToUnit(CHANNELS.coolant, '')).toBe(CHANNELS.coolant);
    expect(adaptSpecToUnit(CHANNELS.coolant, '°C')).toBe(CHANNELS.coolant);
  });

  it('keeps a converted spec consistent through the display layer', () => {
    // INI publishes °F, user prefers °C: 221 °F threshold must read as 105 °C.
    const adapted = adaptSpecToUnit(CHANNELS.coolant, 'degF');
    const lane = laneForSpec(adapted, 'CLT', (unit) =>
      unit === 'degF' ? { scale: 5 / 9, offset: -32 * (5 / 9), unit: '°C' } : { scale: 1, offset: 0, unit },
    );
    expect(lane.unit).toBe('°C');
    expect(lane.bands?.[0].max).toBeCloseTo(105, 6);
  });
});

describe('boost lanes', () => {
  const derived = (map: string, baro?: string) =>
    laneForSpec(CHANNELS.boost, map, metric, undefined, { channel: baro });

  it('derives gauge pressure from MAP when the ECU has no boost channel', () => {
    const [lane] = buildLanes(['boost'], new Map([['map', 'MAPValue'], ['baro', 'baroValue']]), CHANNELS, [], metric);
    expect(lane.label).toBe('BOOST');
    expect(lane.channel).toBe('MAPValue');
    expect(lane.barometric).toEqual({ channel: 'baroValue' });
    expect(lane.target).toBeUndefined();
  });

  it('falls back to standard atmosphere when no baro channel is published', () => {
    const [lane] = buildLanes(['boost'], new Map([['map', 'MAPValue']]), CHANNELS, [], metric);
    expect(lane.barometric).toEqual({ channel: undefined });
  });

  it('draws the ECU boost channel directly, without a barometric subtraction', () => {
    const resolved = new Map([['boost', 'boostPressure'], ['map', 'MAPValue']]);
    const [lane] = buildLanes(['boost'], resolved, CHANNELS, [], metric);
    expect(lane.label).toBe('BOOST');
    expect(lane.channel).toBe('boostPressure');
    expect(lane.barometric).toBeUndefined();
  });

  it('plots the ECU boost target as the trace when it publishes one', () => {
    const resolved = new Map([['map', 'MAPValue'], ['boostTarget', 'boostTargetValue']]);
    const [lane] = buildLanes(['boost'], resolved, CHANNELS, [], metric);
    expect(lane.target).toEqual({ channel: 'boostTargetValue', scale: 1, offset: 0 });
  });

  it('has no boost lane without MAP or a boost channel', () => {
    expect(buildLanes(['boost'], new Map(), CHANNELS, [], metric)).toEqual([]);
  });

  it('subtracts barometric pressure sample by sample, aligned on the newest sample', () => {
    const lane = derived('MAPValue', 'baroValue');
    const history: Record<string, number[]> = { MAPValue: [100, 150, 200], baroValue: [99, 100] };
    // The oldest MAP sample has no barometric partner, so it uses standard atmosphere.
    expect(laneWindowSamples(lane, 3, (c) => history[c] ?? [])).toEqual([100 - 101.325, 150 - 99, 200 - 100]);
  });

  it('reads the latest gauge pressure, or nothing before the first sample', () => {
    const lane = derived('MAPValue', 'baroValue');
    expect(laneLatestRaw(lane, (c) => (c === 'MAPValue' ? 180 : c === 'baroValue' ? 100 : undefined))).toBe(80);
    expect(laneLatestRaw(lane, () => undefined)).toBeUndefined();
  });

  it('reads the value a cursor points at, counting back from the newest sample', () => {
    const lane = laneForSpec(CHANNELS.map, 'MAPValue', metric);
    const history: Record<string, number[]> = { MAPValue: [10, 20, 30] };
    const read = (c: string) => history[c] ?? [];
    expect(laneRawAt(lane, 0, read)).toBe(30);
    expect(laneRawAt(lane, 2, read)).toBe(10);
    expect(laneRawAt(lane, 3, read)).toBeUndefined();
  });

  it('keeps the target window aligned with the lane window', () => {
    const lane = laneForSpec(CHANNELS.boost, 'MAPValue', metric, { channel: 'T', unit: 'kPa' });
    const history: Record<string, number[]> = { T: [1, 2, 3, 4] };
    expect(targetWindowSamples(lane, 2, (c) => history[c] ?? [])).toEqual([3, 4]);
  });

  it('puts boost, throttle and rpm in the boost view, in that order', () => {
    const resolved = new Map([['map', 'MAPValue'], ['tps', 'TPSValue'], ['rpm', 'RPMValue']]);
    expect(buildLanes(BOOST_LANE_IDS, resolved, CHANNELS, [], metric).map((l) => l.id)).toEqual(['boost', 'tps', 'rpm']);
  });
});
