/**
 * Limit-override tests.
 *
 * Overrides are the one place where a user's engine can disagree with the
 * catalogue, so the rules that matter are: the direction of danger is respected,
 * a two-sided channel is never silently reduced to one pair, and nothing
 * malformed survives a storage round-trip.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CHANNELS } from '../channels';
import {
  applyLimitOverrides,
  bandsWithLimits,
  isMixedDirection,
  LIMIT_STORAGE_KEY,
  limitDirection,
  limitField,
  limitFields,
  loadLimitOverrides,
  normaliseOverride,
  saveLimitOverrides,
} from '../limits';

beforeEach(() => {
  window.localStorage.clear();
});

describe('direction', () => {
  it('reads the direction of danger from the default bands', () => {
    expect(limitDirection(CHANNELS.coolant.bands)).toBe('above');
    expect(limitDirection(CHANNELS.egt.bands)).toBe('above');
    expect(limitDirection(CHANNELS.oilPressure.bands)).toBe('below'); // ends in ok
    expect(limitDirection(CHANNELS.fuelLevel.bands)).toBe('below');
    expect(limitDirection(undefined)).toBe('above');
  });

  it('detects a channel that is dangerous on both sides', () => {
    // Battery warns low *and* on overcharge: one {warn, crit} pair cannot say it.
    expect(isMixedDirection(CHANNELS.battery.bands)).toBe(true);
    expect(isMixedDirection(CHANNELS.coolant.bands)).toBe(false);
    expect(isMixedDirection(CHANNELS.oilPressure.bands)).toBe(false);
  });
});

describe('bandsWithLimits', () => {
  it('rebuilds a high-is-bad channel and keeps the wording', () => {
    const bands = bandsWithLimits(CHANNELS.coolant.bands, { warn: 110, crit: 120 });
    expect(bands?.map((b) => b.max)).toEqual([110, 120, Number.POSITIVE_INFINITY]);
    expect(bands?.map((b) => b.tone)).toEqual(['ok', 'warn', 'crit']);
    expect(bands?.[0].label).toBe('FAN');
    expect(bands?.[2].label).toBe('CRITICAL');
  });

  it('rebuilds a low-is-bad channel in ascending order', () => {
    const bands = bandsWithLimits(CHANNELS.oilPressure.bands, { warn: 90, crit: 50 });
    expect(bands?.map((b) => b.max)).toEqual([50, 90, Number.POSITIVE_INFINITY]);
    expect(bands?.map((b) => b.tone)).toEqual(['crit', 'warn', 'ok']);
  });

  it('leaves the catalogue alone when there is no override', () => {
    expect(bandsWithLimits(CHANNELS.coolant.bands, undefined)).toBe(CHANNELS.coolant.bands);
    expect(bandsWithLimits(CHANNELS.coolant.bands, {})).toBe(CHANNELS.coolant.bands);
  });

  it('fills a missing side from the current value', () => {
    const bands = bandsWithLimits(CHANNELS.coolant.bands, { warn: 110 });
    expect(bands?.map((b) => b.max)).toEqual([110, 115, Number.POSITIVE_INFINITY]);
  });
});

describe('applyLimitOverrides', () => {
  it('returns the same object when nothing is overridden', () => {
    const specs = { coolant: CHANNELS.coolant };
    expect(applyLimitOverrides(specs, {})).toBe(specs);
  });

  it('replaces bands for the overridden channel only', () => {
    const specs = { coolant: CHANNELS.coolant, egt: CHANNELS.egt };
    const out = applyLimitOverrides(specs, { egt: { warn: 700, crit: 800 } });
    expect(out.egt.bands?.[0].max).toBe(700);
    expect(out.coolant).toBe(CHANNELS.coolant);
    // The shipped catalogue is never mutated.
    expect(CHANNELS.egt.bands?.[0].max).toBe(850);
  });

  it('refuses to collapse a two-sided channel into one pair', () => {
    const out = applyLimitOverrides({ battery: CHANNELS.battery }, { battery: { warn: 10, crit: 20 } });
    expect(out.battery).toBe(CHANNELS.battery);
  });
});

describe('limitFields', () => {
  it('offers the adjustable channels with their effective values', () => {
    const fields = limitFields({});
    const coolant = fields.find((f) => f.id === 'coolant');
    expect(coolant).toMatchObject({ warn: 105, crit: 115, direction: 'above' });
    const oil = fields.find((f) => f.id === 'oilPressure');
    expect(oil).toMatchObject({ warn: 70, crit: 40, direction: 'below' });
    // No limits → not adjustable. Two-sided channels are not adjustable either:
    // battery warns low *and* on overcharge, and fuel trim warns rich below 85 %
    // while calling >115 % critical. One pair cannot say both.
    expect(fields.some((f) => f.id === 'map')).toBe(false);
    expect(fields.some((f) => f.id === 'battery')).toBe(false);
    expect(fields.some((f) => f.id === 'correction')).toBe(false);
    // No critical threshold at all (knock, retard) → not adjustable.
    expect(fields.some((f) => f.id === 'knock')).toBe(false);
    expect(fields.some((f) => f.id === 'knockRetard')).toBe(false);
  });

  it('reports the override in place of the default', () => {
    const fields = limitFields({ coolant: { warn: 110, crit: 120 } });
    const coolant = fields.find((f) => f.id === 'coolant');
    expect(coolant).toMatchObject({ warn: 110, crit: 120, defaultWarn: 105, defaultCrit: 115 });
  });

  it('finds a single channel by id, not by position', () => {
    // `limitFields` always returns the whole catalogue, so index 0 is whichever
    // channel happens to come first — the dialog must look its channel up.
    expect(limitFields({ coolant: { warn: 110, crit: 120 } })[0].id).not.toBe('coolant');
    expect(limitField('coolant', { warn: 110, crit: 120 })).toMatchObject({ id: 'coolant', warn: 110 });
    expect(limitField('coolant', undefined)).toMatchObject({ id: 'coolant', warn: 105 });
    expect(limitField('battery', undefined)).toBeUndefined();
  });
});

describe('normaliseOverride', () => {
  it('orders a high-is-bad pair', () => {
    expect(normaliseOverride('above', 120, 90)).toEqual({ warn: 90, crit: 120 });
  });

  it('orders a low-is-bad pair the other way round', () => {
    expect(normaliseOverride('below', 40, 90)).toEqual({ warn: 90, crit: 40 });
  });
});

describe('storage', () => {
  it('round-trips a valid map', () => {
    saveLimitOverrides({ coolant: { warn: 110, crit: 120 }, egt: { warn: 700, crit: 800 } });
    expect(loadLimitOverrides()).toEqual({ coolant: { warn: 110, crit: 120 }, egt: { warn: 700, crit: 800 } });
  });

  it('clears the key when everything is reset', () => {
    saveLimitOverrides({ coolant: { warn: 110, crit: 120 } });
    saveLimitOverrides({});
    expect(window.localStorage.getItem(LIMIT_STORAGE_KEY)).toBeNull();
    expect(loadLimitOverrides()).toEqual({});
  });

  it('ignores malformed storage instead of throwing', () => {
    window.localStorage.setItem(LIMIT_STORAGE_KEY, '{not json');
    expect(loadLimitOverrides()).toEqual({});
    window.localStorage.setItem(LIMIT_STORAGE_KEY, JSON.stringify({ coolant: 5, egt: { warn: 'x' } }));
    expect(loadLimitOverrides()).toEqual({});
    window.localStorage.setItem(LIMIT_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadLimitOverrides()).toEqual({});
  });
});
