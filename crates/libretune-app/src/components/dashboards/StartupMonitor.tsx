/**
 * Startup dashboard — live engine telemetry monitor.
 *
 * Re-imagined (Oct 2026): the F1 broadcast chrome is gone. There is no
 * "session" clock and no session timeline — those were track-session concepts
 * that belong to the dedicated Race dashboard. The centre is now a
 * purpose-built multi-lane live scope (LiveScope), flanked by an engine rail
 * and a fuel/air rail, with a slim warning-chip footer that only appears when
 * something needs attention.
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
import { ReviewGraphLog } from '../tuner-ui/ReviewGraphLog';
import { LiveScope } from './LiveScope';
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
    <div className={`sm-hero ${toneCls}`} style={{ ['--sm-accent' as string]: accent }}>
      <div className="sm-hero-label">{label}</div>
      <div className="sm-hero-value">
        {value}
        {unit ? <span className="sm-hero-unit">{unit}</span> : null}
      </div>
      {delta !== undefined ? <div className="sm-hero-delta">{delta}</div> : null}
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
    <div className="sm-readout">
      <div className="sm-readout-label">{label}</div>
      <div className={`sm-readout-value ${toneCls}`}>
        {value}
        {unit ? <span className="sm-readout-unit">{unit}</span> : null}
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
    <div className="sm-bar">
      <div className="sm-bar-head">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="sm-bar-track">
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
    <div className="sm-semi">
      <svg viewBox="0 0 120 66" role="img" aria-label={label}>
        <path d={arcPath(60, 60, 52, 180, 360)} fill="none" stroke="var(--sm-track)" strokeWidth="9" />
        {f > 0.001 && (
          <path
            d={arcPath(60, 60, 52, 180, 180 + 180 * f)}
            fill="none"
            stroke={color}
            strokeWidth="9"
          />
        )}
        <text x="60" y="56" textAnchor="middle" className="sm-semi-value">
          {value}
        </text>
      </svg>
      <div className="sm-semi-label">{label}</div>
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
    <div className="sm-mini">
      <svg viewBox="0 0 40 40" role="img" aria-label={label}>
        <circle cx="20" cy="20" r="16" fill="none" stroke="var(--sm-track)" strokeWidth="3" />
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
        <text x="20" y="24" textAnchor="middle" className="sm-mini-value">
          {value}
        </text>
      </svg>
      <div className="sm-mini-label">{label}</div>
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
  const prevRef = useRef(0);
  const samplesRef = useRef<number[]>([]);

  useEffect(() => {
    if (!lastUpdateTime) return;
    const prev = prevRef.current;
    prevRef.current = lastUpdateTime;
    if (!prev) return;
    const dt = lastUpdateTime - prev;
    if (dt <= 0 || dt > 2000) return;
    const samples = samplesRef.current;
    samples.push(1000 / dt);
    if (samples.length > 20) samples.shift();
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    setHz((prevHz) => (Math.abs(prevHz - avg) < 0.75 ? prevHz : avg));
  }, [lastUpdateTime]);

  return (
    <span className="sm-rate-value">
      {hz > 0 ? hz.toFixed(0) : '—'}
      <span className="sm-rate-unit">Hz</span>
    </span>
  );
}

/* ---------- the dashboard ---------- */

export default function StartupMonitor({ isConnected }: StartupMonitorProps) {
  const channels = useChannels([
    'rpm', 'speed', 'gear', 'tps', 'lambda', 'afr', 'afrTarget', 'targetLambda',
    'battery', 'coolant', 'iat', 'egt', 'egt1', 'oilPressure', 'oilTemp',
    'fuelPressure', 'lowFuelPressure', 'highFuelPressure', 'rawHighFuelPressure',
    'boost', 'advance', 'pulseWidth', 'dutyCycle', 'flexPercent',
    'closedLoop', 'fuelPump', 'fan', 'knock', 'softLimit', 'hardLimit', 'launch', 'ase',
  ]);
  const isReceiving = useIsReceivingData();

  const [logging, setLogging] = useState(false);
  const [logDurationSec, setLogDurationSec] = useState(0);
  const [mode, setMode] = useState<'live' | 'review'>('live');
  const [showSpectrogram, setShowSpectrogram] = useState(false);

  // Derived values
  const rpm = readChannel(channels, 'rpm');
  const speed = readChannel(channels, 'speed');
  const gear = readChannel(channels, 'gear');
  const tps = readChannel(channels, 'tps');
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
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const warnings = useMemo(() => {
    const list: string[] = [];
    if (!isConnected) return list;
    const rpmV = readChannel(channels, 'rpm');
    const batt = readChannel(channels, 'battery');
    const clt = readChannel(channels, 'coolant');
    if (batt !== undefined && batt < 11.0) list.push(`Battery low (${batt.toFixed(1)} V)`);
    if (clt !== undefined && clt >= 110) list.push(`Coolant critical (${clt.toFixed(0)} °C)`);
    if (lambda !== undefined && lambda < 0.75) {
      list.push(`Lambda dangerously rich (${lambda.toFixed(3)})`);
    }
    if (afr !== undefined && afr > 16.5 && (rpmV ?? 0) > 800) {
      list.push(`AFR lean while running (${afr.toFixed(1)})`);
    }
    return list;
  }, [channels, isConnected, lambda, afr]);

  const statusChips = useMemo(() => {
    const chips: { label: string; cls: string }[] = [];
    if (engineRunning) {
      const cl = readChannel(channels, 'closedLoop');
      if (cl !== undefined && cl < 0.5) chips.push({ label: 'OPEN LOOP', cls: 'info' });
      const kn = readChannel(channels, 'knock');
      if (kn !== undefined && kn > 0.5) chips.push({ label: 'KNOCK', cls: 'warn' });
    }
    for (const w of warnings) {
      chips.push({ label: w.split('(')[0].trim().toUpperCase(), cls: 'warn' });
    }
    return chips;
  }, [channels, engineRunning, warnings]);

  const rpmTone = tone(rpm, { hi: 6500, crit: 7200 });
  const afrTone = tone(afr, { lo: 11.5, hi: 16.5 });

  const linkLabel = !isConnected ? 'DISCONNECTED' : isReceiving ? 'LIVE' : 'WAITING';
  const linkCls = !isConnected ? 'dim' : isReceiving ? 'ok' : 'wait';
  const engineState = !isConnected
    ? ''
    : engineRunning
      ? 'ENGINE RUNNING'
      : cranking
        ? 'CRANKING'
        : isReceiving
          ? 'READY'
          : '';
  const engineStateCls = engineRunning || cranking ? 'ok' : 'dim';

  return (
    <div className="startup-monitor">
      <header className="sm-header">
        <span className="sm-title">LibreTune</span>
        <div className="sm-status">
          {logging && (
            <span className="sm-chip sm-chip--rec">
              <i className="sm-dot" /> REC {fmtClock(logDurationSec)}
            </span>
          )}
          <span className={`sm-pill ${linkCls}`}>
            <i className="sm-dot" /> {linkLabel}
          </span>
          <RateMeter />
        </div>
      </header>

      {/* ---------- left rail: engine ---------- */}
      <section className="sm-left">
        {engineState ? (
          <div className={`sm-state ${engineStateCls}`}>{engineState}</div>
        ) : (
          <div className="sm-state dim">NO TELEMETRY</div>
        )}

        <Hero
          label="ENGINE SPEED"
          value={fmt(rpm, 0)}
          accent="var(--sm-amber)"
          toneCls={rpmTone}
          delta={rpmDelta !== undefined ? fmtSigned(rpmDelta, 0) : undefined}
        />

        <div className="sm-duo">
          <div className="sm-gear">
            <span className="sm-gear-badge">{fmt(gear, 0)}</span>
            <span className="sm-minilabel">GEAR</span>
          </div>
          <Readout label="SPEED" value={fmt(speed, 0)} unit="km/h" toneCls="" />
        </div>

        <SemiGauge
          label="OIL PRESS"
          value={fmt(oilPressure, 0)}
          frac={(oilPressure ?? 0) / 400}
          color="var(--sm-blue)"
        />

        <Readout
          label="COOLANT"
          value={fmt(coolant, 0)}
          unit="°C"
          toneCls={tone(coolant, { hi: 100, crit: 110 })}
        />

        <Bar
          label="BATTERY"
          value={`${fmt(battery, 1)} V`}
          frac={battery === undefined ? 0 : (battery - 10) / 5}
          color="var(--sm-blue)"
        />
        <Bar label="THROTTLE" value={`${fmt(tps, 1)} %`} frac={(tps ?? 0) / 100} color="var(--sm-blue)" />
      </section>

      {/* ---------- centre: live scope ---------- */}
      <section className="sm-centre">
        <div className="sm-centre-head">
          <div className="sm-tabs" role="tablist" aria-label="Trace mode">
            <button
              type="button"
              className={mode === 'live' ? 'on' : ''}
              onClick={() => setMode('live')}
            >
              LIVE
            </button>
            <button
              type="button"
              className={mode === 'review' ? 'on' : ''}
              onClick={() => setMode('review')}
            >
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

        <div className="sm-trace">
          {mode === 'live' ? <LiveScope /> : <ReviewGraphLog />}
          {showSpectrogram && (
            <div className="sm-trace-overlay">
              <KnockSpectrogramView isConnected={isConnected} embedded active={showSpectrogram} />
            </div>
          )}
          {mode === 'live' && !isConnected && (
            <div className="sm-trace-empty">Connect to the ECU to stream live traces</div>
          )}
        </div>
      </section>

      {/* ---------- right rail: fuel / air ---------- */}
      <section className="sm-right">
        <Hero
          label="AIR FUEL RATIO"
          value={fmt(afr, 1)}
          unit=":1"
          accent="var(--sm-green)"
          toneCls={afrTone}
          delta={afrDeltaLabel}
        />

        <Readout label="LAMBDA" value={fmt(lambda, 2)} unit="λ" toneCls="" />
        <Readout label="TIMING" value={fmt(timing, 1)} unit="°" toneCls="" />
        <Readout label="BOOST" value={fmt(boost, 0)} unit="kPa" toneCls={tone(boost, { hi: 220 })} />

        <Bar label="INJ DUTY" value={`${fmt(duty, 1)} %`} frac={(duty ?? 0) / 100} color="var(--sm-pink)" />
        <Readout label="FUEL PRESS" value={fmt(fuelPressure, 0)} unit="kPa" toneCls="" />
        <Readout label="EGT" value={fmt(egt, 0)} unit="°C" toneCls={tone(egt, { hi: 850, crit: 950 })} />

        <div className="sm-minis">
          <MiniGauge label="OIL T" value={fmt(oilTemp, 0)} frac={(oilTemp ?? 0) / 150} color="var(--sm-amber)" />
          <MiniGauge label="IAT" value={fmt(iat, 0)} frac={(iat ?? 0) / 60} color="var(--sm-green)" />
        </div>
      </section>

      {/* ---------- footer: status chips (only when something needs attention) ---------- */}
      {statusChips.length > 0 && (
        <footer className="sm-footer">
          {statusChips.map((c, i) => (
            <span key={`${c.label}-${i}`} className={`sm-chip sm-chip--${c.cls}`}>
              {c.label}
            </span>
          ))}
        </footer>
      )}
    </div>
  );
}
