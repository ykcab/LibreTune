/**
 * Lane model tests — the unit-preference plumbing that keeps the *traces* in the
 * same units as the tiles.
 */
import { describe, expect, it } from 'vitest';
import { buildLanes, laneForChannel, laneForSpec, laneLabel, seriesVar } from '../lanes';
import { CHANNELS } from '../channels';
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
    const lanes = buildLanes(['rpm', 'coolant', 'lambda'], resolved, [], metric);
    expect(lanes.map((l) => l.id)).toEqual(['rpm', 'lambda']);
  });

  it('resolves free channels against the INI metadata', () => {
    const lanes = buildLanes(['rpm', 'ch:vvtIntake', 'ch:notInIni'], resolved, meta, metric);
    expect(lanes.map((l) => l.id)).toEqual(['rpm', 'ch:vvtIntake']);
  });

  it('wires the commanded trace onto the fuel lane', () => {
    const lanes = buildLanes(['lambda'], resolved, [], metric);
    expect(lanes[0].target).toEqual({ channel: 'targetLambda', scale: 1, offset: 0 });
  });

  it('gives the rpm lane the tall row', () => {
    const lanes = buildLanes(['rpm', 'lambda'], resolved, [], metric);
    expect(lanes[0].height).toBe(64);
    expect(lanes[1].height).toBeUndefined();
  });
});

describe('laneLabel', () => {
  it('prefers the INI label for free channels', () => {
    expect(laneLabel('ch:vvtIntake', meta)).toBe('VVT intake');
    expect(laneLabel('rpm', meta)).toBe('RPM');
  });
});
