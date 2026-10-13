/**
 * Startup dashboard — session accumulator.
 *
 * A frame-rate-independent, React-free data model. The hook layer feeds it one
 * sample per realtime stream tick (`push`), and the UI asks it for a snapshot a
 * few times a second. Everything analytic the dashboard claims — alerts, event
 * history, fueling statistics, operating-envelope coverage, session extremes,
 * link health — is computed here so it can be unit-tested without a DOM.
 *
 * Design rules
 * ------------
 * - Never invent data: a rule can only fire from a channel the ECU publishes.
 * - Latched, hysteretic events: a blip must persist (`forMs`) before raising and
 *   must be clear for longer (`clearMs`) before resolving, so a warning cannot
 *   flicker at 10 Hz.
 * - Alarms are gated on "engine turning/running" so a stopped engine can never
 *   produce a false oil-pressure or battery event. Bands still colour the tiles.
 * - Events keep the numbers that raised them; the UI formats them at render
 *   time in the user's units.
 */
import {
  CHANNELS,
  CHANNEL_LIST,
  effectiveBoost,
  flagActive,
  FLAGS,
  fuelRatio,
  isGap,
  type Band,
  type ChannelSpec,
} from './channels';
import { applyLimitOverrides, type LimitOverrides } from './limits';
import type { EventKind, Severity, Tone } from './types';

export interface SessionEvent {
  id: number;
  rule: string;
  kind: EventKind;
  severity: Severity;
  /** Channel that produced the event (band/dropout rules). */
  channelId?: string;
  /** Value at raise time, source units. */
  value?: number;
  /** Boundary that was crossed, source units. */
  boundary?: number;
  /** Extra qualifier: band label, "LEAN"/"RICH", channel id for dropouts. */
  note?: string;
  /** First raise (ms epoch). */
  at: number;
  /** Last frame the condition held. */
  lastAt: number;
  active: boolean;
}

/** A marker on the trace, positioned relative to "now" by the scope. */
export interface SessionMarker {
  at: number;
  severity: Severity;
  kind: EventKind;
}

export interface FuelingStats {
  samples: number;
  /** Mean signed relative error (measured − target)/target over load cells. */
  meanError: number | null;
  meanAbsError: number | null;
  worstLean: { error: number; at: number } | null;
  worstRich: { error: number; at: number } | null;
}

/**
 * Current measured/commanded fuel ratio, in λ space (unit-neutral).
 *
 * The UI converts to AFR when the user prefers AFR; the relative error is
 * identical either way, which is why the analysis never depends on the
 * display preference.
 */
export interface FuelRatioState {
  measured?: number;
  target?: number;
  /** True when the ECU published that side; false when derived with stoich. */
  measuredDerived: boolean;
  targetDerived: boolean;
  /** (measured − target)/target, or null when either side is unknown. */
  error: number | null;
}

export interface CoverageStats {
  /** Sample count per bin, row-major, row = manifold-pressure bin. */
  counts: Uint32Array;
  rpmBins: number;
  mapBins: number;
  rpmStep: number;
  mapStep: number;
  rpmMin: number;
  mapMin: number;
  visited: number;
  total: number;
  /** Total samples that landed inside the map. */
  samples: number;
  /** Current operating bin, or −1 when unknown. */
  current: number;
  /** Busiest bin's sample count (heat-map scale). */
  peak: number;
  /** Mean fuelling error per bin (null where no load sample landed). */
  errorMean: (number | null)[];
  /** Load samples per bin (the weight behind `errorMean`). */
  errorSamples: Uint32Array;
  /** Worst-lean and worst-rich cells, with the operating point that produced them. */
  worstLeanCell: { error: number; rpm: number; map: number } | null;
  worstRichCell: { error: number; rpm: number; map: number } | null;
  /** How far the engine has actually been, for honest axis labelling. */
  rpmMaxBin: number;
  mapMaxBin: number;
}

export interface SessionExtremes {
  maxRpm?: number;
  maxBoost?: number;
  maxCoolant?: number;
  maxOilTemp?: number;
  maxEgt?: number;
  maxSpeed?: number;
  minOilPressure?: number;
}

export interface SessionSnapshot {
  /** Monotonic revision — increments on every push (cheap change detection). */
  revision: number;
  startedAt: number;
  lastSampleAt: number;
  samples: number;
  /** Smoothed stream rate in Hz (0 when unknown). */
  rateHz: number;
  /** Mean observed sample interval in ms (used for the scope's time axis). */
  intervalMs: number;
  /** ms since the last sample at snapshot time. */
  staleMs: number;
  /** Latest resolved canonical values, keyed by spec id. */
  values: Record<string, number>;
  /** IDs of the specs that resolved to a real channel. */
  present: string[];
  /** Channels in the most recent stream frame (what the ECU actually sent). */
  frameChannels: number;
  events: SessionEvent[];
  active: SessionEvent[];
  markers: SessionMarker[];
  /** ECU-reported state flags asserted right now (never derived). */
  flags: { label: string; tone: string; title: string }[];
  fuel: FuelRatioState;
  fueling: FuelingStats;
  coverage: CoverageStats;
  extremes: SessionExtremes;
}
/* --------------------------------------------------------------- bin geometry */

/**
 * The operating-envelope grid.
 *
 * Geometry is derived from the engine rather than fixed, so "cells visited" is a
 * fraction of the envelope this car can actually reach:
 *  - **rpm axis**: sized from the ECU's rev limit when it publishes one
 *    (rounded up to the next bin), otherwise 8000 rpm — set once per session.
 *  - **map axis**: starts at a naturally-aspirated range and *grows* when the
 *    engine is observed above it. Growth appends whole rows, so the existing
 *    counts (row-major, rpm fastest) are preserved exactly.
 *
 * A grid never shrinks inside a session: a run that briefly sees 250 kPa should
 * not silently re-bin itself the moment boost falls away.
 */
export class CoverageGrid {
  readonly rpmStep = COVERAGE_RPM_STEP;
  readonly mapStep = COVERAGE_MAP_STEP;
  rpmBins = COVERAGE_RPM_DEFAULT_BINS;
  mapBins = COVERAGE_MAP_DEFAULT_BINS;

  counts = new Uint32Array(this.rpmBins * this.mapBins);
  errorSum = new Float64Array(this.rpmBins * this.mapBins);
  errorCounts = new Uint32Array(this.rpmBins * this.mapBins);

  visited = 0;
  samples = 0;
  current = -1;
  peak = 0;

  /** Set the rpm axis once, from the ECU's own rev limit. */
  setRpmLimit(limit: number | undefined): void {
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return;
    const bins = Math.max(
      COVERAGE_RPM_DEFAULT_BINS,
      Math.min(COVERAGE_RPM_MAX_BINS, Math.ceil(limit / this.rpmStep) + 1),
    );
    if (bins <= this.rpmBins) return;
    const counts = new Uint32Array(bins * this.mapBins);
    const errorSum = new Float64Array(bins * this.mapBins);
    const errorCounts = new Uint32Array(bins * this.mapBins);
    for (let row = 0; row < this.mapBins; row++) {
      counts.set(this.counts.subarray(row * this.rpmBins, (row + 1) * this.rpmBins), row * bins);
      errorSum.set(this.errorSum.subarray(row * this.rpmBins, (row + 1) * this.rpmBins), row * bins);
      errorCounts.set(this.errorCounts.subarray(row * this.rpmBins, (row + 1) * this.rpmBins), row * bins);
    }
    this.rpmBins = bins;
    this.counts = counts;
    this.errorSum = errorSum;
    this.errorCounts = errorCounts;
    this.current = -1;
  }

  /** Grow the map axis to hold `mapKpa` (whole rows are appended). */
  ensureMapBins(mapKpa: number): void {
    const needed = Math.min(COVERAGE_MAP_MAX_BINS, Math.ceil(mapKpa / this.mapStep) + 1);
    if (needed <= this.mapBins) return;
    const cells = this.rpmBins * needed;
    const counts = new Uint32Array(cells);
    const errorSum = new Float64Array(cells);
    const errorCounts = new Uint32Array(cells);
    counts.set(this.counts);
    errorSum.set(this.errorSum);
    errorCounts.set(this.errorCounts);
    this.mapBins = needed;
    this.counts = counts;
    this.errorSum = errorSum;
    this.errorCounts = errorCounts;
  }

  /** Record one operating point (plus its fuelling error, when there is one). */
  add(rpm: number, mapKpa: number, error: number | null): void {
    this.ensureMapBins(mapKpa);
    const rb = Math.floor(rpm / this.rpmStep);
    const mb = Math.floor(mapKpa / this.mapStep);
    if (rb < 0 || rb >= this.rpmBins || mb < 0 || mb >= this.mapBins) {
      this.current = -1;
      return;
    }
    const index = mb * this.rpmBins + rb;
    if (this.counts[index] === 0) this.visited++;
    this.counts[index]++;
    this.samples++;
    this.current = index;
    if (this.counts[index] > this.peak) this.peak = this.counts[index];
    if (error !== null) {
      this.errorSum[index] += error;
      this.errorCounts[index]++;
    }
  }

  /** Highest bin that carries a sample (for axis labelling). */
  get rpmMaxBin(): number {
    for (let rb = this.rpmBins - 1; rb >= 0; rb--) {
      for (let mb = 0; mb < this.mapBins; mb++) {
        if (this.counts[mb * this.rpmBins + rb] > 0) return rb;
      }
    }
    return 0;
  }

  get mapMaxBin(): number {
    for (let mb = this.mapBins - 1; mb >= 0; mb--) {
      for (let rb = 0; rb < this.rpmBins; rb++) {
        if (this.counts[mb * this.rpmBins + rb] > 0) return mb;
      }
    }
    return 0;
  }

  /** Mean fuelling error per cell (null where no load sample landed). */
  errorMeans(): (number | null)[] {
    const out: (number | null)[] = new Array(this.errorCounts.length);
    for (let i = 0; i < this.errorCounts.length; i++) {
      out[i] = this.errorCounts[i] > 0 ? this.errorSum[i] / this.errorCounts[i] : null;
    }
    return out;
  }

  errorSamplesCopy(): Uint32Array {
    return this.errorCounts.slice();
  }

  countsCopy(): Uint32Array {
    return this.counts.slice();
  }
}

export const COVERAGE_RPM_STEP = 500;
/** Axis defaults: 0–8000 rpm × 0–120 kPa, grown as the engine is observed. */
export const COVERAGE_RPM_DEFAULT_BINS = 16;
export const COVERAGE_RPM_MAX_BINS = 24; // 0 – 12 000 rpm
export const COVERAGE_MAP_STEP = 20;
export const COVERAGE_MAP_DEFAULT_BINS = 6; // 0 – 120 kPa (naturally aspirated)
export const COVERAGE_MAP_MAX_BINS = 16; // 0 – 320 kPa (hard boost)

/** Engine is genuinely running (oil pressure, duty, thermal, fueling rules). */
const RUNNING_RPM = 400;
/** Engine is turning (sync + sensor-dropout rules — cranking counts). */
const TURNING_RPM = 60;
/** "Load cell" definition used by the fueling statistics + fueling rules. */
const LOAD_RPM = 1500;
const LOAD_MAP = 100;
/** How long a marker stays on the trace. */
const MARKER_WINDOW_MS = 30_000;
const MAX_EVENTS = 80;
/** Bands are evaluated on this (source-unit) fuel ratio space. */
const STATS_UNIT: 'AFR' | 'Lambda' = 'Lambda';

interface RuleContext {
  /** Resolved stream key → raw value for every spec the ECU publishes. */
  raw: (spec: ChannelSpec) => number | undefined;
  /** Raw value, but undefined when the channel is in a "gap" state (raw 0). */
  get: (spec: ChannelSpec) => number | undefined;
  has: (spec: ChannelSpec) => boolean;
  rpm?: number;
  running: boolean;
  turning: boolean;
  loaded: boolean;
  fueling: { error: number; lean: boolean; measured: number; target: number } | null;
  boost?: number;
  boostTarget?: number;
}

interface Rule {
  id: string;
  kind: EventKind;
  severity: Severity;
  channelId?: string;
  /** Continuous time the condition must hold before raising (default 600 ms). */
  forMs?: number;
  /** Continuous time it must be false before clearing (default 2500 ms). */
  clearMs?: number;
  evaluate: (ctx: RuleContext) => { value?: number; boundary?: number; note?: string } | null;
}

/** Tone severity, for choosing which band edge is the meaningful limit. */
const TONE_RANK: Record<Tone, number> = { ok: 0, dim: 0, info: 1, warn: 1, crit: 2 };

/**
 * The edge of a band that a tuner would call "the limit".
 *
 * A band is entered from whichever neighbour is *less* dangerous, so that
 * transition is the number to name: coolant warms into `warn` at 105 °C (its
 * lower edge), while oil pressure falls into `warn` at 90 kPa (its upper edge).
 * Mixed channels (battery: low *and* high warnings) resolve per band, not per
 * channel.
 */
function limitEdge(
  bands: Band[],
  index: number,
): number | undefined {
  const band = bands[index];
  const rank = TONE_RANK[band.tone];
  const previous = index > 0 ? bands[index - 1] : undefined;
  const next = index + 1 < bands.length ? bands[index + 1] : undefined;
  const lowerIsSafer = previous === undefined || TONE_RANK[previous.tone] < rank;
  const upperIsSafer = next === undefined || TONE_RANK[next.tone] < rank;
  const lo = previous?.max ?? Number.NEGATIVE_INFINITY;
  const hi = band.max;
  if (lowerIsSafer && !upperIsSafer) return Number.isFinite(lo) ? lo : hi;
  if (upperIsSafer && !lowerIsSafer) return Number.isFinite(hi) ? hi : lo;
  return Number.isFinite(lo) ? lo : hi;
}

/** Build limit rules from the catalogue's bands: each non-ok band is an alarm. */
function bandRules(specs: Record<string, ChannelSpec>, overrides: LimitOverrides): Rule[] {
  const rules: Rule[] = [];
  for (const spec of CHANNEL_LIST) {
    const effective = specs[spec.id] ?? spec;
    if (!effective.bands) continue;
    if (effective.id === 'sync') continue; // dedicated rule below
    // Oil pressure is judged against an rpm-scaled minimum unless the user has
    // set their own floor (see `oilPressureRule`).
    if (effective.id === 'oilPressure' && !overrides.oilPressure) continue;
    effective.bands.forEach((band, index) => {
      const previous = index > 0 ? effective.bands?.[index - 1] : undefined;
      const lo = previous?.max ?? Number.NEGATIVE_INFINITY;
      const hi = band.max;
      if (band.tone !== 'warn' && band.tone !== 'crit') return;
      const boundary = limitEdge(effective.bands!, index) ?? hi;
      rules.push({
        id: `band:${effective.id}:${band.tone}`,
        kind: 'limit',
        severity: band.tone,
        channelId: effective.id,
        // Knock is a discrete event: raise on the first frame, don't wait.
        forMs: effective.id === 'knock' ? 0 : 600,
        evaluate: (ctx) => {
          if (!ctx.running) return null;
          const value = ctx.get(effective);
          if (value === undefined) return null;
          if (!(value > lo && value <= hi)) return null;
          return { value, boundary, note: band.label };
        },
      });
    });
  }
  return rules;
}

/**
 * The rules that are not derived from a band: fuelling error, trigger sync and
 * overboost. `boostCeiling` is the user's own boost limit, used only when the
 * ECU publishes no commanded boost target.
 */
function customRules(boostCeiling: number | undefined): Rule[] {
  return [
  {
    id: 'fueling:lean',
    kind: 'fueling',
    severity: 'warn',
    forMs: 500,
    evaluate: (ctx) => {
      if (!ctx.loaded || !ctx.fueling?.lean) return null;
      const err = ctx.fueling.error;
      if (err < 0.04) return null;
      return {
        value: err,
        boundary: 0.04,
        note: err >= 0.1 ? 'LEAN — OVER 10 % OF TARGET' : 'LEAN OF TARGET',
      };
    },
  },
  {
    id: 'fueling:rich',
    kind: 'fueling',
    severity: 'info',
    forMs: 800,
    evaluate: (ctx) => {
      if (!ctx.loaded || ctx.fueling?.lean !== false) return null;
      const err = ctx.fueling.error;
      if (err > -0.12) return null;
      return { value: err, boundary: -0.12, note: 'RICH — OVER 12 % UNDER TARGET' };
    },
  },
  {
    id: 'sync:loss',
    kind: 'sync',
    severity: 'crit',
    forMs: 200,
    clearMs: 1000,
    evaluate: (ctx) => {
      const spec = CHANNELS.sync;
      if (!ctx.has(spec)) return null;
      const value = ctx.raw(spec);
      if (value === undefined) return null;
      if (!ctx.turning) return null;
      if (value > 0.5) return null;
      return { value, boundary: 0.5, note: 'TRIGGER SYNC LOST' };
    },
  },
  {
    id: 'boost:over',
    kind: 'boost',
    severity: 'warn',
    channelId: 'boost',
    forMs: 300,
    evaluate: (ctx) => {
      if (ctx.boost === undefined) return null;
      // The ECU's commanded target wins; failing that, the driver's own ceiling.
      const ceiling = ctx.boostTarget !== undefined && ctx.boostTarget > 0 ? ctx.boostTarget : boostCeiling;
      if (ceiling === undefined || ceiling <= 0) return null;
      if (ctx.boost <= ceiling + 20) return null;
      return {
        value: ctx.boost,
        boundary: ceiling,
        note:
          ctx.boostTarget !== undefined && ctx.boostTarget > 0
            ? 'OVER BOOST TARGET'
            : 'OVER YOUR BOOST CEILING',
      };
    },
  },
  ];
}

/**
 * Oil pressure: minimum pressure scales with engine speed.
 *
 * A fixed floor (the catalogue used to warn below 110 kPa) false-alarms on any
 * engine whose hot idle sits near 1 bar. The rule of thumb this implements is the
 * long-standing "≈10 psi per 1000 rpm" (69 kPa), armed above 1200 rpm so idle and
 * cranking are never judged, with a 2 s dwell so a shift or a throttle lift
 * cannot trip it. Below 60 % of the scaled minimum it is critical.
 *
 * A user override replaces this with their own fixed floor — predictable, and
 * their engine's numbers win over a rule of thumb.
 */
const OIL_MIN_KPA_PER_1000RPM = 69;
const OIL_MIN_ARM_RPM = 1200;
export { OIL_MIN_KPA_PER_1000RPM, OIL_MIN_ARM_RPM };

function oilPressureRule(): Rule {
  return {
    id: 'oilp:scaled',
    kind: 'limit',
    severity: 'warn',
    channelId: 'oilPressure',
    forMs: 2000,
    clearMs: 2000,
    evaluate: (ctx) => {
      const spec = CHANNELS.oilPressure;
      if (!ctx.has(spec)) return null;
      const rpm = ctx.rpm;
      if (rpm === undefined || rpm < OIL_MIN_ARM_RPM) return null;
      const value = ctx.get(spec);
      if (value === undefined) return null;
      const minimum = (OIL_MIN_KPA_PER_1000RPM * rpm) / 1000;
      if (value >= minimum) return null;
      const critical = value < minimum * 0.6;
      return {
        value,
        boundary: minimum,
        note: critical
          ? `BELOW ${minimum.toFixed(0)} kPa NEEDED AT ${rpm.toFixed(0)} RPM`
          : `LOW FOR ${rpm.toFixed(0)} RPM (MIN ${minimum.toFixed(0)} kPa)`,
      };
    },
  };
}

/**
 * Bank-to-bank lambda split.
 *
 * With two widebands fitted the insight is the difference between them: a
 * partly blocked injector or a dead coil on one bank shows as a step that an
 * averaged lambda hides. Only meaningful under load, where fuel demand is high.
 */
const BANK_SPLIT_WARN = 0.06;
const BANK_SPLIT_CRIT = 0.12;

function bankSplitRules(): Rule[] {
  return [
    {
      id: 'bank:split:warn',
      kind: 'fueling',
      severity: 'warn',
      channelId: 'lambdaBank2',
      forMs: 800,
      evaluate: (ctx) => {
        const first = ctx.get(CHANNELS.lambda);
        const second = ctx.get(CHANNELS.lambdaBank2);
        if (first === undefined || second === undefined || !ctx.loaded) return null;
        const split = second - first;
        const magnitude = Math.abs(split);
        if (magnitude < BANK_SPLIT_WARN || magnitude >= BANK_SPLIT_CRIT) return null;
        return {
          value: split,
          boundary: BANK_SPLIT_WARN,
          note: `${split > 0 ? 'BANK 2' : 'BANK 1'} LEANER BY ${magnitude.toFixed(3)} λ`,
        };
      },
    },
    {
      id: 'bank:split:crit',
      kind: 'fueling',
      severity: 'crit',
      channelId: 'lambdaBank2',
      forMs: 800,
      evaluate: (ctx) => {
        const first = ctx.get(CHANNELS.lambda);
        const second = ctx.get(CHANNELS.lambdaBank2);
        if (first === undefined || second === undefined || !ctx.loaded) return null;
        const split = second - first;
        if (Math.abs(split) < BANK_SPLIT_CRIT) return null;
        return {
          value: split,
          boundary: BANK_SPLIT_CRIT,
          note: `${split > 0 ? 'BANK 2' : 'BANK 1'} LEANER BY ${Math.abs(split).toFixed(3)} λ`,
        };
      },
    },
  ];
}

/** Dropout rules: a channel the ECU publishes that has collapsed to raw 0. */
function dropoutRules(): Rule[] {
  return CHANNEL_LIST.filter((spec) => spec.zeroIsGap === true).map((spec) => ({
    id: `dropout:${spec.id}`,
    kind: 'dropout' as EventKind,
    severity: 'warn' as Severity,
    channelId: spec.id,
    forMs: 1200,
    clearMs: 1500,
    evaluate: (ctx: RuleContext) => {
      if (!ctx.turning || !ctx.has(spec)) return null;
      const value = ctx.raw(spec);
      if (value === undefined || !Number.isFinite(value)) return null;
      // Widebands read 0 until the heater is up; don't cry sensor failure for
      // the first seconds of a cold start (rpm gate handles a stopped engine).
      if (isGap(spec, value) !== true) return null;
      return { value, boundary: 0, note: `${spec.label} READING 0` };
    },
  }));
}

/* -------------------------------------------------------------------- session */

interface RuntimeState {
  raisedAt?: number;
  clearedAt?: number;
  active: boolean;
  event?: SessionEvent;
}

export class TelemetrySession {
  private rules: Rule[] = [];
  private runtime = new Map<string, RuntimeState>();
  private events: SessionEvent[] = [];
  private nextEventId = 1;
  /** Effective catalogue (catalogue + user limit overrides). */
  private specs: Record<string, ChannelSpec> = { ...CHANNELS };
  private overrides: LimitOverrides = {};

  /** spec id → resolved stream key. */
  private resolved = new Map<string, string>();
  /** Channel names the ECU publishes (INI channel list ∪ live stream keys). */
  private knownChannels = new Set<string>();

  private grid = new CoverageGrid();
  private worstLeanCell: { error: number; rpm: number; map: number } | null = null;
  private worstRichCell: { error: number; rpm: number; map: number } | null = null;

  private fuelSamples = 0;
  private fuelSum = 0;
  private fuelAbsSum = 0;
  private fuelWorstLean: { error: number; at: number } | null = null;
  private fuelWorstRich: { error: number; at: number } | null = null;

  private extremes: SessionExtremes = {};

  private startedAt = 0;
  private lastSampleAt = 0;
  private sampleCount = 0;
  private intervalMs = 0;
  private rateHz = 0;
  private revision = 0;
  private latest: Record<string, number> = {};
  private frameChannels = 0;
  private flags: { label: string; tone: string; title: string }[] = [];
  private fuel: FuelRatioState = {
    measured: undefined,
    target: undefined,
    measuredDerived: false,
    targetDerived: false,
    error: null,
  };

  constructor(private readonly stoichProvider: () => number = () => 14.7) {
    this.rebuildRules();
  }

  /**
   * Apply the user's threshold overrides.
   *
   * Rule ids are stable, so latching state survives a threshold change; only the
   * comparison changes. A stopped engine still raises nothing: every gated rule
   * re-checks `running`/`turning` on each frame.
   */
  setLimitOverrides(overrides: LimitOverrides): void {
    this.overrides = overrides;
    this.specs = applyLimitOverrides(CHANNELS, overrides);
    this.rebuildRules();
  }

  /** The effective catalogue (with overrides applied) — the UI renders this. */
  get effectiveSpecs(): Record<string, ChannelSpec> {
    return this.specs;
  }

  private rebuildRules(): void {
    const boostCeiling = this.overrides.boost?.warn;
    this.rules = [
      ...bandRules(this.specs, this.overrides),
      ...customRules(boostCeiling),
      // Default oil rule is rpm-scaled; a user floor replaces it (bandRules adds
      // the band rule back for that channel when an override exists).
      ...(this.overrides.oilPressure ? [] : [oilPressureRule()]),
      ...bankSplitRules(),
      ...dropoutRules(),
    ];
  }

  /** Register the channel names the ECU publishes (INI list, then live keys). */
  syncChannels(names: Iterable<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.knownChannels.has(name)) {
        this.knownChannels.add(name);
        changed = true;
      }
    }
    if (changed) this.resolveChannels();
  }

  private resolveChannels(): void {
    for (const spec of CHANNEL_LIST) {
      if (this.resolved.has(spec.id)) continue;
      const key = spec.keys.find((candidate) => this.knownChannels.has(candidate));
      if (key !== undefined) this.resolved.set(spec.id, key);
    }
  }

  get resolvedCount(): number {
    return this.resolved.size;
  }

  /** Number of live-detection rules being watched (shown in the events panel). */
  get monitorCount(): number {
    return this.rules.length;
  }

  /** Channel names the ECU is known to publish (INI list ∪ stream keys). */
  get knownChannelCount(): number {
    return this.knownChannels.size;
  }

  /** How many rules of each kind are being watched (documents the monitoring). */
  get monitorBreakdown(): Record<EventKind, number> {
    const out: Record<EventKind, number> = { limit: 0, fueling: 0, dropout: 0, sync: 0, boost: 0 };
    for (const rule of this.rules) out[rule.kind]++;
    return out;
  }

  /**
   * Rules that can actually fire for the loaded definition: the channel is
   * resolved, and — because every limit and dropout rule is gated on the engine
   * turning — the ECU publishes an rpm channel. Anything else is a rule that
   * would never run, and the events panel must not claim it is watching it.
   */
  get armedBreakdown(): { total: number; byKind: Record<EventKind, number>; gated: boolean } {
    const byKind: Record<EventKind, number> = { limit: 0, fueling: 0, dropout: 0, sync: 0, boost: 0 };
    const gated = !this.resolved.has('rpm');
    if (gated) return { total: 0, byKind, gated };

    const hasMeasuredRatio = this.resolved.has('lambda') || this.resolved.has('afr');
    const hasCommandedRatio = this.resolved.has('lambdaTarget') || this.resolved.has('afrTarget');
    const hasBoostTarget = ['boostTarget', 'targetBoost', 'boostControlTarget'].some((key) =>
      this.knownChannels.has(key),
    );

    for (const rule of this.rules) {
      if (rule.channelId !== undefined && !this.resolved.has(rule.channelId)) continue;
      // Rules that pair two channels need both halves to be useful.
      if (rule.kind === 'fueling' && !(hasMeasuredRatio && hasCommandedRatio)) continue;
      if (rule.id.startsWith('bank:') && !(this.resolved.has('lambda') && this.resolved.has('lambdaBank2'))) {
        continue;
      }
      if (rule.kind === 'boost' && !(this.resolved.has('boost') && hasBoostTarget)) continue;
      byKind[rule.kind]++;
    }
    const total = Object.values(byKind).reduce((sum, value) => sum + value, 0);
    return { total, byKind, gated };
  }

  hasChannel(id: string): boolean {
    return this.resolved.has(id);
  }

  /** Stream key for a catalogued channel (undefined when the ECU doesn't publish it). */
  keyFor(id: string): string | undefined {
    return this.resolved.get(id);
  }

  reset(): void {
    this.runtime = new Map();
    this.events = [];
    this.nextEventId = 1;
    this.grid = new CoverageGrid();
    this.worstLeanCell = null;
    this.worstRichCell = null;
    this.fuelSamples = 0;
    this.fuelSum = 0;
    this.fuelAbsSum = 0;
    this.fuelWorstLean = null;
    this.fuelWorstRich = null;
    this.extremes = {};
    this.startedAt = 0;
    this.lastSampleAt = 0;
    this.sampleCount = 0;
    this.intervalMs = 0;
    this.rateHz = 0;
    this.latest = {};
    this.frameChannels = 0;
    this.fuel = {
      measured: undefined,
      target: undefined,
      measuredDerived: false,
      targetDerived: false,
      error: null,
    };
    this.flags = [];
    this.revision++;
  }

  /**
   * Ingest one stream frame.
   *
   * Called once per `realtime:update`, including frames where no channel value
   * changed — the caller subscribes to the store's `lastUpdateTime` so link
   * health stays measurable while the engine is stopped. `values` is the full
   * channel map (the store merges, so every known channel is present).
   */
  push(values: Record<string, number>, t: number): void {
    this.syncChannels(Object.keys(values));
    this.frameChannels = Object.keys(values).length;

    if (this.startedAt === 0) this.startedAt = t;
    if (this.lastSampleAt > 0) {
      const dt = t - this.lastSampleAt;
      // Ignore pauses (tab hidden, reconnect) so they don't skew the rate.
      if (dt > 0 && dt < 2000) {
        this.intervalMs = this.intervalMs === 0 ? dt : this.intervalMs * 0.9 + dt * 0.1;
        const hz = 1000 / this.intervalMs;
        this.rateHz = this.rateHz === 0 ? hz : this.rateHz * 0.9 + hz * 0.1;
      }
    }
    this.lastSampleAt = t;
    this.sampleCount++;

    const available = new Set(this.resolved.values());

    const raw = (spec: ChannelSpec): number | undefined => {
      const key = this.resolved.get(spec.id);
      if (key === undefined) return undefined;
      const value = values[key];
      return value !== undefined && Number.isFinite(value) ? value : undefined;
    };
    const get = (spec: ChannelSpec): number | undefined => {
      const value = raw(spec);
      if (value === undefined) return undefined;
      return isGap(spec, value) ? undefined : value;
    };

    // Cache the latest usable value per spec id for the UI snapshot.
    for (const spec of CHANNEL_LIST) {
      const value = get(spec);
      if (value !== undefined) this.latest[spec.id] = value;
    }

    const rpm = get(CHANNELS.rpm);
    const running = (rpm ?? 0) > RUNNING_RPM;
    const turning = (rpm ?? 0) > TURNING_RPM;
    const loaded = (rpm ?? 0) >= LOAD_RPM && (get(CHANNELS.map) ?? 0) >= LOAD_MAP;

    // Fueling error, always computed in λ space so the unit preference cannot
    // change the analysis.
    const ratio = fuelRatio(values, available, STATS_UNIT, this.stoichProvider());
    let fueling: RuleContext['fueling'] = null;
    let fuelState: FuelRatioState = {
      measured: ratio?.measured,
      target: ratio?.target,
      measuredDerived: ratio?.measuredDerived ?? false,
      targetDerived: ratio?.targetDerived ?? false,
      error: null,
    };
    if (ratio?.measured !== undefined && ratio.target !== undefined && ratio.target >= 0.6 && ratio.target <= 1.3) {
      const error = (ratio.measured - ratio.target) / ratio.target;
      fueling = { error, lean: error > 0, measured: ratio.measured, target: ratio.target };
      fuelState = { ...fuelState, error };
    }
    this.fuel = fuelState;
    this.flags = activeFlags(values);

    const boostInfo = effectiveBoost(values, available);
    let boostTarget: number | undefined;
    // Reference channels (boost target, rev limit) are not part of the channel
    // catalogue, so they are matched directly against the frame.
    for (const key of ['boostTarget', 'targetBoost', 'boostControlTarget']) {
      const value = values[key];
      if (value !== undefined && Number.isFinite(value) && value !== 0) {
        boostTarget = value;
        break;
      }
    }

    const ctx: RuleContext = {
      raw,
      get,
      has: (spec) => this.resolved.has(spec.id),
      rpm,
      running,
      turning,
      loaded,
      fueling,
      boost: boostInfo.value,
      boostTarget,
    };

    for (const rule of this.rules) this.evaluateRule(rule, ctx, t);

    // Accuracy statistics only where it matters: the load cells.
    if (fueling && loaded) {
      this.fuelSamples++;
      this.fuelSum += fueling.error;
      this.fuelAbsSum += Math.abs(fueling.error);
      if (!this.fuelWorstLean || fueling.error > this.fuelWorstLean.error) {
        this.fuelWorstLean = { error: fueling.error, at: t };
      }
      if (!this.fuelWorstRich || fueling.error < this.fuelWorstRich.error) {
        this.fuelWorstRich = { error: fueling.error, at: t };
      }
    }

    // Operating envelope (rpm × MAP dwell + fuelling error per cell).
    const mapValue = get(CHANNELS.map);
    if (rpm !== undefined && mapValue !== undefined) {
      this.grid.add(rpm, mapValue, fueling ? fueling.error : null);
      if (fueling) {
        const rpmBin = Math.floor(rpm / this.grid.rpmStep) * this.grid.rpmStep;
        const mapBin = Math.floor(mapValue / this.grid.mapStep) * this.grid.mapStep;
        if (!this.worstLeanCell || fueling.error > this.worstLeanCell.error) {
          this.worstLeanCell = { error: fueling.error, rpm: rpmBin, map: mapBin };
        }
        if (!this.worstRichCell || fueling.error < this.worstRichCell.error) {
          this.worstRichCell = { error: fueling.error, rpm: rpmBin, map: mapBin };
        }
      }
    } else {
      // No operating point this frame (engine stopped, or MAP in a gap): the
      // "current cell" must stop claiming a position that is no longer true.
      this.grid.current = -1;
    }

    // Session extremes (documented in the UI as "this session").
    const update = (key: keyof SessionExtremes, value: number | undefined, mode: 'max' | 'min' = 'max') => {
      if (value === undefined || !Number.isFinite(value)) return;
      const current = this.extremes[key];
      if (current === undefined) this.extremes[key] = value;
      else if (mode === 'max' ? value > current : value < current) this.extremes[key] = value;
    };
    update('maxRpm', rpm);
    update('maxSpeed', get(CHANNELS.speed));
    update('maxCoolant', get(CHANNELS.coolant));
    update('maxOilTemp', get(CHANNELS.oilTemp));
    update('maxEgt', get(CHANNELS.egt));
    update('minOilPressure', running ? get(CHANNELS.oilPressure) : undefined, 'min');
    if (boostInfo.value !== undefined && boostInfo.value > 0) update('maxBoost', boostInfo.value);

    this.revision++;
  }

  private evaluateRule(rule: Rule, ctx: RuleContext, t: number): void {
    const state = this.runtime.get(rule.id) ?? { active: false };
    this.runtime.set(rule.id, state);

    let result: { value?: number; boundary?: number; note?: string } | null = null;
    try {
      result = rule.evaluate(ctx);
    } catch {
      result = null; // a malformed channel must never take the dashboard down
    }

    const forMs = rule.forMs ?? 600;
    const clearMs = rule.clearMs ?? 2500;

    if (result) {
      state.clearedAt = undefined;
      if (!state.active) {
        if (state.raisedAt === undefined) {
          state.raisedAt = t;
          if (forMs <= 0) this.raise(rule, state, result, t);
        } else if (t - state.raisedAt >= forMs) {
          this.raise(rule, state, result, t);
        }
      } else if (state.event) {
        state.event.lastAt = t;
        if (result.value !== undefined) state.event.value = result.value;
      }
    } else {
      state.raisedAt = undefined;
      if (state.active) {
        if (state.clearedAt === undefined) state.clearedAt = t;
        else if (t - state.clearedAt >= clearMs) {
          state.active = false;
          if (state.event) {
            state.event.active = false;
            state.event.lastAt = state.clearedAt;
          }
        }
      }
    }
  }

  private raise(
    rule: Rule,
    state: RuntimeState,
    result: { value?: number; boundary?: number; note?: string },
    t: number,
  ): void {
    state.active = true;
    const event: SessionEvent = {
      id: this.nextEventId++,
      rule: rule.id,
      kind: rule.kind,
      severity: rule.severity,
      channelId: rule.channelId,
      value: result.value,
      boundary: result.boundary,
      note: result.note,
      at: t,
      lastAt: t,
      active: true,
    };
    state.event = event;
    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
  }

  snapshot(now: number): SessionSnapshot {
    const active: SessionEvent[] = [];
    for (const event of this.events) if (event.active) active.push(event);

    // `events` is newest-first, so the first markers are the ones nearest the
    // live edge — the part of the trace a tuner actually reads.
    const markers: SessionMarker[] = [];
    for (const event of this.events) {
      if (now - event.at <= MARKER_WINDOW_MS) {
        markers.push({ at: event.at, severity: event.severity, kind: event.kind });
      }
    }

    return {
      revision: this.revision,
      startedAt: this.startedAt,
      lastSampleAt: this.lastSampleAt,
      samples: this.sampleCount,
      rateHz: this.rateHz,
      intervalMs: this.intervalMs > 0 ? this.intervalMs : 100,
      staleMs: this.lastSampleAt > 0 ? Math.max(0, now - this.lastSampleAt) : Number.POSITIVE_INFINITY,
      values: { ...this.latest },
      present: Array.from(this.resolved.keys()),
      frameChannels: this.frameChannels,
      events: this.events.slice(),
      active,
      markers,
      flags: this.flags,
      fuel: { ...this.fuel },
      fueling: {
        samples: this.fuelSamples,
        meanError: this.fuelSamples > 0 ? this.fuelSum / this.fuelSamples : null,
        meanAbsError: this.fuelSamples > 0 ? this.fuelAbsSum / this.fuelSamples : null,
        worstLean: this.fuelWorstLean,
        worstRich: this.fuelWorstRich,
      },
      coverage: {
        counts: this.grid.countsCopy(),
        rpmBins: this.grid.rpmBins,
        mapBins: this.grid.mapBins,
        rpmStep: this.grid.rpmStep,
        mapStep: this.grid.mapStep,
        rpmMin: 0,
        mapMin: 0,
        visited: this.grid.visited,
        total: this.grid.rpmBins * this.grid.mapBins,
        samples: this.grid.samples,
        current: this.grid.current,
        peak: this.grid.peak,
        errorMean: this.grid.errorMeans(),
        errorSamples: this.grid.errorSamplesCopy(),
        worstLeanCell: this.worstLeanCell ? { ...this.worstLeanCell } : null,
        worstRichCell: this.worstRichCell ? { ...this.worstRichCell } : null,
        rpmMaxBin: this.grid.rpmMaxBin,
        mapMaxBin: this.grid.mapMaxBin,
      },
      extremes: { ...this.extremes },
    };
  }
}

/** Which ECU state chips are asserted right now (ECU-reported, never derived). */
export function activeFlags(values: Record<string, number>): { label: string; tone: string; title: string }[] {
  const out: { label: string; tone: string; title: string }[] = [];
  for (const spec of FLAGS) {
    if (flagActive(values, spec) === true) out.push({ label: spec.label, tone: spec.tone, title: spec.title });
  }
  return out;
}
