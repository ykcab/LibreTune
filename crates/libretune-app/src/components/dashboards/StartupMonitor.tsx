/**
 * Startup dashboard — F1 broadcast-style telemetry face.
 *
 * Three vertical bands (engine / trace / fuel) plus a bottom session
 * timeline, in the flat-charcoal, hairline-ruled, condensed-uppercase
 * language of a race broadcast graphic. Composed instrument display,
 * not a gauge grid.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  getChannelHistoryBuffer,
  useChannels,
  useIsReceivingData,
  useRealtimeStore,
} from '../../stores/realtimeStore';
import { KnockSpectrogramView } from '../diagnostics/KnockSpectrogramView';
import { LiveGraphLog } from '../tuner-ui/LiveGraphLog';
import { ReviewGraphLog } from '../tuner-ui/ReviewGraphLog';
import './StartupMonitor.css';

export interface StartupMonitorProps {
  isConnected: boolean;
}

export function isStartupMonitorPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const base = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  return base === 'startup.ltdash.xml' || base.startsWith('startup.');
}

/* ---------- formatting helpers ---------- */

function fmt(value: number | undefined, digits: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function fmtSigned(value: number | undefined, digits: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  const s = value.toFixed(digits);
  return value > 0 ? `+${s}` : s;
}

function fmtClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function readChannel(
  channels: Record<string, number>,
  name: string,
  alt?: string,
): number | undefined {
  if (channels[name] !== undefined) return channels[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(channels)) {
    if (k.toLowerCase() === lower) return v;
  }
  if (alt && channels[alt] !== undefined) return channels[alt];
  return undefined;
}

/** Threshold tone: '' = normal, 'dim' = missing, 'warn' / 'crit'. */
function tone(
  value: number | undefined,
  spec: { lo?: number; hi?: number; crit?: number },
): string {
  if (value === undefined) return 'dim';
  if (spec.crit !== undefined && value >= spec.crit) return 'crit';
  if (spec.hi !== undefined && value >= spec.hi) return 'warn';
  if (spec.lo !== undefined && value <= spec.lo) return 'warn';
  return '';
}

/* ---------- display primitives ---------- */

function ptOnArc(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, d0: number, d1: number): string {
  const s = ptOnArc(cx, cy, r, d0);
  const e = ptOnArc(cx, cy, r, d1);
  const large = d1 - d0 > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

function Hero({
  label,
  value,
  unit,
  accent,
  delta,
  toneCls,
}: {
  label: string;
  value: string;
  unit?: string;
  accent: string;
  delta?: string;
  toneCls: string;
}) {
  return (
    <div className={`f1-hero ${toneCls}`} style={{ ['--f1-accent' as string]: accent }}>
      <div className="f1-hero-label">{label}</div>
      <div className="f1-hero-value">
        {value}
        {unit ? <span className="f1-hero-unit">{unit}</span> : null}
      </div>
      {delta !== undefined ? <div className="f1-hero-delta">{delta}</div> : null}
    </div>
  );
}

function Readout({
  label,
  value,
  unit,
  toneCls,
}: {
  label: string;
  value: string;
  unit?: string;
  toneCls: string;
}) {
  return (
    <div className="f1-readout">
      <div className="f1-readout-label">{label}</div>
      <div className={`f1-readout-value ${toneCls}`}>
        {value}
        {unit ? <span className="f1-readout-unit">{unit}</span> : null}
      </div>
    </div>
  );
}

function Bar({
  label,
  value,
  frac,
  color,
}: {
  label: string;
  value: string;
  frac: number;
  color: string;
}) {
  return (
    <div className="f1-bar">
      <div className="f1-bar-head">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="f1-bar-track">
        <i style={{ width: `${clamp01(frac) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function SemiGauge({
  label,
  value,
  frac,
  color,
}: {
  label: string;
  value: string;
  frac: number;
  color: string;
}) {
  const f = clamp01(frac);
  return (
    <div className="f1-semi">
      <svg viewBox="0 0 120 66" role="img" aria-label={label}>
        <path d={arcPath(60, 60, 52, 180, 360)} fill="none" stroke="var(--f1-track)" strokeWidth="9" />
        {f > 0.001 && (
          <path
            d={arcPath(60, 60, 52, 180, 180 + 180 * f)}
            fill="none"
            stroke={color}
            strokeWidth="9"
          />
        )}
        <text x="60" y="56" textAnchor="middle" className="f1-semi-value">
          {value}
        </text>
      </svg>
      <div className="f1-semi-label">{label}</div>
    </div>
  );
}

function MiniGauge({
  label,
  value,
  frac,
  color,
}: {
  label: string;
  value: string;
  frac: number;
  color: string;
}) {
  const f = clamp01(frac);
  return (
    <div className="f1-mini">
      <svg viewBox="0 0 40 40" role="img" aria-label={label}>
        <circle cx="20" cy="20" r="16" fill="none" stroke="var(--f1-track)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${(f * 100.5).toFixed(1)} 100.5`}
          strokeLinecap="round"
          transform="rotate(-90 20 20)"
        />
        <text x="20" y="24" textAnchor="middle" className="f1-mini-value">
          {value}
        </text>
      </svg>
      <div className="f1-mini-label">{label}</div>
    </div>
  );
}

/**
 * Isolated data-rate readout. Subscribes to `lastUpdateTime` on its own so the
 * ~10 Hz stream flush does not re-render the whole monitor just to refresh one
 * number.
 */
function RateMeter() {
  const lastUpdateTime = useRealtimeStore((s) => s.lastUpdateTime);
  const [hz, setHz] = useState(0);
  const lastTsRef = useRef(0);
  const hzSamplesRef = useRef<number[]>([]);

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
    setHz((prevHz) => (Math.abs(prevHz - avg) < 0.75 ? prevHz : avg));
  }, [lastUpdateTime]);

  return (
    <div className="f1-rate-value">
      {hz > 0 ? hz.toFixed(0) : '—'}
      <span className="f1-rate-unit">Hz</span>
    </div>
  );
}

/* ---------- the dashboard ---------- */

export default function StartupMonitor({ isConnected }: StartupMonitorProps) {
  const channels = useChannels([
    'rpm', 'speed', 'gear', 'tps', 'map', 'lambda', 'afr', 'afrTarget', 'targetLambda',
    'battery', 'coolant', 'iat', 'egt', 'egt1', 'oilPressure', 'oilTemp',
    'fuelPressure', 'lowFuelPressure', 'highFuelPressure', 'rawHighFuelPressure',
    'boost', 'advance', 'pulseWidth', 'dutyCycle', 'flexPercent',
    'closedLoop', 'fuelPump', 'fan', 'knock', 'softLimit', 'hardLimit', 'launch', 'ase',
  ]);
  const isReceiving = useIsReceivingData();

  const [logging, setLogging] = useState(false);
  const [logDurationSec, setLogDurationSec] = useState(0);
  const [sessionSec, setSessionSec] = useState(0);
  const [mode, setMode] = useState<'live' | 'review'>('live');
  const [showSpectrogram, setShowSpectrogram] = useState(false);

  // Derived values
  const rpm = readChannel(channels, 'rpm');
  const speed = readChannel(channels, 'speed');
  const gear = readChannel(channels, 'gear');
  const tps = readChannel(channels, 'tps');
  const map = readChannel(channels, 'map');
  const boost = readChannel(channels, 'boost');
  const coolant = readChannel(channels, 'coolant');
  const iat = readChannel(channels, 'iat');
  const egt = readChannel(channels, 'egt', 'egt1');
  const oilPressure = readChannel(channels, 'oilPressure');
  const oilTemp = readChannel(channels, 'oilTemp');
  const battery = readChannel(channels, 'battery');
  const duty = readChannel(channels, 'dutyCycle');
  const timing = readChannel(channels, 'advance');
  const fuelPressure = readChannel(channels, 'fuelPressure');
  const lambda = channels.lambda ?? (channels.afr !== undefined ? channels.afr / 14.7 : undefined);
  const afr = channels.afr ?? (lambda !== undefined ? lambda * 14.7 : undefined);
  const afrTargetRaw = readChannel(channels, 'afrTarget');
  const targetLambda = readChannel(channels, 'targetLambda');
  const afrTarget =
    afrTargetRaw ?? (targetLambda !== undefined ? targetLambda * 14.7 : undefined);

  // RPM delta over the trailing ~5 s history window (informational accent).
  const rpmDelta = (() => {
    const h = getChannelHistoryBuffer('rpm');
    if (h.length < 20) return undefined;
    return h[h.length - 1] - h[Math.max(0, h.length - 50)];
  })();

  const afrDelta = afr !== undefined && afrTarget !== undefined ? afr - afrTarget : undefined;
  const afrOnTarget = afrDelta !== undefined && Math.abs(afrDelta) < 0.3;
  const afrDeltaLabel =
    afrDelta === undefined
      ? undefined
      : afrOnTarget
        ? 'ON TARGET'
        : `${fmtSigned(afrDelta, 1)} ${afrDelta > 0 ? 'LEAN' : 'RICH'}`;

  const engineRunning = (rpm ?? 0) > 400;
  const cranking = (rpm ?? 0) >= 50 && (rpm ?? 0) <= 400;

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
    void tick();
    const id = window.setInterval(() => {
      setSessionSec((s) => s + 1);
      void tick();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const warnings = useMemo(() => {
    const list: string[] = [];
    if (!isConnected) return list;
    const rpmV = readChannel(channels, 'rpm');
    const lambdaV = lambda;
    const afrV = afr;
    const batt = readChannel(channels, 'battery');
    const clt = readChannel(channels, 'coolant');
    if (batt !== undefined && batt < 11.0) list.push(`Battery low (${batt.toFixed(1)} V)`);
    if (clt !== undefined && clt >= 110) list.push(`Coolant critical (${clt.toFixed(0)} °C)`);
    if (lambdaV !== undefined && lambdaV < 0.75) {
      list.push(`Lambda dangerously rich (${lambdaV.toFixed(3)})`);
    }
    if (afrV !== undefined && afrV > 16.5 && (rpmV ?? 0) > 800) {
      list.push(`AFR lean while running (${afrV.toFixed(1)})`);
    }
    return list;
  }, [channels, isConnected, lambda, afr]);

  const timelineEvents = useMemo(() => {
    const ev: { label: string; cls: string }[] = [];
    if (engineRunning) {
      const cl = readChannel(channels, 'closedLoop');
      if (cl !== undefined && cl < 0.5) ev.push({ label: 'OPEN LOOP', cls: 'blue' });
      const kn = readChannel(channels, 'knock');
      if (kn !== undefined && kn > 0.5) ev.push({ label: 'KNOCK', cls: 'grey' });
    }
    for (const w of warnings) {
      ev.push({ label: w.split('(')[0].trim().toUpperCase(), cls: 'gold' });
    }
    return ev;
  }, [channels, engineRunning, warnings]);

  const rpmTone = tone(rpm, { hi: 6500, crit: 7200 });
  const afrTone = tone(afr, { lo: 11.5, hi: 16.5 });

  const bannerText = !isConnected
    ? 'DISCONNECTED'
    : warnings[0] ?? (engineRunning ? 'ENGINE RUNNING' : cranking ? 'CRANKING' : isReceiving ? 'READY' : 'WAITING');
  const bannerCls = !isConnected
    ? 'dim'
    : warnings.length
      ? 'warn'
      : engineRunning || cranking || isReceiving
        ? 'ok'
        : 'dim';

  return (
    <div className="startup-monitor">
      <header className="f1-header">
        <span className="f1-header-title">LIBRETUNE</span>
        <span className="f1-header-right">
          {isConnected ? (isReceiving ? 'LIVE' : 'WAITING') : 'DISCONNECTED'} · {fmtClock(sessionSec)}
        </span>
      </header>

      {/* ---------- left band: engine ---------- */}
      <section className="f1-left">
        <div className={`f1-banner ${bannerCls}`}>{bannerText}</div>

        <Hero
          label="ENGINE SPEED"
          value={fmt(rpm, 0)}
          accent="var(--f1-blue)"
          toneCls={rpmTone}
          delta={rpmDelta !== undefined ? fmtSigned(rpmDelta, 0) : undefined}
        />

        <div className="f1-gear">
          <span className="f1-gear-badge">{fmt(gear, 0)}</span>
          <span className="f1-label">GEAR</span>
        </div>

        <Readout label="SPEED" value={fmt(speed, 0)} unit="km/h" toneCls="" />
        <Readout label="COOLANT" value={fmt(coolant, 0)} unit="°C" toneCls={tone(coolant, { hi: 100, crit: 110 })} />

        <Bar
          label="BATTERY"
          value={`${fmt(battery, 1)} V`}
          frac={battery === undefined ? 0 : (battery - 10) / 5}
          color="var(--f1-blue)"
        />
        <Bar label="THROTTLE" value={`${fmt(tps, 1)} %`} frac={(tps ?? 0) / 100} color="var(--f1-blue)" />

        <SemiGauge
          label="OIL PRESS"
          value={fmt(oilPressure, 0)}
          frac={(oilPressure ?? 0) / 400}
          color="var(--f1-blue)"
        />
      </section>

      {/* ---------- centre band: trace + raw ---------- */}
      <section className="f1-centre">
        <div className="f1-centre-head">
          <div>
            <div className="f1-label">SESSION</div>
            <div className="f1-session-time">{logging ? fmtClock(logDurationSec) : fmtClock(sessionSec)}</div>
          </div>
          <div className="f1-modes" role="tablist" aria-label="Trace mode">
            <button type="button" className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')}>
              LIVE
            </button>
            <button type="button" className={mode === 'review' ? 'on' : ''} onClick={() => setMode('review')}>
              REVIEW
            </button>
            <button
              type="button"
              className={showSpectrogram ? 'on' : ''}
              onClick={() => setShowSpectrogram((v) => !v)}
            >
              SPECTRO
            </button>
          </div>
        </div>

        <div className="f1-trace">
          {mode === 'live' ? <LiveGraphLog /> : <ReviewGraphLog />}
          {showSpectrogram && (
            <div className="f1-trace-overlay">
              <KnockSpectrogramView isConnected={isConnected} embedded active={showSpectrogram} />
            </div>
          )}
        </div>

        <div className="f1-centre-foot">
          <div className="f1-raw">
            <div className="f1-label">RAW TELEMETRY DATA</div>
            <div className="f1-raw-grid">
              <span>rpm = {fmt(rpm, 0)}</span>
              <span>clt = {fmt(coolant, 0)}</span>
              <span>afr = {fmt(afr, 1)}</span>
              <span>batt = {fmt(battery, 1)}</span>
              <span>map = {fmt(map, 0)}</span>
              <span>duty = {fmt(duty, 1)}</span>
            </div>
          </div>
          <div className="f1-rate">
            <div className="f1-label">DATA RATE</div>
            <RateMeter />
          </div>
        </div>
      </section>

      {/* ---------- right band: fuel ---------- */}
      <section className="f1-right">
        <Hero
          label="AIR FUEL RATIO"
          value={fmt(afr, 1)}
          unit=":1"
          accent="var(--f1-gold)"
          toneCls={afrTone}
          delta={afrDeltaLabel}
        />

        <Readout label="LAMBDA" value={fmt(lambda, 2)} unit="λ" toneCls="" />
        <Readout label="TIMING" value={fmt(timing, 1)} unit="°" toneCls="" />
        <Readout label="BOOST" value={fmt(boost, 0)} unit="kPa" toneCls={tone(boost, { hi: 220 })} />

        <Bar label="INJ DUTY" value={`${fmt(duty, 1)} %`} frac={(duty ?? 0) / 100} color="var(--f1-gold)" />
        <Readout label="FUEL PRESS" value={fmt(fuelPressure, 0)} unit="kPa" toneCls="" />
        <Readout label="EGT" value={fmt(egt, 0)} unit="°C" toneCls={tone(egt, { hi: 850, crit: 950 })} />

        <div className="f1-minis">
          <MiniGauge label="OIL T" value={fmt(oilTemp, 0)} frac={(oilTemp ?? 0) / 150} color="var(--f1-gold)" />
          <MiniGauge label="IAT" value={fmt(iat, 0)} frac={(iat ?? 0) / 60} color="var(--f1-gold)" />
          <MiniGauge label="FUEL P" value={fmt(fuelPressure, 0)} frac={(fuelPressure ?? 0) / 400} color="var(--f1-gold)" />
          <MiniGauge label="BATT" value={fmt(battery, 1)} frac={(battery ?? 0) / 15} color="var(--f1-gold)" />
        </div>
      </section>

      {/* ---------- bottom timeline ---------- */}
      <div className="f1-timeline">
        <div className="f1-label">SESSION TIMELINE</div>
        <div className="f1-timeaxis">
          {[0, 10, 20, 30, 40, 50].map((t) => (
            <span key={t} className="f1-tick" style={{ left: `${(t / 60) * 100}%` }}>
              {t}
            </span>
          ))}
          <span className="f1-tick" style={{ left: '100%' }}>60 s</span>
          {timelineEvents.slice(0, 4).map((ev, i) => (
            <span
              key={`${ev.label}-${i}`}
              className={`f1-marker ${ev.cls}`}
              style={{ left: `${82 - i * 8}%` }}
            >
              {ev.label}
            </span>
          ))}
          <span className="f1-now" />
        </div>
      </div>
    </div>
  );
}
