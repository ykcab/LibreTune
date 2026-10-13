/**
 * Startup dashboard — presentational primitives.
 *
 * Everything here is pure and unit-aware: no channel literals, no thresholds,
 * no colours of its own. Tiles receive a `TileChannel` descriptor (from the
 * catalogue, or synthesised by the dash for a derived value) plus the current
 * reading, and render:
 *
 * - every number with its unit,
 * - every threshold as a **labelled** tick (a bare hairline tells nobody anything),
 * - every state as text (colour reinforces, it never carries the meaning).
 *
 * The instrument used throughout is the bullet meter (value + qualitative zones
 * + printed thresholds), which stays readable at 20 px tall and says "how close
 * to the limit" without a needle to hunt for.
 */
import { memo, type CSSProperties, type ReactNode } from 'react';
import { toneFor, type Band } from './channels';
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
  /** False for on/off channels, where a bar between two numbers says nothing. */
  meter?: boolean;
}

export type TileTone = 'ok' | 'warn' | 'crit' | 'info' | 'dim' | 'neutral';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Tone for a value, using the catalogue's own rule (including gap semantics). */
function tileTone(channel: TileChannel, value: number | undefined): TileTone {
  const tone = toneFor({ ...channel, id: channel.label, keys: [], group: 'engine' }, value);
  return tone === 'ok' ? 'neutral' : (tone as TileTone);
}

/* --------------------------------------------------------------------- meter */

interface MeterProps {
  channel: TileChannel;
  value: number | undefined;
  fmt: ValueFormatter;
  /** Show every boundary label (default) or only the tightest warn/crit edge. */
  showTicks?: boolean;
  compact?: boolean;
}

/**
 * Bullet meter: qualitative zones, the value marker, and printed boundaries.
 * Boundaries are printed so a colour-blind user reads the same information a
 * sighted user does, and so a bare hairline never has to be guessed at.
 */
export const Meter = memo(function Meter({ channel, value, fmt, showTicks = true, compact = false }: MeterProps) {
  const span = channel.max - channel.min || 1;
  const pct = (v: number) => clamp01((v - channel.min) / span) * 100;
  const bands = channel.bands ?? [];
  const usable = value !== undefined && Number.isFinite(value);

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
  bands.forEach((band, index) => {
    if (band.tone !== 'warn' && band.tone !== 'crit') return;
    const edges: number[] = [];
    if (Number.isFinite(band.max)) edges.push(band.max);
    const previousMax = bands[Math.max(0, index - 1)]?.max;
    if (previousMax !== undefined && Number.isFinite(previousMax)) edges.push(previousMax);
    for (const edge of edges) {
      if (edge <= channel.min || edge >= channel.max) continue;
      const existing = tickMap.get(edge);
      if (existing && (severityRank[existing.tone] ?? 0) >= (severityRank[band.tone] ?? 0)) continue;
      // A fractional limit (the knock band at 0.5) must not print as "1".
      const digits = Number.isInteger(edge) ? channel.digits : Math.max(channel.digits, 1);
      tickMap.set(edge, {
        tone: band.tone,
        label: fmt.boundary(channel.unit, digits, edge).text,
      });
    }
  });
  const allTicks = Array.from(tickMap.entries())
    .map(([edge, entry]) => ({ at: pct(edge), tone: entry.tone, label: entry.label }))
    .sort((a, b) => a.at - b.at);
  // A compact tile (~100 px) fits one label without collisions: print the
  // tightest limit, which is the one that fires first.
  const ticks = showTicks ? allTicks : allTicks.slice(0, 1);

  const markerPct = usable ? pct(value as number) : 0;
  const tone: TileTone = usable ? tileTone(channel, value as number) : 'dim';

  return (
    <div className={`sd-meter${compact ? ' sd-meter--compact' : ''}${usable ? '' : ' is-empty'}`}>
      <div className="sd-meter__track" role="presentation">
        {uniqueSegments(segments).map((segment, index) => (
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
      {ticks.length > 0 && (
        <div className="sd-meter__scale">
          {ticks.map((tick) => (
            <span
              key={`l-${tick.at}-${tick.label}`}
              className={`sd-meter__scale-label sd-tone-${tick.tone}`}
              /* Clamped so a limit near either end stays inside the tile. */
              style={{ left: `${Math.min(94, Math.max(6, tick.at))}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

/** Collapse adjacent segments with the same tone (a low band next to a low band). */
function uniqueSegments(segments: { left: number; width: number; tone: TileTone }[]) {
  const out: { left: number; width: number; tone: TileTone }[] = [];
  for (const segment of segments) {
    const previous = out[out.length - 1];
    if (previous && previous.tone === segment.tone && Math.abs(previous.left + previous.width - segment.left) < 0.01) {
      previous.width += segment.width;
      continue;
    }
    out.push({ ...segment });
  }
  return out;
}

/* ---------------------------------------------------------------------- tile */

interface StatTileProps {
  channel: TileChannel;
  value: number | undefined;
  fmt: ValueFormatter;
  /** Secondary line: a target, a limit, or a qualifier. */
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

/**
 * A labelled numeric tile with its bullet meter.
 *
 * Order is head → value → meter → detail so meters sit on a shared baseline
 * across a row of tiles: a detail line can never push one meter out of line
 * with its neighbour, which is what makes a row readable across.
 */
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
  const resolvedTone: TileTone = tone ?? (value === undefined ? 'dim' : tileTone(channel, value));
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
      {channel.meter !== false && (
        <Meter channel={channel} value={value} fmt={fmt} compact={compact} showTicks={!compact} />
      )}
      {detail !== undefined && <div className="sd-tile__detail">{detail}</div>}    </div>
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
  /** Display unit of the ratio, for the tooltip. */
  unit: string;
  target?: number;
  /** Alert tolerances, printed on the track (they are the rules' own numbers). */
  leanLimit?: number;
  richLimit?: number;
}

/**
 * Centre-zero error meter for measured vs commanded fuelling.
 *
 * The axis is percentage error, so it reads the same whether the user works in
 * AFR or λ. The alert tolerances are marked *and printed* — they used to be an
 * unexplained ±15 %.
 */
export const FuelErrorMeter = memo(function FuelErrorMeter({
  error,
  fmt,
  unit,
  target,
  leanLimit = 0.04,
  richLimit = 0.12,
}: FuelErrorMeterProps) {
  const limit = 15; // ±15 % display range
  const usable = error !== null && Number.isFinite(error);
  const pct = usable ? clamp01(((error as number) * 100) / (2 * limit) + 0.5) * 100 : 50;
  const tone: TileTone = !usable
    ? 'dim'
    : Math.abs(error as number) <= leanLimit
      ? 'ok'
      : (error as number) > 0
        ? 'warn'
        : 'info';
  const leanMark = 50 + (leanLimit * 100 / (2 * limit)) * 100;
  const richMark = 50 - (richLimit * 100 / (2 * limit)) * 100;

  return (
    <div
      className={`sd-errmeter${usable ? '' : ' is-empty'}`}
      title={
        target === undefined
          ? 'Measured fuel ratio versus the commanded target'
          : `Measured versus commanded target (${fmt.boundary(unit === 'λ' ? 'λ' : 'AFR', 3, target).text} ${unit}). Alerts at ${(leanLimit * 100).toFixed(0)} % lean / ${(richLimit * 100).toFixed(0)} % rich.`
      }
    >
      <div className="sd-errmeter__track" role="presentation">
        <span className="sd-errmeter__zero" />
        <span className="sd-errmeter__limit" style={{ left: `${leanMark}%` }} title="lean alert" />
        <span className="sd-errmeter__limit" style={{ left: `${richMark}%` }} title="rich alert" />
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
        {/* No reading ⇒ no marker: an empty meter must not look "on target". */}
        {usable && <span className={`sd-errmeter__marker sd-tone-${tone}`} style={{ left: `${pct}%` }} />}
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
