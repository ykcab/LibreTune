import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  WMI_ACTION_SECONDS,
  WMI_CONSTANT_NAMES,
  type WmiAction,
} from './wmiConstants';

export interface WmiConfigState {
  values: Record<string, number>;
  missing: Set<string>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  commit: (name: string, value: number) => Promise<void>;
}

/** Load and edit the tune constants the native WMI view owns. */
export function useWmiConfig(): WmiConfigState {
  const [values, setValues] = useState<Record<string, number>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entries = await Promise.all(
        WMI_CONSTANT_NAMES.map(async (name) => {
          try {
            const value = await invoke<number>('get_constant_value', { name });
            return { name, value };
          } catch {
            return { name, value: undefined };
          }
        }),
      );

      const nextValues: Record<string, number> = {};
      const nextMissing = new Set<string>();
      for (const entry of entries) {
        if (entry.value === undefined) {
          nextMissing.add(entry.name);
        } else {
          nextValues[entry.name] = entry.value;
        }
      }
      setValues(nextValues);
      setMissing(nextMissing);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const commit = useCallback(async (name: string, value: number) => {
    await invoke('update_constant', { name, value });
    setValues((prev) => ({ ...prev, [name]: value }));
    setMissing((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  return { values, missing, loading, error, refresh, commit };
}

export interface WmiTargetBand {
  min: number;
  max: number;
}

export const DEFAULT_WMI_TARGET_BAND: WmiTargetBand = { min: 0.10, max: 0.25 };

export interface WmiTargetBandState {
  band: WmiTargetBand;
  loading: boolean;
  error: string | null;
  save: (min: number, max: number) => Promise<void>;
}

/**
 * The W/F target band is a LibreTune project setting, not an ECU constant.
 * It lives in project.json so it travels with the calibration project.
 */
export function useWmiTargetBand(): WmiTargetBandState {
  const [band, setBand] = useState<WmiTargetBand>(DEFAULT_WMI_TARGET_BAND);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<WmiTargetBand>('get_wmi_wf_target')
      .then((value) => {
        if (!cancelled) {
          setBand(value);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (min: number, max: number) => {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error('W/F target band must be finite.');
    }
    if (min < 0 || max <= min || max > 10) {
      throw new Error('W/F target band must satisfy 0 ≤ min < max ≤ 10.');
    }
    await invoke('update_wmi_wf_target', { min, max });
    setBand({ min, max });
    setError(null);
  }, []);

  return { band, loading, error, save };
}

export interface WmiRun {
  action: WmiAction;
  startedAt: number;
  durationSec: number;
}

export interface WmiRunState {
  run: WmiRun | null;
  lastCompleted: WmiRun | null;
  remaining: number;
  start: (action: WmiAction) => void;
  clear: () => void;
}

/**
 * Local run tracker for bench/prime/calibration commands.
 *
 * The ECU is still the authority: this only drives the countdown and keeps the
 * UI from firing a second command while the pump is running.
 */
export function useWmiRun(): WmiRunState {
  const [run, setRun] = useState<WmiRun | null>(null);
  const [lastCompleted, setLastCompleted] = useState<WmiRun | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!run) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [run]);

  useEffect(() => {
    if (!run) return;
    const elapsed = (now - run.startedAt) / 1000;
    if (elapsed >= run.durationSec) {
      setLastCompleted(run);
      setRun(null);
    }
  }, [now, run]);

  const start = useCallback((action: WmiAction) => {
    const startedAt = Date.now();
    setNow(startedAt);
    setLastCompleted(null);
    setRun({ action, startedAt, durationSec: WMI_ACTION_SECONDS[action] });
  }, []);

  const clear = useCallback(() => setRun(null), []);

  const remaining = run
    ? Math.max(0, run.durationSec - (now - run.startedAt) / 1000)
    : 0;

  return { run, lastCompleted, remaining, start, clear };
}
