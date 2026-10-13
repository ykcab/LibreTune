/**
 * Startup dashboard — live performance estimate.
 *
 * This does **not** implement any physics of its own: it feeds the live stream to
 * the same Rust virtual dynamometer the Virtual Dyno tab uses
 * (`compute_virtual_dyno` — F = m·a + aero drag + rolling resistance, converted
 * through the drivetrain loss, torque from P/ω), with the same stored vehicle
 * profile. That way the two surfaces cannot disagree, and the model's
 * assumptions stay in one place.
 *
 * What it adds is *presentation for a dashboard*: a rolling window of samples,
 * a low-cadence recompute, and honest states — no speed channel, no pull yet,
 * gear mismatch, VSS fault — instead of a number that pretends to be measured.
 */
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRealtimeStore } from '../../../stores/realtimeStore';

/** Same storage keys the Virtual Dyno tab uses, so both read one profile. */
const PROFILE_STORAGE_KEY = 'libretune-virtual-dyno-profile';
const DISPLAY_STORAGE_KEY = 'libretune-virtual-dyno-display';

/** Rolling window of live samples (seconds). */
const WINDOW_SECONDS = 60;
/** How often to re-run the estimate while data is flowing. */
const RECOMPUTE_MS = 3000;
/** Minimum samples before the model has anything to chew on. */
const MIN_SAMPLES = 25;
/** Minimum samples of positive acceleration the model needs. */
const MIN_ACCEL_SAMPLES = 8;

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

interface DynoDataPoint {
  rpm: number;
  hp?: number | null;
  torque?: number | null;
}

interface DynoRun {
  data: DynoDataPoint[];
  peak_hp: [number, number] | null;
  peak_torque: [number, number] | null;
}

export interface DynoEstimate {
  /** 'estimate' when a curve could be computed; otherwise why not. */
  status: 'idle' | 'running' | 'estimate' | 'unavailable' | 'insufficient';
  /** Human-readable reason for a non-estimating state. */
  reason: string | null;
  /** Non-fatal model warnings (gear mismatch, …). */
  warnings: string[];
  /** Peak power/torque with the rpm they occurred at. */
  peakPower?: { hp: number; rpm: number };
  peakTorque?: { lbft: number; rpm: number };
  /** The curve point nearest the engine's current speed. */
  current?: { hp: number; lbft: number; rpm: number };
  /** Vehicle assumptions actually used, for the panel's footnote. */
  profile?: VirtualDynoProfile;
  samples: number;
}

const IDLE: DynoEstimate = { status: 'idle', reason: null, warnings: [], samples: 0 };

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  not_connected: 'Connect to the ECU to estimate power from acceleration.',
  not_configured: 'No vehicle-speed sensor configured in this tune.',
  no_speed_channel: 'This definition publishes no vehicle-speed channel.',
  fault: 'Vehicle speed reads zero while rpm rises — check VSS wiring and settings.',
};

function loadProfile(): VirtualDynoProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VirtualDynoProfile>;
    if (typeof parsed?.weight_kg !== 'number') return null;
    return parsed as VirtualDynoProfile;
  } catch {
    return null;
  }
}

function loadSmoothing(): number {
  try {
    const raw = window.localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (!raw) return 5;
    const parsed = JSON.parse(raw) as { smoothing?: number };
    return typeof parsed?.smoothing === 'number' ? parsed.smoothing : 5;
  } catch {
    return 5;
  }
}

/**
 * Record live samples and periodically ask the backend for an estimate.
 *
 * `enabled` should be false while the dash is disconnected; the hook then reports
 * `idle` without doing any work.
 */
export function useDynoEstimate(enabled: boolean, hasSpeedChannel: boolean): DynoEstimate {
  const [estimate, setEstimate] = useState<DynoEstimate>(IDLE);
  const samplesRef = useRef<VirtualDynoSample[]>([]);
  const startRef = useRef<number>(0);
  const busyRef = useRef(false);

  // Sampling: one sample per stream tick, capped to the window.
  useEffect(() => {
    if (!enabled) {
      samplesRef.current = [];
      setEstimate(IDLE);
      return;
    }
    if (!hasSpeedChannel) {
      setEstimate({
        status: 'unavailable',
        reason: UNAVAILABLE_MESSAGES.no_speed_channel,
        warnings: [],
        samples: 0,
      });
      return;
    }

    const sample = () => {
      const channels = useRealtimeStore.getState().channels;
      const rpm = channels.rpm ?? channels.RPMValue ?? channels.RPM;
      if (rpm === undefined || !Number.isFinite(rpm)) return;
      const speed = channels.speed ?? channels.vehicleSpeedKph ?? channels.wheelSpeed;
      if (speed === undefined || !Number.isFinite(speed)) return;
      const now = Date.now();
      if (startRef.current === 0) startRef.current = now;
      const buffer = samplesRef.current;
      buffer.push({
        time_secs: (now - startRef.current) / 1000,
        rpm,
        speed_kph: speed,
        tps: channels.tps ?? channels.TPSValue,
        afr: channels.afr ?? (channels.lambda !== undefined ? channels.lambda * 14.7 : undefined),
        map_kpa: channels.map ?? channels.MAPValue,
      });
      const cutoff = buffer.length > 0 ? buffer[buffer.length - 1].time_secs - WINDOW_SECONDS : 0;
      while (buffer.length > 0 && buffer[0].time_secs < cutoff) buffer.shift();
    };

    const unsubscribe = useRealtimeStore.subscribe((state) => state.lastUpdateTime, sample);
    return () => unsubscribe();
  }, [enabled, hasSpeedChannel]);

  // Estimation: low cadence, and never more than one request in flight.
  useEffect(() => {
    if (!enabled || !hasSpeedChannel) return;

    const compute = async () => {
      if (busyRef.current) return;
      const samples = samplesRef.current.slice();
      const accelerated = samples.filter((s, i) =>
        i > 0 && s.rpm > 1500 && s.speed_kph > samples[i - 1].speed_kph,
      ).length;
      if (samples.length < MIN_SAMPLES) {
        setEstimate((prev) =>
          prev.status === 'estimate'
            ? prev
            : {
                status: 'insufficient',
                reason: `Collecting data — ${samples.length}/${MIN_SAMPLES} samples in the last ${WINDOW_SECONDS} s.`,
                warnings: [],
                samples: samples.length,
              },
        );
        return;
      }
      if (accelerated < MIN_ACCEL_SAMPLES) {
        setEstimate((prev) =>
          prev.status === 'estimate'
            ? prev
            : {
                status: 'insufficient',
                reason:
                  'Needs a wide-open-throttle pull in one gear — no sustained acceleration in the window yet.',
                warnings: [],
                samples: samples.length,
              },
        );
        return;
      }

      const profile = loadProfile();
      if (!profile) {
        setEstimate((prev) => ({
          ...prev,
          status: 'unavailable',
          reason:
            'Set the vehicle profile in Tools → Virtual Dyno (weight, drag, gearing) so power can be estimated.',
          samples: samples.length,
        }));
        return;
      }

      busyRef.current = true;
      setEstimate((prev) => (prev.status === 'estimate' ? prev : { ...prev, status: 'running' }));
      try {
        // Normalise the rolling window so the model always starts at t = 0.
        const base = samples[0].time_secs;
        const result = await invoke<{ run: DynoRun; gear_verified: boolean; warnings: string[] }>(
          'compute_virtual_dyno_pull',
          {
            samples: samples.map((s) => ({ ...s, time_secs: s.time_secs - base })),
            profile,
            smoothing: loadSmoothing(),
          },
        );
        const run = result.run;
        const rpmNow = samples[samples.length - 1].rpm;
        const currentPoint = run.data.reduce<DynoDataPoint | null>((best, point) => {
          if (!best) return point;
          return Math.abs(point.rpm - rpmNow) < Math.abs(best.rpm - rpmNow) ? point : best;
        }, null);
        setEstimate({
          status: 'estimate',
          reason: null,
          warnings: result.warnings,
          peakPower: run.peak_hp ? { hp: run.peak_hp[0], rpm: run.peak_hp[1] } : undefined,
          peakTorque: run.peak_torque ? { lbft: run.peak_torque[0], rpm: run.peak_torque[1] } : undefined,
          current:
            currentPoint && currentPoint.hp != null && currentPoint.torque != null
              ? { hp: currentPoint.hp, lbft: currentPoint.torque, rpm: currentPoint.rpm }
              : undefined,
          profile,
          samples: samples.length,
        });
      } catch (error) {
        setEstimate((prev) => ({
          ...prev,
          status: 'insufficient',
          reason: String(error),
          samples: samples.length,
        }));
      } finally {
        busyRef.current = false;
      }
    };

    void compute();
    const timer = window.setInterval(() => void compute(), RECOMPUTE_MS);
    return () => window.clearInterval(timer);
  }, [enabled, hasSpeedChannel]);

  return estimate;
}
