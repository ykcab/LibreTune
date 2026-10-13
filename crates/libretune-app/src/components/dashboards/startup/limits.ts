/**
 * Startup dashboard — user-adjustable limits.
 *
 * The catalogue's threshold bands are documented defaults (gasoline-oriented:
 * EGT 850/950 °C, IAT 60/80 °C, coolant 105/115 °C…). They are right for most
 * Speeduino/rusEFI/FOME/epicEFI installs and wrong for some engines — a diesel,
 * a track car with a 120 °C thermostat, an engine whose hot idle sits at 1 bar of
 * oil pressure.
 *
 * So the *defaults* live in the catalogue and the *overrides* live here: a tiny
 * per-channel `{ warn, crit }` map persisted in local storage (the same
 * mechanism the unit preferences and the scope's lane selection use). Overrides
 * apply to the printed threshold bands, the meters, the alarms and the derived
 * rules alike, because all four read the same effective spec.
 *
 * Values are stored in the channel's **source** units; the editor converts to and
 * from the user's display units.
 */
import { CHANNEL_LIST, type Band, type ChannelSpec } from './channels';

export const LIMIT_STORAGE_KEY = 'libretune-startup-limits';

export interface LimitOverride {
  warn?: number;
  crit?: number;
}

export type LimitOverrides = Record<string, LimitOverride>;

/** Which side of a channel is dangerous. */
export type LimitDirection = 'above' | 'below';

/**
 * Direction is derived from the default bands: a low-is-bad channel (oil
 * pressure, fuel level) ends in the `ok` band, a high-is-bad channel does not.
 */
export function limitDirection(bands: Band[] | undefined): LimitDirection {
  if (!bands || bands.length === 0) return 'above';
  return bands[bands.length - 1].tone === 'ok' ? 'below' : 'above';
}

/** Rebuild ascending bands from a `{ warn, crit }` pair. */
export function bandsWithLimits(
  defaultBands: Band[] | undefined,
  override: LimitOverride | undefined,
): Band[] | undefined {
  if (!override || (override.warn === undefined && override.crit === undefined)) return defaultBands;
  const direction = limitDirection(defaultBands);
  const source = defaultBands ?? [];
  const labelFor = (tone: Band['tone'], fallback: string) =>
    source.find((band) => band.tone === tone)?.label ?? fallback;

  const okLabel = labelFor('ok', 'NOMINAL');
  const warnLabel = labelFor('warn', 'HIGH');
  const critLabel = labelFor('crit', 'CRITICAL');
  const INF = Number.POSITIVE_INFINITY;

  // A pair where only one side was given keeps the default for the other.
  const edges = limitEdges(defaultBands);
  if (!edges) return defaultBands;
  const warn = override.warn ?? edges.warn;
  const crit = override.crit ?? edges.crit;

  return direction === 'above'
    ? [
        { max: warn, tone: 'ok', label: okLabel },
        { max: crit, tone: 'warn', label: warnLabel },
        { max: INF, tone: 'crit', label: critLabel },
      ]
    : [
        { max: crit, tone: 'crit', label: critLabel },
        { max: warn, tone: 'warn', label: warnLabel },
        { max: INF, tone: 'ok', label: okLabel },
      ];
}

/** Apply overrides to a catalogue, returning the specs the UI and rules use. */
export function applyLimitOverrides(
  specs: Record<string, ChannelSpec>,
  overrides: LimitOverrides,
): Record<string, ChannelSpec> {
  const ids = Object.keys(overrides);
  if (ids.length === 0) return specs;
  const out: Record<string, ChannelSpec> = { ...specs };
  for (const id of ids) {
    const spec = specs[id];
    if (!spec) continue;
    // Two-sided channels cannot be expressed as one pair; leave them documented.
    if (isMixedDirection(spec.bands)) continue;
    const bands = bandsWithLimits(spec.bands, overrides[id]);
    if (bands !== spec.bands) out[id] = { ...spec, bands };
  }
  return out;
}

/** Channels a user can meaningfully re-band (those with a documented limit). */
export interface LimitField {
  id: string;
  label: string;
  title: string;
  unit: string;
  digits: number;
  direction: LimitDirection;
  /** Effective values, in source units. */
  warn: number;
  crit: number;
  /** Catalogue defaults, for the "reset" affordance. */
  defaultWarn: number;
  defaultCrit: number;
}

/**
 * A channel with warnings on *both* sides (battery: low *and* overcharge) cannot
 * be expressed as one `{warn, crit}` pair, so it is not offered for override —
 * better to leave it exactly as documented than to silently drop a limit.
 */
export function isMixedDirection(bands: Band[] | undefined): boolean {
  if (!bands || bands.length < 3) return false;
  const tones = bands.map((band) => band.tone);
  const firstOk = tones.indexOf('ok');
  if (firstOk <= 0) return false;
  return tones.slice(0, firstOk).some((tone) => tone === 'warn' || tone === 'crit')
    && tones.slice(firstOk + 1).some((tone) => tone === 'warn' || tone === 'crit');
}

/**
 * The `{ warn, crit }` thresholds a user would name for a channel, taken from the
 * edges where the bands get *more* dangerous. Returns null for a channel whose
 * limits cannot be expressed as one pair (no critical threshold at all, or
 * warnings on both sides).
 */
export function limitEdges(bands: Band[] | undefined): { warn: number; crit: number } | null {
  if (!bands || bands.length < 2 || isMixedDirection(bands)) return null;
  const edge = (index: number, side: 'lo' | 'hi'): number | undefined => {
    const value = side === 'lo' ? (index > 0 ? bands[index - 1].max : undefined) : bands[index].max;
    return value !== undefined && Number.isFinite(value) ? value : undefined;
  };
  const warnIndex = bands.findIndex((band) => band.tone === 'warn');
  const critIndex = bands.findIndex((band) => band.tone === 'crit');
  if (warnIndex < 0) return null;

  if (limitDirection(bands) === 'above') {
    // Danger is entered from below: the warn threshold is the warn band's lower
    // edge (falling back to its upper edge for a band that starts at "any value",
    // like the fuel-trim warn band), and the critical threshold is where the
    // critical band begins.
    const warn = edge(warnIndex, 'lo') ?? edge(warnIndex, 'hi');
    const crit = critIndex >= 0 ? edge(critIndex, 'lo') : edge(warnIndex, 'hi');
    if (warn === undefined || crit === undefined) return null;
    return { warn, crit };
  }

  // Danger is entered from above: the thresholds are the bands' upper edges.
  if (critIndex < 0) return null;
  const crit = edge(critIndex, 'hi');
  const warn = edge(warnIndex, 'hi');
  if (warn === undefined || crit === undefined) return null;
  return { warn, crit };
}

export function limitFields(overrides: LimitOverrides): LimitField[] {
  const fields: LimitField[] = [];
  for (const spec of CHANNEL_LIST) {
    const edges = limitEdges(spec.bands);
    if (!edges) continue;
    const override = overrides[spec.id];
    fields.push({
      id: spec.id,
      label: spec.label,
      title: spec.title,
      unit: spec.unit,
      digits: spec.digits,
      direction: limitDirection(spec.bands),
      warn: override?.warn ?? edges.warn,
      crit: override?.crit ?? edges.crit,
      defaultWarn: edges.warn,
      defaultCrit: edges.crit,
    });
  }
  return fields;
}

/**
 * One channel's field, by id.
 *
 * `limitFields` always returns the whole catalogue (the argument only supplies the
 * overrides), so callers that want a single channel must look it up by id — an
 * index into the result is the first adjustable channel, not the one asked for.
 */
export function limitField(id: string, override: LimitOverride | undefined): LimitField | undefined {
  return limitFields(override ? { [id]: override } : {}).find((field) => field.id === id);
}

/** Read overrides from storage, ignoring anything malformed. */
export function loadLimitOverrides(): LimitOverrides {
  try {
    const raw = window.localStorage.getItem(LIMIT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: LimitOverrides = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as LimitOverride;
      const warn = typeof entry.warn === 'number' && Number.isFinite(entry.warn) ? entry.warn : undefined;
      const crit = typeof entry.crit === 'number' && Number.isFinite(entry.crit) ? entry.crit : undefined;
      if (warn !== undefined || crit !== undefined) out[id] = { warn, crit };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveLimitOverrides(overrides: LimitOverrides): void {
  try {
    if (Object.keys(overrides).length === 0) window.localStorage.removeItem(LIMIT_STORAGE_KEY);
    else window.localStorage.setItem(LIMIT_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* persistence is best-effort */
  }
}

/**
 * A `{ warn, crit }` pair is only meaningful in the right order, so drag the
 * other value along instead of silently swapping them.
 */
export function normaliseOverride(
  direction: LimitDirection,
  warn: number,
  crit: number,
): LimitOverride {
  return direction === 'above'
    ? { warn: Math.min(warn, crit), crit: Math.max(warn, crit) }
    : { warn: Math.max(warn, crit), crit: Math.min(warn, crit) };
}
