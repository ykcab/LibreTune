/**
 * Fixed-layout live telemetry monitor (Startup dash product surface).
 * Colon-style columns — not a boxed gauge panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  CHANNEL_HISTORY_MS_PER_SAMPLE,
  getChannelHistoryBuffer,
  useChannels,
  useIsReceivingData,
  useRealtimeStore,
} from '../../stores/realtimeStore';
import { KnockSpectrogramView } from '../diagnostics/KnockSpectrogramView';
import './StartupMonitor.css';

export interface StartupMonitorProps {
  isConnected: boolean;
}

type TelemetryRow = {
  key: string;
  label: string;
  unit: string;
  digits: number;
  alt?: string;
  /** Prefer AFR over λ for this row when both exist. */
  afrDisplay?: boolean;
  warnLo?: number;
  warnHi?: number;
  critHi?: number;
  /** Emphasize this row (e.g. RPM). */
  emphasize?: boolean;
};

/** Append new rows under the matching column — keep slot order stable. */
const COL_ENGINE: TelemetryRow[] = [
  { key: 'rpm', label: 'RPM', unit: '', digits: 0, warnHi: 6500, critHi: 7200, emphasize: true },
  { key: 'tps', label: 'TPS', unit: '%', digits: 1 },
  { key: 'map', label: 'MAP', unit: 'kPa', digits: 0, warnHi: 220 },
  { key: 'boost', label: 'Boost', unit: 'kPa', digits: 0 },
  { key: 'advance', label: 'Timing', unit: '°', digits: 1 },
];

const COL_FUEL: TelemetryRow[] = [
  { key: 'afr', label: 'AFR', unit: ':1', digits: 2, alt: 'lambda', afrDisplay: true, warnLo: 11.5, warnHi: 16.5 },
  { key: 'lambda', label: 'Lambda', unit: 'λ', digits: 3, alt: 'afr', warnLo: 0.82, warnHi: 1.2 },
  { key: 'dutyCycle', label: 'Inj Duty', unit: '%', digits: 1, warnHi: 85, critHi: 95 },
  { key: 'pulseWidth', label: 'Inj PW', unit: 'ms', digits: 2 },
  { key: 'lowFuelPressure', label: 'LPFP', unit: 'bar', digits: 1, alt: 'fuelPressure' },
  { key: 'highFuelPressure', label: 'HPFP', unit: 'bar', digits: 1, alt: 'rawHighFuelPressure' },
];

const COL_CRITICAL: TelemetryRow[] = [
  { key: 'coolant', label: 'Coolant', unit: '°C', digits: 0, warnHi: 100, critHi: 110 },
  { key: 'iat', label: 'IAT', unit: '°C', digits: 0 },
  { key: 'egt', label: 'EGT', unit: '°C', digits: 0, alt: 'egt1', warnHi: 850, critHi: 950 },
  { key: 'oilPressure', label: 'Oil Press', unit: 'kPa', digits: 0 },
  { key: 'oilTemp', label: 'Oil Temp', unit: '°C', digits: 0 },
  { key: 'fuelPressure', label: 'Fuel Press', unit: 'kPa', digits: 0 },
  { key: 'battery', label: 'Battery', unit: 'V', digits: 1, warnLo: 11.5 },
];

const COLUMNS: { id: string; title: string; rows: TelemetryRow[] }[] = [
  { id: 'engine', title: 'Engine', rows: COL_ENGINE },
  { id: 'fuel', title: 'Fuel', rows: COL_FUEL },
  { id: 'critical', title: 'Critical', rows: COL_CRITICAL },
];

const GRAPH_SERIES = [
  { key: 'rpm', label: 'RPM', color: '#57a0f5', min: 0, max: 8000 },
  { key: 'map', label: 'MAP', color: '#38bdf8', min: 0, max: 250 },
  { key: 'tps', label: 'TPS', color: '#fbbf24', min: 0, max: 100 },
  { key: 'lambda', label: 'λ', color: '#22c55e', min: 0.7, max: 1.3 },
] as const;

const LED_DEFS: { id: string; label: string; channel?: string }[] = [
  { id: 'connected', label: 'Connected' },
  { id: 'running', label: 'Engine Running' },
  { id: 'cranking', label: 'Cranking' },
  { id: 'closedLoop', label: 'Closed Loop', channel: 'closedLoop' },
  { id: 'fuelPump', label: 'Fuel Pump', channel: 'fuelPump' },
  { id: 'fan', label: 'Fan', channel: 'fan' },
  { id: 'knock', label: 'Knock', channel: 'knock' },
  { id: 'revLimit', label: 'Rev Limiter', channel: 'softLimit' },
  { id: 'launch', label: 'Launch Control', channel: 'launch' },
  { id: 'logging', label: 'Logging Active' },
];

function fmt(value: number | undefined, digits: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function valueColor(
  value: number | undefined,
  spec: { warnLo?: number; warnHi?: number; critHi?: number },
): string {
  if (value === undefined) return 'var(--sm-muted)';
  if (spec.critHi !== undefined && value >= spec.critHi) return 'var(--sm-crit)';
  if (spec.warnHi !== undefined && value >= spec.warnHi) return 'var(--sm-warn)';
  if (spec.warnLo !== undefined && value <= spec.warnLo) return 'var(--sm-warn)';
  return 'var(--sm-value)';
}

function readChannel(channels: Record<string, number>, name: string, alt?: string): number | undefined {
  if (channels[name] !== undefined) return channels[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(channels)) {
    if (k.toLowerCase() === lower) return v;
  }
  if (alt && channels[alt] !== undefined) return channels[alt];
  return undefined;
}

/** Resolve display value for a row (AFR↔λ conversion when needed). */
function rowValue(channels: Record<string, number>, row: TelemetryRow): number | undefined {
  if (row.afrDisplay) {
    if (channels.afr !== undefined) return channels.afr;
    if (channels.lambda !== undefined) return channels.lambda * 14.7;
    return readChannel(channels, row.key, row.alt);
  }
  if (row.key === 'lambda') {
    if (channels.lambda !== undefined) return channels.lambda;
    if (channels.afr !== undefined) return channels.afr / 14.7;
  }
  return readChannel(channels, row.key, row.alt);
}

export function isStartupMonitorPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const base = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  return base === 'startup.ltdash.xml' || base.startsWith('startup.');
}

function TelemetryColumns({ channels }: { channels: Record<string, number> }) {
  return (
    <div className="sm-columns">
      {COLUMNS.map((col) => (
        <div key={col.id} className="sm-column">
          <div className="sm-column-title">{col.title}</div>
          <dl className="sm-colon-list">
            {col.rows.map((row) => {
              const v = rowValue(channels, row);
              const missing = v === undefined;
              return (
                <div
                  key={row.key}
                  className={`sm-colon-row${row.emphasize ? ' emphasize' : ''}${missing ? ' missing' : ''}`}
                >
                  <dt>{row.label}:</dt>
                  <dd style={{ color: valueColor(v, row) }}>
                    <span className="sm-colon-num">{fmt(v, row.digits)}</span>
                    {!missing && row.unit ? <span className="sm-colon-unit">{row.unit}</span> : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}

export default function StartupMonitor({ isConnected }: StartupMonitorProps) {
  const channels = useChannels([
    'rpm', 'tps', 'map', 'lambda', 'afr', 'battery', 'coolant', 'iat', 'egt', 'egt1',
    'oilPressure', 'oilTemp', 'fuelPressure', 'lowFuelPressure', 'highFuelPressure', 'rawHighFuelPressure', 'boost', 'advance',
    'pulseWidth', 'dutyCycle', 'closedLoop', 'fuelPump', 'fan', 'knock',
    'softLimit', 'hardLimit', 'launch', 'ase',
  ]);
  const isReceiving = useIsReceivingData();
  const lastUpdateTime = useRealtimeStore((s) => s.lastUpdateTime);

  const [logging, setLogging] = useState(false);
  const [logDurationSec, setLogDurationSec] = useState(0);
  const [hz, setHz] = useState(0);
  const [visibleSeries, setVisibleSeries] = useState<Record<string, boolean>>({
    rpm: true, map: true, tps: true, lambda: true,
  });
  const [paused, setPaused] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showSpectrogram, setShowSpectrogram] = useState(false);
  const frozenRef = useRef<Record<string, number[]>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastTsRef = useRef(0);
  const hzSamplesRef = useRef<number[]>([]);

  const battery = readChannel(channels, 'battery');

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await invoke<{ is_recording: boolean; duration_ms: number }>('get_logging_status');
        if (!cancelled) {
          setLogging(st.is_recording);
          setLogDurationSec(Math.floor(st.duration_ms / 1000));
        }
      } catch {
        /* ignore when offline */
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!lastUpdateTime) return;
    const prev = lastTsRef.current;
    lastTsRef.current = lastUpdateTime;
    if (!prev) return;
    const dt = lastUpdateTime - prev;
    if (dt <= 0 || dt > 2000) return;
    const samples = hzSamplesRef.current;
    samples.push(1000 / dt);
    if (samples.length > 20) samples.shift();
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Avoid re-rendering the whole monitor on every OCH tick for ±1 Hz noise.
    setHz((prevHz) => (Math.abs(prevHz - avg) < 0.75 ? prevHz : avg));
  }, [lastUpdateTime]);

  const warnings = useMemo(() => {
    const list: string[] = [];
    if (!isConnected) return list;
    const rpm = readChannel(channels, 'rpm');
    const lambda = rowValue(channels, COL_FUEL[1]);
    const afr = rowValue(channels, COL_FUEL[0]);
    const batt = readChannel(channels, 'battery');
    const clt = readChannel(channels, 'coolant');
    if (batt !== undefined && batt < 11.0) list.push(`Battery low (${batt.toFixed(1)} V)`);
    if (clt !== undefined && clt >= 110) list.push(`Coolant critical (${clt.toFixed(0)} °C)`);
    if (lambda !== undefined && lambda < 0.75) list.push(`Lambda dangerously rich (${lambda.toFixed(3)})`);
    if (afr !== undefined && afr > 16.5 && (rpm ?? 0) > 800) {
      list.push(`AFR lean while running (${afr.toFixed(1)})`);
    }
    return list;
  }, [channels, isConnected]);

  const ledState = useCallback((id: string): 'on' | 'off' | 'unknown' => {
    if (id === 'connected') return isConnected ? 'on' : 'off';
    if (id === 'logging') return logging ? 'on' : 'off';
    const rpm = readChannel(channels, 'rpm') ?? 0;
    if (id === 'running') return rpm > 400 ? 'on' : 'off';
    if (id === 'cranking') return rpm >= 50 && rpm <= 400 ? 'on' : 'off';
    const def = LED_DEFS.find((d) => d.id === id);
    if (!def?.channel) return 'unknown';
    const v = readChannel(channels, def.channel);
    if (v === undefined) {
      if (id === 'revLimit') {
        const h = readChannel(channels, 'hardLimit');
        if (h === undefined) return 'unknown';
        return h > 0.5 ? 'on' : 'off';
      }
      return 'unknown';
    }
    return v > 0.5 ? 'on' : 'off';
  }, [channels, isConnected, logging]);

  const toggleSeries = (key: string) => {
    setVisibleSeries((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePause = () => {
    if (!paused) {
      const snap: Record<string, number[]> = {};
      for (const s of GRAPH_SERIES) {
        let hist = getChannelHistoryBuffer(s.key);
        if (hist.length < 2 && s.key === 'lambda') {
          const afr = getChannelHistoryBuffer('afr');
          if (afr.length >= 2) hist = afr.map((v) => v / 14.7);
        }
        snap[s.key] = hist.slice();
      }
      frozenRef.current = snap;
    }
    setPaused((p) => !p);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let cssW = 0;
    let cssH = 0;
    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(1, Math.floor(rect.width));
      cssH = Math.max(1, Math.floor(rect.height));
    };
    syncSize();
    const ro = new ResizeObserver(() => syncSize());
    ro.observe(canvas);

    const paint = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(paint);
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#12151a';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h * i) / 4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const pad = 8 * dpr;
      for (const s of GRAPH_SERIES) {
        if (!visibleSeries[s.key]) continue;
        let hist = paused
          ? (frozenRef.current[s.key] ?? [])
          : getChannelHistoryBuffer(s.key);
        if (hist.length < 2 && s.key === 'lambda' && !paused) {
          const afrHist = getChannelHistoryBuffer('afr');
          if (afrHist.length >= 2) hist = afrHist.map((v) => v / 14.7);
        }
        if (hist.length < 2) continue;
        const keep = Math.max(20, Math.floor(hist.length / Math.max(1, zoom)));
        hist = hist.slice(hist.length - keep);
        const range = s.max - s.min || 1;
        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5 * dpr;
        for (let i = 0; i < hist.length; i++) {
          const x = pad + ((w - pad * 2) * i) / (hist.length - 1);
          const n = Math.max(0, Math.min(1, (hist[i] - s.min) / range));
          const y = h - pad - n * (h - pad * 2);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [paused, visibleSeries, zoom]);

  const windowSec = Math.round(
    ((300 * CHANNEL_HISTORY_MS_PER_SAMPLE) / 1000) / Math.max(1, zoom),
  );

  return (
    <div className="startup-monitor">
      <div className="sm-status">
        <span className={`sm-pill ${isConnected ? 'ok' : 'off'}`}>
          {isConnected ? (isReceiving ? 'Connected' : 'Connected · waiting') : 'Disconnected'}
        </span>
        <span className="sm-stat">
          BATT <strong>{fmt(battery, 1)}</strong> V
        </span>
        <span className="sm-stat">
          RATE <strong>{hz > 0 ? hz.toFixed(0) : '—'}</strong> Hz
        </span>
        <span className={`sm-pill ${logging ? 'ok' : 'off'}`}>
          {logging ? `Logging ${logDurationSec}s` : 'Log Off'}
        </span>
      </div>

      <TelemetryColumns channels={channels} />

      <div className="sm-graph-panel">
        <div className="sm-graph-toolbar">
          <span className="sm-graph-title">Live Telemetry · {windowSec}s</span>
          <div className="sm-series-toggles">
            {GRAPH_SERIES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`sm-series-btn ${visibleSeries[s.key] ? 'on' : ''}`}
                style={{ ['--series' as string]: s.color }}
                onClick={() => toggleSeries(s.key)}
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              className={`sm-series-btn ${showSpectrogram ? 'on' : ''}`}
              style={{ ['--series' as string]: '#4ade80' }}
              onClick={() => setShowSpectrogram((v) => !v)}
              title={isConnected ? 'Show knock spectrogram overlay' : 'Connect to ECU first'}
            >
              Spectrogram
            </button>
          </div>
          <div className="sm-graph-actions">
            <button type="button" onClick={handlePause}>{paused ? 'Resume' : 'Pause'}</button>
            <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 1))} disabled={zoom >= 4}>Zoom +</button>
            <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 1))} disabled={zoom <= 1}>Zoom −</button>
          </div>
        </div>
        <div className="sm-graph-stage">
          <canvas ref={canvasRef} className="sm-graph-canvas" />
          {showSpectrogram && (
            <div className="sm-graph-overlays">
              <div className="sm-overlay-pane">
                <KnockSpectrogramView
                  isConnected={isConnected}
                  embedded
                  active={showSpectrogram}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="sm-leds">
        {LED_DEFS.map((led) => {
          const st = ledState(led.id);
          return (
            <div key={led.id} className={`sm-led ${st}`}>
              <span className="sm-led-dot" />
              <span className="sm-led-label">{led.label}</span>
            </div>
          );
        })}
      </div>

      <div className={`sm-warnings${warnings.length ? '' : ' empty'}`} aria-live="polite">
        {warnings.map((w) => (
          <div key={w} className="sm-warning-item">{w}</div>
        ))}
      </div>
    </div>
  );
}
