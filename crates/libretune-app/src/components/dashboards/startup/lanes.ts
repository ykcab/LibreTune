/**
 * Startup dashboard — scope lane model.
 *
 * A lane is a channel drawn as one row of the live scope. Lanes are derived from
 * the channel catalogue when the channel is known, and from the INI's own
 * channel list otherwise (so any ECU channel a tuner cares about can be plotted,
 * not just the curated set).
 *
 * Ranges are in source units; the scope converts only the printed labels and
 * current-value numbers, never the geometry.
 */
import { CHANNELS, type Band, type ChannelSpec } from './channels';
import type { ChannelMeta } from './types';
import type { UnitDisplay } from './useStartupTelemetry';

/** Unit-preference lookup: source unit → linear display conversion. */
export type UnitDisplayFn = (unit: string) => UnitDisplay;

export interface ScopeLane {
  /** Stable key: catalogue spec id, or `ch:<stream key>` for a free channel. */
  id: string;
  /** Stream key read from the realtime history buffer. */
  channel: string;
  /** Secondary target trace (fuel ratio lanes only). */
  target?: { channel: string; scale: number; offset: number };
  label: string;
  /** Source unit of the raw stream value (what the ECU publishes). */
  sourceUnit: string;
  /** What the gutter prints (the user's preferred unit). */
  unit: string;
  /** display = raw × scale + offset — applied to samples, ranges and zones. */
  scale: number;
  offset: number;
  /** CSS custom property holding the trace colour (theme-aware). */
  color: string;
  /** Display-space range (already converted). */
  min: number;
  max: number;
  digits: number;
  /** Ascending threshold bands, converted into display space. */
  bands?: Band[];
  /** A raw 0 means "no reading": break the trace instead of plotting zero. */
  zeroIsGap: boolean;
  /** True while the range is derived from live data rather than declared. */
  autoRange: boolean;
  /** Row height in px (defaults to the scope's base row height). */
  height?: number;
}

/** Default lane set — the channels a tuner watches while driving. */
export const DEFAULT_LANE_IDS = ['rpm', 'map', 'lambda', 'tps', 'advance', 'dutyCycle'];

/** Accent cycle for channels outside the curated catalogue. */
const SERIES_VARS = [
  '--sd-series-1',
  '--sd-series-2',
  '--sd-series-3',
  '--sd-series-4',
  '--sd-series-5',
  '--sd-series-6',
  '--sd-series-7',
  '--sd-series-8',
];

export function seriesVar(index: number): string {
  return SERIES_VARS[index % SERIES_VARS.length];
}

/** Lane for a catalogued channel. */
export function laneForSpec(
  spec: ChannelSpec,
  channel: string,
  display: UnitDisplayFn,
  target?: { channel: string; unit: string },
): ScopeLane {
  const conv = display(spec.unit);
  return {
    id: spec.id,
    channel,
    target: target
      ? { channel: target.channel, scale: display(target.unit).scale, offset: display(target.unit).offset }
      : undefined,
    // The fuel-ratio lane is labelled by the unit it is drawn in, so a lane can
    // never read "LAMBDA 12.696 AFR".
    label: spec.id === 'lambda' ? (conv.unit === 'AFR' ? 'AFR' : 'LAMBDA') : spec.label,
    sourceUnit: spec.unit,
    unit: conv.unit,
    scale: conv.scale,
    offset: conv.offset,
    color: spec.color ?? seriesVar(spec.id.length),
    min: spec.min * conv.scale + conv.offset,
    max: spec.max * conv.scale + conv.offset,
    bands: spec.bands?.map((band) => ({
      ...band,
      max: band.max === Number.POSITIVE_INFINITY ? band.max : band.max * conv.scale + conv.offset,
    })),
    digits: spec.digits,
    zeroIsGap: spec.zeroIsGap === true,
    autoRange: false,
    height: spec.id === 'rpm' ? 64 : undefined,
  };
}

/**
 * Lane for an arbitrary INI channel.
 *
 * The INI gives us a label and a unit but no range, so the lane starts on a
 * declared guess from the unit and then auto-ranges from the live window (the
 * scope prints the range it is using, so the trace is never ambiguous).
 */
export function laneForChannel(meta: ChannelMeta, index: number, display: UnitDisplayFn): ScopeLane {
  const sourceUnit = (meta.units ?? '').trim();
  const conv = unitConversionForLabel(sourceUnit, display);
  const range = guessRangeForUnit(sourceUnit);
  return {
    id: `ch:${meta.name}`,
    channel: meta.name,
    label: (meta.label || meta.name).toUpperCase().slice(0, 12),
    sourceUnit,
    unit: conv.unit,
    scale: conv.scale,
    offset: conv.offset,
    color: seriesVar(index),
    min: range.min * conv.scale + conv.offset,
    max: range.max * conv.scale + conv.offset,
    digits: range.digits,
    zeroIsGap: false,
    autoRange: true,
  };
}

/**
 * The INI's unit strings are free text ("degC", "°C", "kpa", "psi"), so each is
 * mapped onto (a) a factor into the unit family's base unit and then (b) the
 * user's preferred unit — never skipped, or an INI that already publishes PSI
 * would be converted twice.
 */
function unitConversionForLabel(unit: string, display: UnitDisplayFn): UnitDisplay {
  const normalised = unit.toLowerCase().replace(/\s+/g, '');

  const pressure: Record<string, number> = { kpa: 1, psi: 6.89476, bar: 100, inhg: 3.38639 };
  for (const [spelling, toKpa] of Object.entries(pressure)) {
    if (normalised.includes(spelling)) {
      const target = display('kPa');
      return { scale: toKpa * target.scale, offset: target.offset, unit: target.unit };
    }
  }

  if (normalised.includes('degc') || normalised === 'c' || normalised.includes('°c') || normalised.includes('celsius')) {
    return display('°C');
  }
  if (normalised.includes('degf') || normalised === 'f' || normalised.includes('°f') || normalised.includes('fahrenheit')) {
    // The INI publishes °F: convert to °C first, then to the user's choice.
    const toC = { scale: 5 / 9, offset: -32 * (5 / 9) };
    const target = display('°C');
    return {
      scale: toC.scale * target.scale,
      offset: toC.offset * target.scale + target.offset,
      unit: target.unit,
    };
  }

  if (normalised.includes('km/h') || normalised.includes('kph') || normalised.includes('kmh')) {
    return display('km/h');
  }
  if (normalised.includes('mph')) {
    const target = display('km/h');
    return { scale: 1.609344 * target.scale, offset: target.offset, unit: target.unit };
  }

  if (normalised.includes('lambda') || normalised.includes('λ')) return display('λ');
  if (normalised.includes('afr')) return display('AFR');
  return { scale: 1, offset: 0, unit };
}

function guessRangeForUnit(unit: string): { min: number; max: number; digits: number } {
  const normalised = unit.toLowerCase();
  if (normalised.includes('kpa') || normalised.includes('psi') || normalised.includes('bar')) {
    return { min: 0, max: 300, digits: 1 };
  }
  if (normalised.includes('°c') || normalised.includes('degc') || normalised === 'c') {
    return { min: 0, max: 150, digits: 0 };
  }
  if (normalised.includes('%')) return { min: 0, max: 100, digits: 1 };
  if (normalised.includes('ms')) return { min: 0, max: 25, digits: 2 };
  if (normalised.includes('v') && normalised.length <= 2) return { min: 0, max: 16, digits: 2 };
  if (normalised.includes('deg') || normalised === '°') return { min: -20, max: 60, digits: 1 };
  return { min: 0, max: 100, digits: 2 };
}

/**
 * Build the lane list for a set of ids against the channels the ECU publishes.
 *
 * `meta` supplies labels/units for free channels; unknown ids are skipped rather
 * than rendered empty.
 */
export function buildLanes(
  ids: string[],
  resolved: Map<string, string>,
  meta: ChannelMeta[],
  display: UnitDisplayFn,
): ScopeLane[] {
  const lanes: ScopeLane[] = [];
  let seriesIndex = 0;
  for (const id of ids) {
    if (id.startsWith('ch:')) {
      const name = id.slice(3);
      const found = meta.find((m) => m.name === name);
      if (!found) continue;
      lanes.push(laneForChannel(found, seriesIndex++, display));
      continue;
    }
    const spec = CHANNELS[id];
    const channel = resolved.get(id);
    if (!spec || channel === undefined) continue;
    // The fuel lane gets the commanded trace when the ECU publishes one.
    let target: { channel: string; unit: string } | undefined;
    if (spec.id === 'lambda') {
      const lambdaTarget = resolved.get('lambdaTarget');
      const afrTarget = resolved.get('afrTarget');
      if (lambdaTarget !== undefined) target = { channel: lambdaTarget, unit: 'λ' };
      else if (afrTarget !== undefined) target = { channel: afrTarget, unit: 'AFR' };
    }
    lanes.push(laneForSpec(spec, channel, display, target));
  }
  return lanes;
}

/** Human name for a lane id (used by the picker). */
export function laneLabel(id: string, meta: ChannelMeta[]): string {
  if (id.startsWith('ch:')) {
    const name = id.slice(3);
    const found = meta.find((m) => m.name === name);
    return found?.label || name;
  }
  return CHANNELS[id]?.label ?? id;
}
