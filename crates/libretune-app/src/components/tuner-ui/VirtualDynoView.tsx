/**
 * Virtual Dyno — estimate HP/torque from on-road acceleration pulls.
 *
 * Requires a configured, working VSS. Uses vehicle mass, drag, gearing, and
 * tire size to convert speed/RPM into a power curve.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity, AlertTriangle, Car, Gauge, Play, Square, Settings2 } from 'lucide-react';
import { useChannels } from '../../stores/realtimeStore';
import { Button, FormField } from '../common';
import './VirtualDynoView.css';

interface DynoDataPoint {
  rpm: number;
  hp: number | null;
  torque: number | null;
  afr: number | null;
  boost: number | null;
}

interface DynoRun {
  name: string;
  data: DynoDataPoint[];
  peak_hp: [number, number] | null;
  peak_torque: [number, number] | null;
  color: string;
}

interface VirtualDynoSample {
  time_secs: number;
  rpm: number;
  speed_kph: number;
  tps?: number;
  afr?: number;
  map_kpa?: number;
}

interface VirtualDynoProfile {
  weight_kg: number;
  cargo_kg: number;
  drag_coefficient: number;
  frontal_area_m2: number;
  tire_diameter_m: number;
  gear_ratio: number;
  final_drive: number;
  primary_reduction: number;
  drivetrain_loss_pct: number;
}

type VssReadiness =
  | 'not_connected'
  | 'not_configured'
  | 'no_speed_channel'
  | 'fault'
  | 'ready';

const VSS_MESSAGES: Record<VssReadiness, string> = {
  not_connected: 'Connect to the ECU to use Virtual Dyno. Live vehicle speed is required.',
  not_configured:
    'Vehicle speed sensor (VSS) is not configured in your tune. Assign a VSS input pin or CAN speed source.',
  no_speed_channel:
    'This ECU definition has no vehicle speed output channel.',
  fault:
    'Vehicle speed reads zero or invalid during the pull. Check VSS wiring and settings.',
  ready: 'VSS is configured. Ready for a pull.',
};

const GEAR_PRESETS = [
  { label: '1st', ratio: 3.5 },
  { label: '2nd', ratio: 2.1 },
  { label: '3rd', ratio: 1.4 },
  { label: '4th', ratio: 1.0 },
  { label: '5th', ratio: 0.8 },
  { label: '6th', ratio: 0.65 },
];

const PROFILE_STORAGE_KEY = 'libretune-virtual-dyno-profile';
const DISPLAY_STORAGE_KEY = 'libretune-virtual-dyno-display';

const SPEED_CHANNEL_CANDIDATES = [
  'vehicleSpeedKph',
  'speed',
  'Speed',
  'wheelSpeed',
  'vss',
  'VSS',
];

const DEFAULT_PROFILE: VirtualDynoProfile = {
  weight_kg: 1500,
  cargo_kg: 80,
  drag_coefficient: 0.30,
  frontal_area_m2: 2.2,
  tire_diameter_m: 0.65,
  gear_ratio: 1.4,
  final_drive: 3.73,
  primary_reduction: 1.0,
  drivetrain_loss_pct: 15,
};

function loadProfile(): VirtualDynoProfile {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PROFILE };
}

function loadDisplaySettings() {
  try {
    const raw = localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { useMetric: false, showAfr: false, showBoost: false, smoothing: 5 };
}

function resolveSpeedKph(channels: Record<string, number>): number {
  for (const name of SPEED_CHANNEL_CANDIDATES) {
    if (name in channels && Number.isFinite(channels[name])) {
      return channels[name];
    }
  }
  return 0;
}

export const VirtualDynoView: React.FC = () => {
  const live = useChannels(['rpm', 'tps', 'afr', 'map', 'boost', ...SPEED_CHANNEL_CANDIDATES]);
  const speedKph = useMemo(() => resolveSpeedKph(live), [live]);

  const [profile, setProfile] = useState<VirtualDynoProfile>(loadProfile);
  const [display, setDisplay] = useState(loadDisplaySettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vssStatus, setVssStatus] = useState<VssReadiness>('not_connected');
  const [recording, setRecording] = useState(false);
  const [runs, setRuns] = useState<DynoRun[]>([]);
  const [activeRun, setActiveRun] = useState<DynoRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [selectedGear, setSelectedGear] = useState(2);

  const samplesRef = useRef<VirtualDynoSample[]>([]);
  const startTimeRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const vssReady = vssStatus === 'ready';

  const refreshVssStatus = useCallback(async () => {
    try {
      const [status, constants, channelList] = await Promise.all([
        invoke<{ state: string }>('get_connection_status'),
        invoke<Record<string, number>>('get_all_constant_values'),
        invoke<Array<{ name: string }>>('get_available_channels'),
      ]);
      const isConnected = status.state === 'Connected';
      setConnected(isConnected);
      const readiness = await invoke<VssReadiness>('check_virtual_dyno_vss', {
        constants,
        outputChannels: channelList.map((c) => c.name),
        connected: isConnected,
      });
      setVssStatus(readiness);
    } catch (e) {
      console.warn('[VirtualDyno] VSS check failed:', e);
      setVssStatus('not_connected');
    }
  }, []);

  useEffect(() => {
    refreshVssStatus();
    const id = setInterval(refreshVssStatus, 5000);
    return () => clearInterval(id);
  }, [refreshVssStatus]);

  useEffect(() => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(display));
  }, [display]);

  const startPull = useCallback(() => {
    if (!vssReady || recording) return;
    setError(null);
    setWarnings([]);
    samplesRef.current = [];
    startTimeRef.current = performance.now();
    setRecording(true);
  }, [vssReady, recording]);

  const stopPull = useCallback(async () => {
    setRecording(false);
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }

    const samples = samplesRef.current;
    if (samples.length < 10) {
      setError('Pull too short — hold WOT longer in the selected gear.');
      return;
    }

    setProcessing(true);
    try {
      const result = await invoke<{
        run: DynoRun;
        gear_verified: boolean;
        warnings: string[];
      }>('compute_virtual_dyno_pull', {
        samples,
        profile,
        smoothing: display.smoothing ?? 5,
      });

      result.run.color = '#66bb6a';
      setRuns((prev) => [...prev, result.run]);
      setActiveRun(result.run);
      setWarnings(result.warnings);
      if (!result.gear_verified) {
        setWarnings((w) => [
          ...w,
          'Speed/RPM ratio does not match selected gear — verify gear and tire diameter.',
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVssStatus('fault');
    } finally {
      setProcessing(false);
    }
  }, [profile, display.smoothing]);

  // Sample recording loop
  useEffect(() => {
    if (!recording) return;

    recordIntervalRef.current = setInterval(() => {
      const rpm = live.rpm ?? 0;
      const speed = speedKph;
      const elapsed = (performance.now() - startTimeRef.current) / 1000;

      samplesRef.current.push({
        time_secs: elapsed,
        rpm,
        speed_kph: speed,
        tps: live.tps,
        afr: live.afr,
        map_kpa: live.map ?? live.boost,
      });
    }, 100);

    return () => {
      if (recordIntervalRef.current) {
        clearInterval(recordIntervalRef.current);
        recordIntervalRef.current = null;
      }
    };
  }, [recording, live, speedKph]);

  // Chart rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const run = activeRun;
    if (!canvas || !run || run.data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 36, right: 64, bottom: 44, left: 64 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    ctx.fillStyle = 'rgba(12, 14, 22, 0.98)';
    ctx.fillRect(0, 0, w, h);

    let minRpm = Infinity;
    let maxRpm = -Infinity;
    let maxHp = 0;
    let maxTq = 0;
    for (const pt of run.data) {
      minRpm = Math.min(minRpm, pt.rpm);
      maxRpm = Math.max(maxRpm, pt.rpm);
      if (pt.hp != null) maxHp = Math.max(maxHp, pt.hp);
      if (pt.torque != null) maxTq = Math.max(maxTq, pt.torque);
    }
    if (minRpm >= maxRpm) return;

    minRpm = Math.floor(minRpm / 500) * 500;
    maxRpm = Math.ceil(maxRpm / 500) * 500;
    const maxVal = Math.ceil(Math.max(maxHp, maxTq, 50) / 50) * 50;

    const xScale = (rpm: number) =>
      pad.left + ((rpm - minRpm) / (maxRpm - minRpm)) * chartW;
    const yScale = (v: number) => pad.top + chartH - (v / maxVal) * chartH;

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let rpm = minRpm; rpm <= maxRpm; rpm += 500) {
      const x = xScale(rpm);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + chartH);
      ctx.stroke();
    }

    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    for (let rpm = minRpm; rpm <= maxRpm; rpm += 1000) {
      ctx.fillText(String(rpm), xScale(rpm), pad.top + chartH + 18);
    }
    ctx.fillText('RPM', pad.left + chartW / 2, h - 8);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#4fc3f7';
    ctx.fillText('HP', pad.left - 8, pad.top + 10);
    ctx.fillStyle = '#ff7043';
    ctx.textAlign = 'left';
    ctx.fillText(display.useMetric ? 'Nm' : 'ft-lb', pad.left + chartW + 8, pad.top + 10);

    const drawLine = (
      getter: (p: DynoDataPoint) => number | null,
      color: string,
      width = 2,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      for (const pt of run.data) {
        const val = getter(pt);
        if (val == null) continue;
        const x = xScale(pt.rpm);
        const y = yScale(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    drawLine((p) => p.hp, '#4fc3f7', 2.5);
    drawLine((p) => p.torque, '#ff7043', 2);

    if (run.peak_hp) {
      const [hp, rpm] = run.peak_hp;
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath();
      ctx.arc(xScale(rpm), yScale(hp), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [activeRun, display.useMetric]);

  const applyGearPreset = (idx: number) => {
    setSelectedGear(idx);
    setProfile((p) => ({ ...p, gear_ratio: GEAR_PRESETS[idx].ratio }));
  };

  const hpUnit = display.useMetric ? 'kW' : 'HP';
  const tqUnit = display.useMetric ? 'Nm' : 'ft-lb';

  return (
    <div className="virtual-dyno">
      <div className="virtual-dyno-main">
        <div className="virtual-dyno-chart-wrap">
          {!vssReady && (
            <div className="virtual-dyno-blocked">
              <AlertTriangle size={32} />
              <h3>Virtual Dyno Unavailable</h3>
              <p>{VSS_MESSAGES[vssStatus]}</p>
              {!connected && (
                <p className="virtual-dyno-hint">
                  Use <strong>Tools → ECU Connection</strong> to connect first.
                </p>
              )}
            </div>
          )}

          {vssReady && !activeRun && !recording && (
            <div className="virtual-dyno-placeholder">
              <Gauge size={48} strokeWidth={1.5} />
              <p>Do a WOT pull in the selected gear, then stop recording.</p>
              <p className="virtual-dyno-hint">
                Takes gearing, drag, weight, and tire size into account. Uses speed/RPM to verify gear.
              </p>
            </div>
          )}

          <canvas
            ref={canvasRef}
            className="virtual-dyno-canvas"
            style={{ display: activeRun ? 'block' : 'none' }}
          />

          {recording && (
            <div className="virtual-dyno-recording-badge">
              <span className="virtual-dyno-pulse" />
              Recording pull…
            </div>
          )}
        </div>

        {error && <div className="virtual-dyno-error">{error}</div>}
        {warnings.length > 0 && (
          <div className="virtual-dyno-warnings">
            {warnings.map((w, i) => (
              <div key={i}>⚠ {w}</div>
            ))}
          </div>
        )}

        {runs.length > 0 && (
          <div className="virtual-dyno-run-list">
            {runs.map((run, i) => (
              <button
                key={i}
                type="button"
                className={activeRun === run ? 'active' : ''}
                onClick={() => setActiveRun(run)}
              >
                {run.name}
                {run.peak_hp && ` — ${run.peak_hp[0].toFixed(0)} ${hpUnit}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="virtual-dyno-sidebar">
        <div className="virtual-dyno-panel">
          <h4><Car size={14} /> Car Profile</h4>
          <FormField label="Weight (kg)">
            {(id) => (
              <input
                id={id}
                type="number"
                value={profile.weight_kg}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, weight_kg: Number(e.target.value) }))
                }
              />
            )}
          </FormField>
          <FormField label="Cargo (kg)">
            {(id) => (
              <input
                id={id}
                type="number"
                value={profile.cargo_kg}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, cargo_kg: Number(e.target.value) }))
                }
              />
            )}
          </FormField>
          <FormField label="Tire diameter (m)">
            {(id) => (
              <input
                id={id}
                type="number"
                step="0.01"
                value={profile.tire_diameter_m}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, tire_diameter_m: Number(e.target.value) }))
                }
              />
            )}
          </FormField>
          <FormField label="Final drive">
            {(id) => (
              <input
                id={id}
                type="number"
                step="0.01"
                value={profile.final_drive}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, final_drive: Number(e.target.value) }))
                }
              />
            )}
          </FormField>
        </div>

        <div className="virtual-dyno-panel">
          <h4><Activity size={14} /> Run Controls</h4>
          <div className="virtual-dyno-gears">
            {GEAR_PRESETS.map((g, i) => (
              <button
                key={g.label}
                type="button"
                className={selectedGear === i ? 'active' : ''}
                disabled={!vssReady}
                onClick={() => applyGearPreset(i)}
              >
                {g.label}
              </button>
            ))}
          </div>
          <FormField label="Gear ratio">
            {(id) => (
              <input
                id={id}
                type="number"
                step="0.01"
                value={profile.gear_ratio}
                disabled={!vssReady}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, gear_ratio: Number(e.target.value) }))
                }
              />
            )}
          </FormField>

          {!recording ? (
            <Button
              variant="primary"
              disabled={!vssReady || processing}
              onClick={startPull}
              className="virtual-dyno-pull-btn"
            >
              <Play size={16} /> Start Pull
            </Button>
          ) : (
            <Button
              variant="danger"
              onClick={stopPull}
              className="virtual-dyno-pull-btn"
            >
              <Square size={16} /> Stop Pull
            </Button>
          )}
        </div>

        <div className="virtual-dyno-panel">
          <h4>Live Readouts</h4>
          <div className="virtual-dyno-readouts">
            <div>
              <span>RPM</span>
              <strong>{(live.rpm ?? 0).toFixed(0)}</strong>
            </div>
            <div>
              <span>Speed</span>
              <strong>
                {display.useMetric
                  ? `${speedKph.toFixed(1)} kph`
                  : `${(speedKph * 0.621371).toFixed(1)} mph`}
              </strong>
            </div>
            <div>
              <span>TPS</span>
              <strong>{(live.tps ?? 0).toFixed(1)}%</strong>
            </div>
            {activeRun?.peak_hp && (
              <div>
                <span>Peak {hpUnit}</span>
                <strong>{activeRun.peak_hp[0].toFixed(1)}</strong>
              </div>
            )}
            {activeRun?.peak_torque && (
              <div>
                <span>Peak {tqUnit}</span>
                <strong>{activeRun.peak_torque[0].toFixed(1)}</strong>
              </div>
            )}
          </div>
          <div className={`virtual-dyno-vss-status ${vssReady ? 'ok' : 'bad'}`}>
            {VSS_MESSAGES[vssStatus]}
          </div>
        </div>

        <button
          type="button"
          className="virtual-dyno-settings-toggle"
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <Settings2 size={14} /> Dyno Settings
        </button>

        {settingsOpen && (
          <div className="virtual-dyno-panel virtual-dyno-settings">
            <FormField label="Drag coefficient">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  step="0.01"
                  value={profile.drag_coefficient}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      drag_coefficient: Number(e.target.value),
                    }))
                  }
                />
              )}
            </FormField>
            <FormField label="Frontal area (m²)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  step="0.1"
                  value={profile.frontal_area_m2}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      frontal_area_m2: Number(e.target.value),
                    }))
                  }
                />
              )}
            </FormField>
            <FormField label="Drivetrain loss (%)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  value={profile.drivetrain_loss_pct}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      drivetrain_loss_pct: Number(e.target.value),
                    }))
                  }
                />
              )}
            </FormField>
            <FormField label={`Smoothing (${display.smoothing})`}>
              {(id) => (
                <input
                  id={id}
                  type="range"
                  min={0}
                  max={20}
                  value={display.smoothing}
                  onChange={(e) =>
                    setDisplay((d: typeof display) => ({
                      ...d,
                      smoothing: Number(e.target.value),
                    }))
                  }
                />
              )}
            </FormField>
            <label className="virtual-dyno-check">
              <input
                type="checkbox"
                checked={display.useMetric}
                onChange={(e) =>
                  setDisplay((d: typeof display) => ({
                    ...d,
                    useMetric: e.target.checked,
                  }))
                }
              />
              Use metric units
            </label>
          </div>
        )}
      </aside>
    </div>
  );
};

export default VirtualDynoView;
