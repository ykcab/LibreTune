/**
 * EngineScope — the live multi-channel scope at the centre of the Startup face.
 *
 * One canvas, one row per channel, newest sample pinned to the right edge. It is
 * an instrument, not a chart: every lane prints the range it is drawing, the
 * current (or cursor) value with its unit, and the threshold zones that matter.
 *
 * Responsiveness
 * --------------
 * Data is read imperatively from the realtime store's history buffers on a
 * throttled `requestAnimationFrame` loop. Pointer/keyboard interaction mutates
 * refs and raises a dirty flag — the component performs **no React re-render**
 * while the stream runs or while the cursor moves.
 *
 * Truthfulness
 * ------------
 * - A lane whose channel is in a "gap" state (raw 0 on a channel where 0 is
 *   physically impossible) breaks the trace and gets a gap tick — a dead sensor
 *   can never look like a real reading.
 * - Auto-ranged lanes print the range they are using.
 * - Ranges, values and zones are all converted into the user's display units
 *   with the same linear transform the DOM tiles use.
 * - Pause freezes the exact window that was on screen and says how far behind it
 *   now is; the stream keeps running underneath.
 * - Anomalies detected by the session are drawn as their own layer (markers),
 *   not folded into the traces.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { getChannelHistoryBuffer, useRealtimeStore } from '../../../stores/realtimeStore';
import { formatNumber } from './channels';
import type { SessionMarker, SessionSnapshot } from './session';
import {
  laneLatestRaw,
  laneRawAt,
  laneWindowSamples,
  targetWindowSamples,
  type ScopeLane,
} from './lanes';
import './EngineScope.css';

export interface EngineScopeProps {
  lanes: ScopeLane[];
  markers: SessionMarker[];
  /** Realtime snapshot — used for the accessible value table only. */
  snapshot: SessionSnapshot;
  /** Mean sample interval in ms (sample counts → wall-clock time). */
  intervalMs: number;
  /** Visible window in seconds. */
  windowSec: number;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  /** Stream is fresh (data within the last second). */
  live: boolean;
  isConnected: boolean;
}

/** History depth of the realtime store's circular buffers (keep in sync). */
const BUFFER_SAMPLES = 300;
/** Redraw cadence while live and idle (data at 10 Hz does not need 60 fps). */
const DRAW_INTERVAL_MS = 70;
const BASE_ROW_HEIGHT = 42;
const MONO = '"IBM Plex Mono", Consolas, monospace';
const SANS = '"IBM Plex Sans", system-ui, sans-serif';

interface FrozenWindow {
  at: number;
  /** Frozen samples keyed by lane id, so changing the lane set cannot mis-align. */
  lanes: Map<string, number[]>;
  targets: Map<string, number[]>;
}

interface RangeCacheEntry {
  min: number;
  max: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ helpers */

/** Row heights: declared heights, scaled to exactly fill the canvas. */
function rowHeights(lanes: ScopeLane[], total: number): number[] {
  const base = lanes.map((lane) => lane.height ?? BASE_ROW_HEIGHT);
  const sum = base.reduce((a, b) => a + b, 0) || 1;
  const scale = total / sum;
  return base.map((value) => value * scale);
}

/** Resolve a themed colour from a CSS custom property (cached per paint). */
function colorOf(el: HTMLElement, name: string, cache: Map<string, string>): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const value = raw.length > 0 ? raw : '#8a8a8a';
  cache.set(name, value);
  return value;
}

/** Gap test on the RAW sample (display conversion happens after). */
function isGapSample(lane: ScopeLane, raw: number): boolean {
  return !Number.isFinite(raw) || (lane.zeroIsGap && raw === 0);
}

/**
 * Range for a lane, in display space. Auto-ranged lanes track the data: they
 * grow immediately and shrink reluctantly, so a blip never rescales the scope
 * and a settled channel isn't stuck on a stale range.
 */
function laneRange(
  lane: ScopeLane,
  samples: number[],
  cache: Map<string, RangeCacheEntry>,
  now: number,
): { min: number; max: number } {
  if (!lane.autoRange) return { min: lane.min, max: lane.max };

  let rawMin = Number.POSITIVE_INFINITY;
  let rawMax = Number.NEGATIVE_INFINITY;
  for (const raw of samples) {
    if (isGapSample(lane, raw)) continue;
    const value = raw * lane.scale + lane.offset;
    if (value < rawMin) rawMin = value;
    if (value > rawMax) rawMax = value;
  }
  const entry = cache.get(lane.id);
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
    return entry ?? { min: lane.min, max: lane.max };
  }
  const span = rawMax - rawMin || Math.abs(rawMax) || 1;
  const pad = span * 0.12;
  const next = { min: rawMin - pad, max: rawMax + pad, updatedAt: now };
  if (!entry) {
    cache.set(lane.id, next);
    return next;
  }
  const outside = next.min < entry.min || next.max > entry.max;
  const muchSmaller = next.max - next.min < (entry.max - entry.min) * 0.5;
  if (outside || (muchSmaller && now - entry.updatedAt > 500)) {
    const merged: RangeCacheEntry = outside
      ? { min: Math.min(entry.min, next.min), max: Math.max(entry.max, next.max), updatedAt: now }
      : next;
    cache.set(lane.id, merged);
    return merged;
  }
  return entry;
}

/** Truncate text with an ellipsis so a long label can never bleed into the trace. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

/* ------------------------------------------------------------------ painting */

interface PaintArgs {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  lanes: ScopeLane[];
  data: number[][];
  targets: number[][];
  /** Live channel values (store), used for the "now" column. */
  liveValues: Record<string, number>;
  windowSamples: number;
  intervalMs: number;
  cursor: number | null;
  markers: SessionMarker[];
  now: number;
  frozenAt: number | null;
  ranges: Map<string, RangeCacheEntry>;
  connected: boolean;
}

const EMPTY: number[] = [];

function paint(args: PaintArgs): void {
  const {
    canvas, ctx, w, h, lanes, data, targets, liveValues, windowSamples, intervalMs,
    cursor, markers, now, frozenAt, ranges, connected,
  } = args;

  const colors = new Map<string, string>();
  const text = colorOf(canvas, '--sd-text', colors);
  const dim = colorOf(canvas, '--sd-dim', colors);
  const grid = hexToRgba(text, 0.07);
  const warnColor = colorOf(canvas, '--sd-warn', colors);
  const critColor = colorOf(canvas, '--sd-crit', colors);
  const richColor = colorOf(canvas, '--sd-info', colors);

  ctx.clearRect(0, 0, w, h);

  if (lanes.length === 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = dim;
    ctx.font = `12px ${SANS}`;
    ctx.fillText('No channels selected — add one from the channel picker', w / 2, h / 2);
    return;
  }

  const gutterL = w < 420 ? 54 : 70;
  const gutterR = w < 420 ? 62 : 88;
  const traceLeft = gutterL;
  const traceRight = Math.max(traceLeft + 2, w - gutterR);
  const traceW = traceRight - traceLeft;

  const heights = rowHeights(lanes, h);
  const tops: number[] = [];
  let acc = 0;
  for (const value of heights) {
    tops.push(acc);
    acc += value;
  }

  // Vertical time gridlines every 5 s, drawn behind every lane, with the offset
  // printed so a trace can be tied to the event list's ages.
  const gridStep = traceW / Math.max(1, windowSamples - 1);
  const windowMs = (windowSamples - 1) * intervalMs;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  for (let ms = 5000; ms <= windowMs; ms += 5000) {
    const x = Math.round(traceRight - (ms / intervalMs) * gridStep) + 0.5;
    if (x <= traceLeft) break;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.fillText(`-${(ms / 1000).toFixed(0)}s`, x - 3, h - 2);
  }

  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const top = tops[i];
    const rowH = heights[i];
    const bottom = top + rowH;
    const padY = Math.min(6, rowH * 0.16);
    const plotTop = top + padY;
    const plotBottom = bottom - padY;
    const plotH = Math.max(2, plotBottom - plotTop);
    const laneColor = colorOf(canvas, lane.color, colors);
    const centerY = plotTop + plotH / 2;
    const compact = rowH < 34;

    // Raw → display.
    const conv = (raw: number) => raw * lane.scale + lane.offset;
    const samples = data[i] ?? [];

    // Separator between rows.
    if (i > 0) {
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(top) + 0.5);
      ctx.lineTo(w, Math.round(top) + 0.5);
      ctx.stroke();
    }

    const range = laneRange(lane, samples, ranges, now);
    const span = range.max - range.min || 1;
    const toY = (raw: number) => {
      const value = conv(raw);
      const clamped = value <= range.min ? range.min : value >= range.max ? range.max : value;
      return plotBottom - ((clamped - range.min) / span) * plotH;
    };
    const xAt = (fromRight: number) => traceRight - fromRight * gridStep;

    // Threshold zones (the limits the catalogue documents, if any).
    if (lane.bands) {
      let bandLower = Number.NEGATIVE_INFINITY;
      for (const band of lane.bands) {
        const bandUpper = band.max;
        if (band.tone === 'warn' || band.tone === 'crit') {
          const hi = Math.min(bandUpper, range.max);
          const lo = Math.max(bandLower, range.min);
          if (hi > lo) {
            const yHi = plotBottom - ((hi - range.min) / span) * plotH;
            const yLo = plotBottom - ((lo - range.min) / span) * plotH;
            ctx.fillStyle = hexToRgba(band.tone === 'crit' ? critColor : warnColor, band.tone === 'crit' ? 0.1 : 0.08);
            ctx.fillRect(traceLeft, Math.min(yHi, yLo), traceW, Math.abs(yLo - yHi));
          }
        }
        bandLower = bandUpper;
      }
    }

    // Mid-line for readability.
    ctx.strokeStyle = hexToRgba(text, 0.05);
    ctx.beginPath();
    ctx.moveTo(traceLeft, Math.round(centerY) + 0.5);
    ctx.lineTo(traceRight, Math.round(centerY) + 0.5);
    ctx.stroke();

    // ---- left gutter: label + the range actually being drawn
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = laneColor;
    ctx.font = `600 ${compact ? 9 : 10}px ${SANS}`;
    const labelWidth = gutterL - 12;
    ctx.fillText(fitText(ctx, lane.label, labelWidth), 8, top + (compact ? 14 : 16));
    // Below ~30 px per row there is no room for a second line, so the range is
    // dropped rather than overlapped (the current value stays in the right
    // gutter, and the range is still printed by every taller row).
    if (rowH >= 30) {
      const rangeDigits = lane.digits > 1 ? 1 : lane.digits;
      ctx.fillStyle = dim;
      ctx.font = `9px ${MONO}`;
      ctx.fillText(
        fitText(
          ctx,
          `${formatNumber(range.min, rangeDigits)}–${formatNumber(range.max, rangeDigits)}${lane.autoRange ? ' auto' : ''}`,
          labelWidth,
        ),
        8,
        Math.min(bottom - 3, top + (compact ? 25 : 31)),
      );
    }

    // ---- traces
    const n = samples.length;
    const targetSeries = targets[i] ?? [];
    const targetConv = lane.target
      ? (raw: number) => raw * lane.target!.scale + lane.target!.offset
      : undefined;

    // Measured vs commanded fill: the insight layer, coloured by direction.
    if (targetConv && targetSeries.length > 1 && n > 1) {
      const count = Math.min(n, targetSeries.length);
      for (let j = 1; j < count; j++) {
        const measured = samples[j];
        const target = targetSeries[j];
        const prevMeasured = samples[j - 1];
        const prevTarget = targetSeries[j - 1];
        if (isGapSample(lane, measured) || !Number.isFinite(target)) continue;
        if (isGapSample(lane, prevMeasured) || !Number.isFinite(prevTarget)) continue;
        const x0 = xAt(n - 1 - j);
        const x1 = xAt(n - 1 - (j - 1));
        const lean = conv(measured) > targetConv(target);
        ctx.fillStyle = hexToRgba(lean ? warnColor : richColor, 0.16);
        ctx.beginPath();
        ctx.moveTo(x0, toY(measured));
        ctx.lineTo(x1, toY(prevMeasured));
        ctx.lineTo(x1, plotBottom - ((clampToRange(targetConv(prevTarget), range) - range.min) / span) * plotH);
        ctx.lineTo(x0, plotBottom - ((clampToRange(targetConv(target), range) - range.min) / span) * plotH);
        ctx.closePath();
        ctx.fill();
      }
    }

    if (n > 1) {
      // Commanded trace: dashed and slightly muted.
      if (targetConv && targetSeries.length > 1) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = hexToRgba(laneColor, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (let j = 0; j < targetSeries.length; j++) {
          const raw = targetSeries[j];
          if (!Number.isFinite(raw) || raw === 0) {
            started = false;
            continue;
          }
          const x = xAt(targetSeries.length - 1 - j);
          const value = clampToRange(targetConv(raw), range);
          const y = plotBottom - ((value - range.min) / span) * plotH;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      // Measured trace, broken at gaps.
      ctx.strokeStyle = laneColor;
      ctx.lineWidth = lane.height !== undefined ? 2 : 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      let started = false;
      for (let j = 0; j < n; j++) {
        const raw = samples[j];
        if (isGapSample(lane, raw)) {
          started = false;
          continue;
        }
        const x = xAt(n - 1 - j);
        const y = toY(raw);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Gap ticks on the baseline: a dead sensor is visible, not silent.
      ctx.fillStyle = hexToRgba(critColor, 0.6);
      for (let j = 0; j < n; j++) {
        if (!isGapSample(lane, samples[j])) continue;
        ctx.fillRect(xAt(n - 1 - j) - 0.5, plotBottom - 3, 1.5, 3);
      }
    }

    // ---- right gutter: live value from the store (never the throttled canvas's
    // last buffer sample), or the cursor value when inspecting
    const cursorIndex = cursor !== null ? n - 1 - cursor : -1;
    const liveRaw = laneLatestRaw(lane, (channel) => liveValues[channel]);
    const shownRaw = cursorIndex >= 0 && cursorIndex < n
      ? samples[cursorIndex]
      : liveRaw !== undefined
        ? liveRaw
        : samples[n - 1];
    const missing = shownRaw === undefined || isGapSample(lane, shownRaw);
    ctx.textAlign = 'right';
    ctx.fillStyle = missing ? dim : laneColor;
    ctx.font = `600 ${compact ? 11 : 13}px ${MONO}`;
    ctx.fillText(missing ? '—' : formatNumber(conv(shownRaw), lane.digits), w - 8, top + (compact ? 14 : 17));
    ctx.fillStyle = dim;
    ctx.font = `9px ${SANS}`;
    ctx.fillText(lane.unit || '—', w - 8, Math.min(bottom - 3, top + (compact ? 24 : 30)));
  }

  // ---- anomaly markers: their own layer, spanning every lane.
  // `markers` is newest-first, so the first entries are the ones nearest the
  // live edge (the older ones fall off the trace anyway).
  const visibleMarkers = markers.slice(0, 24);
  for (const marker of visibleMarkers) {
    const msAgo = now - marker.at;
    if (msAgo < 0 || msAgo > windowMs) continue;
    const x = Math.round(traceRight - (msAgo / intervalMs) * gridStep) + 0.5;
    if (x < traceLeft - 1 || x > traceRight + 1) continue;
    const color = marker.severity === 'crit' ? critColor : marker.severity === 'warn' ? warnColor : richColor;
    ctx.strokeStyle = hexToRgba(color, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 3.5, 0);
    ctx.lineTo(x + 3.5, 0);
    ctx.lineTo(x, 5);
    ctx.closePath();
    ctx.fill();
  }

  // ---- cursor
  if (cursor !== null && windowSamples > 1) {
    const x = Math.round(traceRight - cursor * gridStep) + 0.5;
    if (x >= traceLeft && x <= traceRight + 1) {
      ctx.strokeStyle = hexToRgba(text, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i];
        const samples = data[i] ?? [];
        const index = samples.length - 1 - cursor;
        if (index < 0 || index >= samples.length) continue;
        const raw = samples[index];
        if (isGapSample(lane, raw)) continue;
        const height = heights[i];
        const padY = Math.min(6, height * 0.16);
        const plotTop = tops[i] + padY;
        const plotBottom = tops[i] + height - padY;
        const range = laneRange(lane, samples, ranges, now);
        const span = range.max - range.min || 1;
        const value = raw * lane.scale + lane.offset;
        const clamped = value <= range.min ? range.min : value >= range.max ? range.max : value;
        const y = plotBottom - ((clamped - range.min) / span) * (plotBottom - plotTop);
        ctx.fillStyle = colorOf(canvas, lane.color, colors);
        ctx.beginPath();
        ctx.arc(x, y, 2.25, 0, Math.PI * 2);
        ctx.fill();
      }

      // Measurement box: the cursor time plus every lane's value at that point.
      const secondsAgo = ((cursor * intervalMs) / 1000).toFixed(1);
      const lines: { text: string; color: string }[] = [{ text: `-${secondsAgo} s`, color: text }];
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i];
        const samples = data[i] ?? [];
        const index = samples.length - 1 - cursor;
        const raw = index >= 0 && index < samples.length ? samples[index] : undefined;
        const missing = raw === undefined || isGapSample(lane, raw);
        lines.push({
          text: `${lane.label} ${missing ? '—' : formatNumber(raw * lane.scale + lane.offset, lane.digits)}${lane.unit ? ` ${lane.unit}` : ''}`,
          color: colorOf(canvas, lane.color, colors),
        });
      }
      ctx.font = `10px ${MONO}`;
      let boxW = 0;
      for (const line of lines) boxW = Math.max(boxW, ctx.measureText(line.text).width);
      boxW += 16;
      const boxH = lines.length * 13 + 8;
      const boxX = x + 12 + boxW > w - 4 ? Math.max(4, x - 12 - boxW) : x + 12;
      const boxY = 4;
      ctx.fillStyle = colorOf(canvas, '--sd-panel-solid', colors);
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = hexToRgba(text, 0.22);
      ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillStyle = lines[i].color;
        ctx.fillText(lines[i].text, boxX + 8, boxY + 10 + i * 13);
      }
    }
  }

  // ---- state banner
  const banner = !connected
    ? 'NOT CONNECTED'
    : frozenAt !== null
      ? `PAUSED · ${((now - frozenAt) / 1000).toFixed(1)} s BEHIND LIVE`
      : null;
  if (banner) {
    ctx.font = `600 10px ${SANS}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = frozenAt !== null ? warnColor : dim;
    ctx.fillText(banner, traceRight, 4);
  }
}

function clampToRange(value: number, range: { min: number; max: number }): number {
  return value <= range.min ? range.min : value >= range.max ? range.max : value;
}

function hexToRgba(color: string, alpha: number): string {
  const value = color.trim();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const num = Number.parseInt(full.slice(0, 6), 16);
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

/* ----------------------------------------------------------------- component */

export default function EngineScope({
  lanes,
  markers,
  snapshot,
  intervalMs,
  windowSec,
  paused,
  onPausedChange,
  live,
  isConnected,
}: EngineScopeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tableId = useId();
  const cursorRef = useRef<number | null>(null);
  const dirtyRef = useRef(true);
  const frozenRef = useRef<FrozenWindow | null>(null);
  const rangesRef = useRef(new Map<string, RangeCacheEntry>());
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const pausedRef = useRef(paused);
  const liveRef = useRef(live);
  liveRef.current = live;
  const intervalMsRef = useRef(intervalMs);
  intervalMsRef.current = intervalMs;

  const windowSamples = useMemo(() => {
    const requested = Math.round((windowSec * 1000) / Math.max(20, intervalMs));
    return Math.max(20, Math.min(BUFFER_SAMPLES, requested));
  }, [windowSec, intervalMs]);
  const windowSamplesRef = useRef(windowSamples);
  windowSamplesRef.current = windowSamples;
  const connectedRef = useRef(isConnected);
  connectedRef.current = isConnected;

  // Freeze the exact window that is on screen when pause is engaged. Keyed by
  // lane id: adding or removing a lane while paused must not shift the traces.
  useEffect(() => {
    if (paused && !pausedRef.current) {
      const laneData = new Map<string, number[]>();
      const targetData = new Map<string, number[]>();
      for (const lane of lanes) {
        laneData.set(lane.id, laneWindowSamples(lane, windowSamples, getChannelHistoryBuffer));
        targetData.set(lane.id, targetWindowSamples(lane, windowSamples, getChannelHistoryBuffer));
      }
      frozenRef.current = { at: Date.now(), lanes: laneData, targets: targetData };
      dirtyRef.current = true;
    } else if (!paused && pausedRef.current) {
      frozenRef.current = null;
      dirtyRef.current = true;
    }
    pausedRef.current = paused;
  }, [paused, lanes, windowSamples]);

  useEffect(() => {
    dirtyRef.current = true;
  }, [lanes, markers, windowSamples, intervalMs, paused, isConnected]);

  // Publishes the lane values as text for assistive tech, and announces the
  // cursor position to keyboard users (pointer users get the on-canvas box).
  const [announcement, setAnnouncement] = useState('');

  // The canvas, its observer and the frame loop are created once, on mount.
  // Anything that changes with the data (the sample count derived from the
  // measured stream interval, the connection state) is read through refs, so a
  // wobble in the interval cannot tear the canvas down. Assigning canvas.width
  // clears the bitmap even at the same size, so resize() only does it on change.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let lastDraw = 0;
    let w = 1;
    let h = 1;
    let bitmapW = 0;
    let bitmapH = 0;

    const resize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const rect = wrap.getBoundingClientRect();
      const nextW = Math.max(1, Math.floor(rect.width));
      const nextH = Math.max(1, Math.floor(rect.height));
      const nextBitmapW = Math.round(nextW * dpr);
      const nextBitmapH = Math.round(nextH * dpr);
      if (nextBitmapW === bitmapW && nextBitmapH === bitmapH && nextW === w && nextH === h) return;
      w = nextW;
      h = nextH;
      bitmapW = nextBitmapW;
      bitmapH = nextBitmapH;
      canvas.width = bitmapW;
      canvas.height = bitmapH;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirtyRef.current = true;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const frozen = frozenRef.current;
      const due = !frozen && liveRef.current && now - lastDraw >= DRAW_INTERVAL_MS;
      if (!dirtyRef.current && !due) return;
      dirtyRef.current = false;
      lastDraw = now;

      const currentLanes = lanesRef.current;
      const samples = windowSamplesRef.current;
      const data = currentLanes.map((lane) =>
        frozen ? (frozen.lanes.get(lane.id) ?? EMPTY) : laneWindowSamples(lane, samples, getChannelHistoryBuffer),
      );
      const targets = currentLanes.map((lane) =>
        frozen ? (frozen.targets.get(lane.id) ?? EMPTY) : targetWindowSamples(lane, samples, getChannelHistoryBuffer),
      );
      // Live values straight from the store so the right-hand gutter and the DOM
      // tiles can never disagree about "now".
      const live = useRealtimeStore.getState().channels;

      paint({
        canvas,
        ctx,
        w,
        h,
        lanes: currentLanes,
        data,
        targets,
        liveValues: live,
        windowSamples: samples,
        intervalMs: intervalMsRef.current,
        cursor: cursorRef.current,
        markers: markersRef.current,
        now: Date.now(),
        frozenAt: frozen ? frozen.at : null,
        ranges: rangesRef.current,
        connected: connectedRef.current,
      });
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const samplesFromPointer = useCallback(
    (clientX: number): number | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const gutterL = w < 420 ? 54 : 70;
      const gutterR = w < 420 ? 62 : 88;
      const traceLeft = gutterL;
      const traceRight = Math.max(traceLeft + 2, w - gutterR);
      if (clientX < traceLeft - 2 || clientX > traceRight + 2) return null;
      const step = (traceRight - traceLeft) / Math.max(1, windowSamples - 1);
      const fromRight = Math.round((traceRight - clientX) / step);
      return Math.max(0, Math.min(windowSamples - 1, fromRight));
    },
    [windowSamples],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const next = samplesFromPointer(event.clientX);
      if (next === cursorRef.current) return;
      cursorRef.current = next;
      dirtyRef.current = true;
    },
    [samplesFromPointer],
  );

  const handlePointerLeave = useCallback(() => {
    if (cursorRef.current === null) return;
    cursorRef.current = null;
    dirtyRef.current = true;
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      const current = cursorRef.current ?? 0;
      const stepSize = event.shiftKey ? 10 : 1;
      switch (event.key) {
        case 'ArrowLeft':
          cursorRef.current = Math.min(windowSamples - 1, current + stepSize);
          break;
        case 'ArrowRight':
          cursorRef.current = Math.max(0, current - stepSize);
          break;
        case 'Home':
          cursorRef.current = windowSamples - 1;
          break;
        case 'End':
          cursorRef.current = 0;
          break;
        case 'Escape':
          cursorRef.current = null;
          setAnnouncement('cursor cleared');
          break;
        case ' ':
          onPausedChange(!paused);
          return;
        default:
          return;
      }
      event.preventDefault();
      dirtyRef.current = true;
      if (cursorRef.current !== null) {
        const seconds = ((cursorRef.current * intervalMsRef.current) / 1000).toFixed(1);
        const parts: string[] = [`${seconds} seconds ago`];
        for (const lane of lanesRef.current) {
          const value = laneRawAt(lane, cursorRef.current ?? 0, getChannelHistoryBuffer);
          if (value === undefined || isGapSample(lane, value)) continue;
          parts.push(`${lane.label} ${formatNumber(value * lane.scale + lane.offset, lane.digits)} ${lane.unit}`);
        }
        setAnnouncement(parts.join(', '));
      }
    },
    [onPausedChange, paused, windowSamples],
  );

  // Accessible value table: the canvas is opaque to assistive tech, so the
  // current reading of every lane is published as text (refreshed with the
  // snapshot, ~4 Hz).
  const rows = useMemo(
    () =>
      lanes.map((lane) => {
        const channels = useRealtimeStore.getState().channels;
        const raw = lane.barometric
          ? laneLatestRaw(lane, (channel) => channels[channel])
          : lane.id.startsWith('ch:')
            ? channels[lane.channel]
            : snapshot.values[lane.id];
        const missing = raw === undefined || isGapSample(lane, raw);
        return {
          label: lane.label,
          text: missing ? '—' : formatNumber(raw * lane.scale + lane.offset, lane.digits),
          unit: lane.unit,
        };
      }),
    [lanes, snapshot.values],
  );

  return (
    <div className="sd-scope" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="sd-scope__canvas"
        tabIndex={0}
        role="img"
        aria-describedby={tableId}
        aria-label={`Live telemetry scope: ${lanes.length} channels over the last ${windowSec} seconds. Arrow keys inspect values, shift+arrow jumps, space pauses.`}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
      />
      {/* Cursor position for keyboard/screen-reader users who cannot read the
          canvas measurement box. */}
      <div className="sd-sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {/* Visually hidden, but its own box must stay 1×1: a table element ignores
          a 1px width, so the wrapper carries the sr-only class and clips it. */}
      <div className="sd-sr-only" id={tableId}>
        <table>
          <caption>Current value of every scope channel</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.text}</td>
                <td>{row.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
