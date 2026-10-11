/**
 * LiveScope — purpose-built live telemetry scope for the Startup dashboard.
 *
 * Replaces the generic GraphLog strip chart that was previously dropped into
 * the centre of the Startup face. Unlike GraphLog (tabs / panes / zoom /
 * cursors), this is a single fixed multi-lane oscilloscope tuned for one job:
 * scroll the tuning-critical channels in real time.
 *
 * It reads the realtime history buffers imperatively on a throttled
 * requestAnimationFrame loop, so the ~10 Hz channel stream never cascades
 * into the React render tree — the whole component re-renders zero times after
 * mount. Lanes use fixed ranges (stable, deliberate) rather than per-pane
 * auto-scaling so a blip never rescales the whole scope.
 */
import { memo, useEffect, useRef } from 'react';
import { getChannelHistoryBuffer } from '../../stores/realtimeStore';
import './LiveScope.css';

export interface ScopeLane {
  key: string;
  label: string;
  unit: string;
  color: string;
  min: number;
  max: number;
  digits: number;
  /** Realtime history key (canonical channel name). */
  channel: string;
  /** Optional fallback history key, scaled (e.g. lambda × 14.7 → AFR). */
  fallback?: { channel: string; scale: number };
}

/**
 * Fixed lane set, in deliberate display order. Colours are stable and are the
 * single source of truth for the trace lines (the raw readout reuses them via
 * SCOPE_LANES rather than duplicating hex literals).
 */
export const SCOPE_LANES: ScopeLane[] = [
  { key: 'rpm', label: 'RPM', unit: '', color: '#ffb300', min: 0, max: 9000, digits: 0, channel: 'rpm' },
  { key: 'map', label: 'MAP', unit: 'kPa', color: '#42a5f5', min: 0, max: 250, digits: 0, channel: 'map' },
  { key: 'afr', label: 'AFR', unit: ':1', color: '#66bb6a', min: 10, max: 20, digits: 1, channel: 'afr', fallback: { channel: 'lambda', scale: 14.7 } },
  { key: 'tps', label: 'TPS', unit: '%', color: '#26c6da', min: 0, max: 100, digits: 0, channel: 'tps' },
  { key: 'clt', label: 'CLT', unit: '°C', color: '#b0bec5', min: 0, max: 140, digits: 0, channel: 'coolant' },
  { key: 'iat', label: 'IAT', unit: '°C', color: '#9ccc65', min: 0, max: 120, digits: 0, channel: 'iat' },
  { key: 'adv', label: 'ADV', unit: '°', color: '#ba68c8', min: 0, max: 60, digits: 1, channel: 'advance' },
  { key: 'pw', label: 'PW', unit: 'ms', color: '#ec407a', min: 0, max: 25, digits: 1, channel: 'pulseWidth' },
];

/** Matches realtimeStore's fixed history depth, so a full buffer fills the
 *  scope edge-to-edge and a late-joining channel scrolls in from the left. */
const WINDOW_SAMPLES = 300;
/** Redraw cadence: smooth enough to scroll, cheap enough to be invisible. */
const DRAW_INTERVAL_MS = 80;

const MONO = '"IBM Plex Mono", Consolas, monospace';
const SANS = '"IBM Plex Sans", system-ui, sans-serif';

function laneSamples(lane: ScopeLane): number[] {
  const h = getChannelHistoryBuffer(lane.channel);
  if ((!h || h.length === 0) && lane.fallback) {
    const f = getChannelHistoryBuffer(lane.fallback.channel);
    if (f && f.length) return f.map((v) => v * lane.fallback!.scale);
  }
  return h ?? [];
}

function fmtVal(v: number | undefined, digits: number): string {
  if (v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(digits);
}

function paint(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);

  const lanes = SCOPE_LANES;
  if (lanes.length === 0) return;
  const laneH = h / lanes.length;

  // Gutters shrink on very narrow hosts so traces keep usable width.
  const gutterL = w < 420 ? 46 : 64;
  const gutterR = w < 420 ? 54 : 76;
  const traceLeft = gutterL;
  const traceRight = Math.max(traceLeft + 1, w - gutterR);
  const traceW = traceRight - traceLeft;
  const step = traceW / (WINDOW_SAMPLES - 1);

  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const y0 = i * laneH;
    const y1 = (i + 1) * laneH;
    const cy = y0 + laneH / 2;

    if (i > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(w, y0);
      ctx.stroke();
    }

    ctx.textBaseline = 'middle';

    // Lane label + fixed range (left gutter).
    ctx.textAlign = 'left';
    ctx.fillStyle = lane.color;
    ctx.font = `600 10px ${SANS}`;
    ctx.fillText(lane.label, 12, cy - 8);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = `9px ${MONO}`;
    ctx.fillText(`${lane.min}–${lane.max}`, 12, cy + 8);

    // Current value + unit (right gutter).
    const samples = laneSamples(lane);
    const cur = samples.length ? samples[samples.length - 1] : undefined;
    ctx.textAlign = 'right';
    ctx.fillStyle = cur === undefined ? 'rgba(255, 255, 255, 0.3)' : lane.color;
    ctx.font = `600 13px ${MONO}`;
    ctx.fillText(fmtVal(cur, lane.digits), traceRight + 8, cy - 8);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = `9px ${SANS}`;
    ctx.fillText(lane.unit, traceRight + 8, cy + 8);

    if (samples.length < 2) continue;

    const pad = 4;
    const top = y0 + pad;
    const bot = y1 - pad;
    const range = lane.max - lane.min || 1;
    ctx.strokeStyle = lane.color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let j = 0; j < samples.length; j++) {
      const x = traceRight - (samples.length - 1 - j) * step;
      const v = samples[j];
      const f = v <= lane.min ? 0 : v >= lane.max ? 1 : (v - lane.min) / range;
      const y = bot - f * (bot - top);
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/**
 * Memoized and prop-free: mounts once and drives its own rAF loop. Reads the
 * realtime store imperatively, so the parent's ~10 Hz re-render never reaches
 * this subtree.
 */
export const LiveScope = memo(function LiveScope() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const resize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const rect = wrap.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastDraw = 0; // force an immediate repaint at the new size
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - lastDraw < DRAW_INTERVAL_MS) return;
      lastDraw = now;
      paint(ctx, w, h);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="ls" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
});

export default LiveScope;
