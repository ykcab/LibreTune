/**
 * Startup dashboard — analysis panels.
 *
 * The bottom strip answers the three questions the traces cannot:
 *  - WHAT WENT WRONG   → `EventsPanel` (latched, counted, never hover-only)
 *  - IS THE TUNE RIGHT → `FuelingPanel` (measured vs commanded over load cells)
 *  - WHERE HAVE I BEEN → `CoverageMap` (rpm × MAP dwell, this session)
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { CHANNELS, type ChannelSpec } from './channels';
import type { EventKind, Severity } from './types';
import type {
  CoverageStats,
  FuelingStats,
  FuelRatioState,
  SessionEvent,
} from './session';
import type { ValueFormatter } from './useStartupTelemetry';

/* ------------------------------------------------------------------ helpers */

function specFor(id: string | undefined): ChannelSpec | undefined {
  return id ? CHANNELS[id] : undefined;
}

function formatAgo(at: number, now: number): string {
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 60) return `${seconds.toFixed(0)} s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${(seconds - minutes * 60).toFixed(0)} s ago`;
}

/** Human description of an event, in the user's units. */
function describe(event: SessionEvent, fmt: ValueFormatter): { title: string; detail: string } {
  const spec = specFor(event.channelId);
  const unit = spec?.unit ?? '';
  const digits = spec?.digits ?? 1;
  const value = event.value !== undefined ? fmt.format(unit, digits, event.value) : null;
  // A fractional boundary (e.g. the knock band at 0.5) must not print as "1".
  const boundaryDigits =
    event.boundary !== undefined && !Number.isInteger(event.boundary)
      ? Math.max(digits, 1)
      : digits;
  const boundary = event.boundary !== undefined ? fmt.boundary(unit, boundaryDigits, event.boundary) : null;
  const withUnit = (f: { text: string; unit: string } | null) =>
    f ? `${f.text}${f.unit ? ` ${f.unit}` : ''}` : '—';

  switch (event.kind) {
    case 'limit':
      return {
        title: `${spec?.label ?? event.channelId ?? 'LIMIT'} ${withUnit(value)}`,
        detail: boundary ? `threshold ${withUnit(boundary)}${event.note ? ` · ${event.note}` : ''}` : (event.note ?? ''),
      };
    case 'dropout':
      return {
        title: `${spec?.label ?? event.channelId} READING 0`,
        detail: 'channel published by the ECU has collapsed to zero',
      };
    case 'fueling': {
      const percent = event.value !== undefined ? `${(event.value * 100).toFixed(1)} %` : '—';
      const lean = event.value !== undefined && event.value > 0;
      return {
        title: `FUELING ${lean ? 'LEAN' : 'RICH'} ${percent}`,
        detail: lean ? 'measured above commanded under load' : 'measured below commanded under load',
      };
    }
    case 'sync':
      return { title: 'TRIGGER SYNC LOST', detail: 'the ECU reported loss of crank/cam sync' };
    case 'boost':
      return {
        title: `BOOST ${withUnit(value)}`,
        detail: boundary ? `commanded ${withUnit(boundary)}` : 'above commanded boost',
      };
    default:
      return { title: event.note ?? 'EVENT', detail: '' };
  }
}

/* --------------------------------------------------------------- events panel */

export interface EventsPanelProps {
  events: SessionEvent[];
  monitors: number;
  /** Rule counts per kind — shown when nothing has been detected yet. */
  breakdown: Record<EventKind, number>;
  fmt: ValueFormatter;
  now: number;
}

/** Repeated occurrences of one rule collapse into a single countable row. */
interface EventGroup {
  rule: string;
  severity: Severity;
  latest: SessionEvent;
  count: number;
  active: boolean;
}

export const EventsPanel = memo(function EventsPanel({ events, monitors, breakdown, fmt, now }: EventsPanelProps) {
  const groups = useMemo(() => {
    const byRule = new Map<string, EventGroup>();
    // Newest first (the session keeps `events` in that order).
    for (const event of events) {
      const existing = byRule.get(event.rule);
      if (!existing) {
        byRule.set(event.rule, {
          rule: event.rule,
          severity: event.severity,
          latest: event,
          count: 1,
          active: event.active,
        });
        continue;
      }
      existing.count++;
      existing.active = existing.active || event.active;
    }
    const list = Array.from(byRule.values());
    // Live problems first, then most recent.
    list.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.latest.at - a.latest.at;
    });
    return list;
  }, [events]);

  const visible = groups.slice(0, 7);
  const hidden = Math.max(0, groups.length - visible.length);
  const activeCount = groups.filter((group) => group.active).length;

  return (
    <section className="sd-panel" aria-label="Detected events">
      <header className="sd-panel__head">
        <h3 className="sd-panel__title">EVENTS</h3>
        <span className="sd-panel__meta">
          {activeCount > 0 ? `${activeCount} ACTIVE` : `${monitors} RULES MONITORED`}
        </span>
      </header>
      {visible.length === 0 ? (
        <div className="sd-panel__empty">
          <p>Nothing detected this session.</p>
          <ul className="sd-rules">
            <li>
              <b>{breakdown.limit}</b> limit{breakdown.limit === 1 ? '' : 's'}
            </li>
            <li>
              <b>{breakdown.dropout}</b> sensor dropout channels
            </li>
            <li>
              <b>{breakdown.fueling}</b> fuelling error rules
            </li>
            <li>
              <b>{breakdown.sync}</b> trigger sync
            </li>
            <li>
              <b>{breakdown.boost}</b> overboost
            </li>
          </ul>
          <p className="sd-panel__foot">
            Limits only arm while the engine is running, so a stopped engine can never raise a
            false oil-pressure or battery event.
          </p>
        </div>
      ) : (
        <ul className="sd-events">
          {visible.map((group) => {
            const text = describe(group.latest, fmt);
            return (
              <li
                key={group.rule}
                className={`sd-events__row sd-events__row--${group.severity}${group.active ? ' is-active' : ''}`}
                title={new Date(group.latest.at).toLocaleTimeString()}
              >
                <span className={`sd-events__bar sd-tone-bg-${group.severity}`} aria-hidden="true" />
                <span className="sd-events__body">
                  <span className="sd-events__title">
                    {text.title}
                    {group.count > 1 && <span className="sd-events__count">×{group.count}</span>}
                  </span>
                  <span className="sd-events__detail">{text.detail}</span>
                </span>
                <span className="sd-events__age">
                  {group.active
                    ? `live ${Math.max(0, (now - group.latest.at) / 1000).toFixed(0)} s`
                    : formatAgo(group.latest.lastAt, now)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 && <p className="sd-panel__foot">+{hidden} other rule{hidden > 1 ? 's' : ''} seen this session</p>}
    </section>
  );
});

/* -------------------------------------------------------------- fueling panel */

export interface FuelingPanelProps {
  fuel: FuelRatioState;
  stats: FuelingStats;
  hasTarget: boolean;
  /** True when the dashboard has a live stream (drives the empty-state wording). */
  live: boolean;
  fmt: ValueFormatter;
  /** Display unit for the ratio (from the user's preference). */
  unit: string;
  digits: number;
  /** Convert a λ-space value into the display unit. */
  toDisplay: (lambda: number) => number;
  /** Snapshot time, so the age labels render deterministically. */
  now: number;
}

export const FuelingPanel = memo(function FuelingPanel({
  fuel,
  stats,
  hasTarget,
  live,
  fmt,
  unit,
  digits,
  toDisplay,
  now,
}: FuelingPanelProps) {
  const errorPct = fuel.error !== null ? fuel.error * 100 : null;
  const meanPct = stats.meanError !== null ? stats.meanError * 100 : null;

  // The headline is the *session* verdict over load cells; the hero on the right
  // rail carries the instantaneous error. Keeping them separate is the only way
  // both numbers can be true at once.
  const headline = meanPct === null
    ? errorPct === null
      ? { text: 'NO COMPARISON AVAILABLE', tone: 'dim' as const }
      : {
          text: Math.abs(errorPct) <= 4 ? 'ON TARGET' : errorPct > 0 ? `LEAN ${errorPct.toFixed(1)} %` : `RICH ${Math.abs(errorPct).toFixed(1)} %`,
          tone: Math.abs(errorPct) <= 4 ? ('ok' as const) : errorPct > 0 ? ('warn' as const) : ('info' as const),
        }
    : {
        text:
          Math.abs(meanPct) <= 4
            ? `ON TARGET · MEAN ${meanPct >= 0 ? '+' : ''}${meanPct.toFixed(1)} %`
            : meanPct > 0
              ? `LEAN ${meanPct.toFixed(1)} % MEAN`
              : `RICH ${Math.abs(meanPct).toFixed(1)} % MEAN`,
        tone: Math.abs(meanPct) <= 4 ? ('ok' as const) : meanPct > 0 ? ('warn' as const) : ('info' as const),
      };
  const spreadPct = stats.meanAbsError !== null ? Math.abs(stats.meanAbsError * 100) : null;

  return (
    <section className="sd-panel" aria-label="Fuelling accuracy">
      <header className="sd-panel__head">
        <h3 className="sd-panel__title">FUELING vs TARGET</h3>
        <span className="sd-panel__meta">
          {stats.samples > 0 ? `${stats.samples} LOAD SAMPLES` : 'NO LOAD SAMPLES'}
        </span>
      </header>

      <div className={`sd-verdict sd-tone-${headline.tone}`}>
        {headline.text}
        {meanPct !== null && <span className="sd-verdict__sub">session, load cells</span>}
      </div>

      {!live ? (
        <p className="sd-panel__empty">
          Waiting for a live stream — fuelling accuracy is measured against the ECU's own commanded
          ratio once data arrives.
        </p>
      ) : !hasTarget ? (
        <p className="sd-panel__empty">
          This INI publishes no commanded fuel ratio channel, so measured values cannot be compared
          against a target.
        </p>
      ) : (
        <>
          <div className="sd-kv">
            <span className="sd-kv__key">Now</span>
            <span className="sd-kv__value">
              {fuel.measured === undefined
                ? '—'
                : `${fmt.format(unit === 'λ' ? 'λ' : 'AFR', digits, toDisplay(fuel.measured)).text} vs ${
                    fuel.target === undefined ? '—' : fmt.format(unit === 'λ' ? 'λ' : 'AFR', digits, toDisplay(fuel.target)).text
                  } ${unit}`}
              {fuel.error !== null && (
                <span className={`sd-kv__note sd-tone-${Math.abs(fuel.error) <= 0.04 ? 'ok' : fuel.error > 0 ? 'warn' : 'info'}`}>
                  {fuel.error > 0 ? '+' : ''}
                  {(fuel.error * 100).toFixed(1)} %
                </span>
              )}
            </span>
          </div>
          <div className="sd-kv">
            <span className="sd-kv__key">Spread</span>
            <span className="sd-kv__value">
              {spreadPct === null ? '—' : `±${spreadPct.toFixed(1)} %`}
              <span className="sd-kv__note">mean absolute</span>
            </span>
          </div>
          <div className="sd-kv">
            <span className="sd-kv__key">Worst lean</span>
            <span className="sd-kv__value">
              {stats.worstLean === null ? '—' : `${(stats.worstLean.error * 100).toFixed(1)} %`}
              {stats.worstLean && <span className="sd-kv__note">{formatAgo(stats.worstLean.at, now)}</span>}
            </span>
          </div>
          <div className="sd-kv">
            <span className="sd-kv__key">Worst rich</span>
            <span className="sd-kv__value">
              {stats.worstRich === null ? '—' : `${(stats.worstRich.error * 100).toFixed(1)} %`}
              {stats.worstRich && <span className="sd-kv__note">{formatAgo(stats.worstRich.at, now)}</span>}
            </span>
          </div>
          <p className="sd-panel__foot">
            Collected above 100 kPa and 1500 rpm only — the cells where fuelling errors cost engines.
          </p>
        </>
      )}
    </section>
  );
});

/* --------------------------------------------------------------- coverage map */

export interface CoverageMapProps {
  coverage: CoverageStats;
  values: Record<string, number>;
  fmt: ValueFormatter;
}

/**
 * Operating-envelope dwell map: rpm (x) × manifold pressure (y), one cell per
 * 500 rpm × 20 kPa. Shows where the engine has actually been this session — the
 * coverage question a tuner asks before trusting a log.
 */
export const CoverageMap = memo(function CoverageMap({ coverage, values, fmt }: CoverageMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(80, Math.floor(rect.width));
    const h = Math.max(60, Math.floor(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const css = getComputedStyle(canvas);
    const text = css.getPropertyValue('--sd-text').trim() || '#ddd';
    const dim = css.getPropertyValue('--sd-dim').trim() || '#888';
    const accent = css.getPropertyValue('--sd-accent').trim() || '#4f9cf9';

    const padL = 30;
    const padB = 14;
    const padT = 4;
    const padR = 4;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const cellW = plotW / coverage.rpmBins;
    const cellH = plotH / coverage.mapBins;

    // Cells: colour intensity = dwell share of the busiest cell.
    for (let mb = 0; mb < coverage.mapBins; mb++) {
      for (let rb = 0; rb < coverage.rpmBins; rb++) {
        const count = coverage.counts[mb * coverage.rpmBins + rb];
        const x = padL + rb * cellW;
        // MAP increases upward: row 0 = lowest pressure at the bottom.
        const y = padT + plotH - (mb + 1) * cellH;
        if (count > 0) {
          const share = coverage.peak > 0 ? count / coverage.peak : 0;
          ctx.fillStyle = withAlpha(accent, 0.16 + 0.72 * Math.pow(share, 0.45));
          ctx.fillRect(x, y, cellW, cellH);
        }
      }
    }

    // Grid.
    ctx.strokeStyle = withAlpha(text, 0.13);
    ctx.lineWidth = 1;
    for (let rb = 0; rb <= coverage.rpmBins; rb += 4) {
      const x = Math.round(padL + rb * cellW) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
    }
    for (let mb = 0; mb <= coverage.mapBins; mb += 5) {
      const y = Math.round(padT + plotH - mb * cellH) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
    }

    // Current operating cell: outlined so the live point is unmistakable.
    if (coverage.current >= 0) {
      const rb = coverage.current % coverage.rpmBins;
      const mb = Math.floor(coverage.current / coverage.rpmBins);
      ctx.strokeStyle = text;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(padL + rb * cellW + 0.75, padT + plotH - (mb + 1) * cellH + 0.75, cellW - 1.5, cellH - 1.5);
    }

    // Axis labels.
    ctx.fillStyle = dim;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let rb = 0; rb <= coverage.rpmBins; rb += 4) {
      const rpm = rb * coverage.rpmStep;
      ctx.fillText(`${(rpm / 1000).toFixed(0)}k`, padL + rb * cellW, padT + plotH + 3);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let mb = 0; mb <= coverage.mapBins; mb += 5) {
      const map = mb * coverage.mapStep;
      const label = fmt.boundary('kPa', 0, map);
      ctx.fillText(label.text, padL - 4, padT + plotH - mb * cellH);
    }
    ctx.save();
    ctx.translate(8, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = dim;
    ctx.fillText(fmt.boundary('kPa', 0, coverage.mapStep).unit.toUpperCase(), 0, 0);
    ctx.restore();
  }, [coverage, fmt]);

  const rpm = values.rpm;
  const map = values.map;
  const coverageShare = coverage.total > 0 ? (coverage.visited / coverage.total) * 100 : 0;

  return (
    <section className="sd-panel" aria-label="Operating envelope coverage">
      <header className="sd-panel__head">
        <h3 className="sd-panel__title">OPERATING ENVELOPE</h3>
        <span className="sd-panel__meta">
          {coverage.visited}/{coverage.total} CELLS · {coverageShare.toFixed(0)}%
        </span>
      </header>
      <div className="sd-coverage" ref={wrapRef}>
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      <p className="sd-panel__foot">
        {rpm === undefined || map === undefined
          ? 'Waiting for rpm and manifold-pressure channels.'
          : `Now: ${fmt.format('', 0, rpm).text} rpm · ${fmt.format('kPa', 0, map).text} ${fmt.boundary('kPa', 0, map).unit} · dwell map of this session.`}
      </p>
    </section>
  );
});

function withAlpha(color: string, alpha: number): string {
  const value = color.trim();
  const hex = value.startsWith('#') ? value.slice(1) : null;
  if (hex) {
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const num = Number.parseInt(full, 16);
    if (!Number.isNaN(num)) {
      return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    }
  }
  const rgb = value.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const parts = rgb[1].split(',').map((p) => Number.parseFloat(p));
    return `rgba(${parts[0]}, ${parts[1] ?? parts[0]}, ${parts[2] ?? parts[0]}, ${alpha})`;
  }
  return value;
}
