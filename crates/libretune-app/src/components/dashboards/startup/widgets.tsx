/**
 * Startup dashboard — presentational primitives.
 *
 * Everything here is pure and unit-aware: no channel literals, no thresholds,
 * no colours of its own. Tiles receive a `TileChannel` descriptor (from the
 * catalogue, or synthesised by the dash for a derived value) plus the current
 * reading, and render:
 *
 * - every number with its unit,
 * - every threshold as a labelled tick,
 * - every state as text (colour reinforces, it never carries the meaning).
 *
 * The instrument used throughout is the bullet meter (value + qualitative
 * zones + a marked threshold), which stays readable at 20 px tall and says
 * "how close to the limit" without a needle to hunt for.
 */
import { memo, type CSSProperties, type ReactNode } from 'react';
import type { Band } from './channels';
import type { ValueFormatter } from './useStartupTelemetry';

/** A channel as a tile needs it: label, unit, range, thresholds. */
export interface TileChannel {
  label: string;
  title: string;
  unit: string;
  digits: number;
  min: number;
  max: number;
  bands?: Band[];
}

export type TileTone = 'ok' | 'warn' | 'crit' | 'info' | 'dim' | 'neutral';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* --------------------------------------------------------------------- meter */

interface MeterProps {
  channel: TileChannel;
  value: number | undefined;
  fmt: ValueFormatter;
  /** Show the boundary labels under the track (default true). */
  showTicks?: boolean;
  compact?: boolean;
}

/**
 * Bullet meter: qualitative zones, the value marker, and labelled boundaries.
 * Boundaries are printed so a colour-blind user reads the same information a
 * sighted user does.
 */
export const Meter = memo(function Meter({ channel, value, fmt, showTicks = true, compact = false }: MeterProps) {
  const span = channel.max - channel.min || 1;
  const pct = (v: number) => clamp01((v - channel.min) / span) * 100;
  const bands = channel.bands ?? [];

  // Zone segments (ascending bands → left-to-right tints).
  const segments: { left: number; width: number; tone: TileTone }[] = [];
  let lower = Number.NEGATIVE_INFINITY;
  for (const band of bands) {
    const lo = Math.max(lower, channel.min);
    const hi = Math.min(band.max, channel.max);
    if (hi > lo) segments.push({ left: pct(lo), width: pct(hi) - pct(lo), tone: band.tone });
    lower = band.max;
  }

  // Boundaries worth labelling: both edges of every warn/crit band that fall
  // inside the displayed range (a low-side limit and a high-side limit are
  // marked the same way, and duplicates keep the more severe tone).
  const tickMap = new Map<number, { tone: TileTone; label: string }>();
  const severityRank: Record<string, number> = { crit: 2, warn: 1 };
  for (const band of bands) {
    if (band.tone !== 'warn' && band.tone !== 'crit') continue;
    const edges: number[] = [];
    if (Number.isFinite(band.max)) edges.push(band.max);
    const previousMax = bands[Math.max(0, bands.indexOf(band) - 1)]?.max;
    if (previousMax !== undefined && Number.isFinite(previousMax)) edges.push(previousMax);
    for (const edge of edges) {
      if (edge <= channel.min || edge >= channel.max) continue;
      const existing = tickMap.get(edge);
      if (existing && (severityRank[existing.tone] ?? 0) >= (severityRank[band.tone] ?? 0)) continue;
      tickMap.set(edge, {
        tone: band.tone,
        label: fmt.boundary(channel.unit, channel.digits, edge).text,
      });
    }
  }
  const ticks = Array.from(tickMap.entries())
    .map(([edge, entry]) => ({ at: pct(edge), tone: entry.tone, label: entry.label }))
    .sort((a, b) => a.at - b.at);

  const usable = value !== undefined && Number.isFinite(value);
  const markerPct = usable ? pct(value as number) : 0;
  const tone: TileTone = !usable ? 'dim' : toneOf(channel, value as number);

  return (
    <div className={`sd-meter${compact ? ' sd-meter--compact' : ''}`}>
      <div className="sd-meter__track" role="presentation">
        {segments.map((segment, index) => (
          <span
            key={index}
            className={`sd-meter__zone sd-meter__zone--${segment.tone}`}
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
          />
        ))}
        {ticks.map((tick) => (
          <span
            key={`t-${tick.at}-${tick.label}`}
            className={`sd-meter__tick sd-meter__tick--${tick.tone}`}
            style={{ left: `${tick.at}%` }}
          />
        ))}
        {usable && (
          <span className={`sd-meter__value sd-tone-${tone}`} style={{ left: `${markerPct}%` }} />
        )}
      </div>
      {showTicks && ticks.length > 0 && (
        <div className="sd-meter__scale">
          {ticks.map((tick) => (
            <span
              key={`l-${tick.at}-${tick.label}`}
              className={`sd-meter__scale-label sd-tone-${tick.tone}`}
              style={{ left: `${tick.at}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

function toneOf(channel: TileChannel, value: number): TileTone {
  if (!channel.bands) return 'neutral';
  let lower = Number.NEGATIVE_INFINITY;
  for (const band of channel.bands) {
    if (value > lower && value <= band.max) return band.tone;
    lower = band.max;
  }
  return 'neutral';
}

/* ---------------------------------------------------------------------- tile */

interface StatTileProps {
  channel: TileChannel;
  value: number | undefined;
  fmt: ValueFormatter;
  /** Secondary line: a target, a delta, or a qualifier. */
  detail?: ReactNode;
  /** Value tone override (derived tiles, e.g. fuel ratio). */
  tone?: TileTone;
  /** Explicit unit override (derived tiles). */
  unitOverride?: string;
  digitsOverride?: number;
  compact?: boolean;
  /** Small trailing adornment (e.g. a "derived" marker). */
  badge?: ReactNode;
}

/** A labelled numeric tile with its bullet meter. */
export const StatTile = memo(function StatTile({
  channel,
  value,
  fmt,
  detail,
  tone,
  unitOverride,
  digitsOverride,
  compact = false,
  badge,
}: StatTileProps) {
  const formatted = fmt.format(channel.unit, digitsOverride ?? channel.digits, value);
  const resolvedTone: TileTone = tone ?? (value === undefined ? 'dim' : toneOf(channel, value));
  return (
    <div className={`sd-tile${compact ? ' sd-tile--compact' : ''}`} title={channel.title}>
      <div className="sd-tile__head">
        <span className="sd-tile__label">{channel.label}</span>
        {badge}
      </div>
      <div className={`sd-tile__value sd-tone-${resolvedTone}`}>
        {formatted.text}
        {(unitOverride ?? formatted.unit) && (
          <span className="sd-tile__unit">{unitOverride ?? formatted.unit}</span>
        )}
      </div>
      {detail !== undefined && <div className="sd-tile__detail">{detail}</div>}
      <Meter channel={channel} value={value} fmt={fmt} compact={compact} showTicks={!compact} />
    </div>
  );
});

/* ----------------------------------------------------------------- hero tile */

interface HeroTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: ReactNode;
  tone: TileTone;
  /** Optional bullet meter under the numerals. */
  meter?: ReactNode;
  title?: string;
}

/** The one big numeral a rail is built around. */
export function HeroTile({ label, value, unit, detail, tone, meter, title }: HeroTileProps) {
  return (
    <div className={`sd-hero sd-tone-${tone}`} title={title}>
      <div className="sd-hero__label">{label}</div>
      <div className="sd-hero__value">
        {value}
        {unit ? <span className="sd-hero__unit">{unit}</span> : null}
      </div>
      {detail !== undefined && <div className="sd-hero__detail">{detail}</div>}
      {meter}
    </div>
  );
}

/* -------------------------------------------------------------------- chips */

export function StateChip({ label, tone, title }: { label: string; tone: TileTone; title?: string }) {
  return (
    <span className={`sd-chip sd-tone-bg-${tone}`} title={title}>
      {label}
    </span>
  );
}

export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="sd-section">
      <span className="sd-section__text">{children}</span>
      {aside ? <span className="sd-section__aside">{aside}</span> : null}
    </div>
  );
}

/* ---------------------------------------------------------- fuel error meter */

interface FuelErrorMeterProps {
  /** Relative error: (measured − target)/target. Positive = lean. */
  error: number | null;
  fmt: ValueFormatter;
  /** Units of the *ratio* so the axis can be labelled. */
  unit: string;
  target?: number;
}

/**
 * Centre-zero error meter for measured vs commanded fuelling.
 *
 * The axis is percentage error, so it reads the same whether the user works in
 * AFR or λ. The alert thresholds (4 % lean, 12 % rich) are marked on the track.
 */
export const FuelErrorMeter = memo(function FuelErrorMeter({ error, fmt, unit, target }: FuelErrorMeterProps) {
  const limit = 15; // ±15 % display range
  const usable = error !== null && Number.isFinite(error);
  const pct = usable ? clamp01((error as number * 100) / (2 * limit) + 0.5) * 100 : 50;
  const tone: TileTone = !usable ? 'dim' : Math.abs(error as number) <= 0.04 ? 'ok' : (error as number) > 0 ? 'warn' : 'info';
  const leanMark = 50 + (4 / (2 * limit)) * 100;
  const richMark = 50 - (12 / (2 * limit)) * 100;

  return (
    <div className="sd-errmeter" title={
      target === undefined
        ? 'Measured fuel ratio versus the commanded target'
        : `Measured versus commanded target (${fmt.boundary(unit, 3, target).text} ${unit})`
    }>
      <div className="sd-errmeter__track" role="presentation">
        <span className="sd-errmeter__zero" />
        <span className="sd-errmeter__limit sd-errmeter__limit--lean" style={{ left: `${leanMark}%` }} />
        <span className="sd-errmeter__limit sd-errmeter__limit--rich" style={{ left: `${richMark}%` }} />
        {usable && (
          <span
            className={`sd-errmeter__fill sd-errmeter__fill--${tone}`}
            style={
              (error as number) >= 0
                ? { left: '50%', width: `${Math.max(0, pct - 50)}%` }
                : { left: `${pct}%`, width: `${Math.max(0, 50 - pct)}%` }
            }
          />
        )}
        <span className={`sd-errmeter__marker sd-tone-${tone}`} style={{ left: `${pct}%` }} />
      </div>
      <div className="sd-errmeter__scale">
        <span>RICH −{limit} %</span>
        <span>0</span>
        <span>LEAN +{limit} %</span>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ helpers */

export interface KeyValueRow {
  label: string;
  value: ReactNode;
  tone?: TileTone;
  title?: string;
}

/** Compact label/value list for the secondary rail blocks. */
export const KeyValueGrid = memo(function KeyValueGrid({ rows }: { rows: KeyValueRow[] }) {
  return (
    <dl className="sd-kvlist">
      {rows.map((row) => (
        <div className="sd-kvlist__row" key={row.label} title={row.title}>
          <dt>{row.label}</dt>
          <dd className={row.tone ? `sd-tone-${row.tone}` : undefined}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
});

export function pctStyle(value: number): CSSProperties {
  return { width: `${clamp01(value) * 100}%` };
}

/** Tone for a band descriptor — used by derived tiles. */
export function toneFromBands(channel: TileChannel, value: number | undefined): TileTone {
  if (value === undefined || !Number.isFinite(value)) return 'dim';
  return toneOf(channel, value);
}
