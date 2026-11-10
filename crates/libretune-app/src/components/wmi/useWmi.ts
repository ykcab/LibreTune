import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  WMI_ACTION_SECONDS,
  WMI_CONSTANT_NAMES,
  type WmiAction,
} from './wmiConstants';
import type { Constant } from '../dialogs/types';

export interface WmiConfigState {
  values: Record<string, number>;
  missing: Set<string>;
  /** INI metadata for every constant, fetched once during refresh. */
  meta: Record<string, Constant>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  commit: (name: string, value: number) => Promise<void>;
}

/** Load and edit the tune constants the native WMI view owns. */
export function useWmiConfig(): WmiConfigState {
  const [values, setValues] = useState<Record<string, number>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<Record<string, Constant>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch value + metadata together so WmiField doesn't issue its own
      // get_constant request per field (N round-trips for N fields).
      const entries = await Promise.all(
        WMI_CONSTANT_NAMES.map(async (name) => {
          try {
            const [value, constant] = await Promise.all([
              invoke<number>('get_constant_value', { name }),
              invoke<Constant>('get_constant', { name }),
            ]);
            return { name, value, constant };
          } catch {
            return { name, value: undefined, constant: undefined };
          }
        }),
      );

      const nextValues: Record<string, number> = {};
      const nextMissing = new Set<string>();
      const nextMeta: Record<string, Constant> = {};
      for (const entry of entries) {
        if (entry.value === undefined) {
          nextMissing.add(entry.name);
        } else {
          nextValues[entry.name] = entry.value;
          if (entry.constant) nextMeta[entry.name] = entry.constant;
        }
      }
      setValues(nextValues);
      setMissing(nextMissing);
      setMeta(nextMeta);
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

  return { values, missing, meta, loading, error, refresh, commit };
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
// Module-level run state so a tab switch (which unmounts WmiView) doesn't
// lose an in-flight pump run. The ECU is still the authority; this only keeps
// the countdown alive across remounts.
let _persistentRun: WmiRun | null = null;
let _persistentLastCompleted: WmiRun | null = null;

export function useWmiRun(): WmiRunState {
  const [run, setRun] = useState<WmiRun | null>(_persistentRun);
  const [lastCompleted, setLastCompleted] = useState<WmiRun | null>(_persistentLastCompleted);
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
      _persistentLastCompleted = run;
      _persistentRun = null;
      setLastCompleted(run);
      setRun(null);
    }
  }, [now, run]);

  const start = useCallback((action: WmiAction) => {
    const startedAt = Date.now();
    setNow(startedAt);
    setLastCompleted(null);
    _persistentLastCompleted = null;
    const newRun = { action, startedAt, durationSec: WMI_ACTION_SECONDS[action] };
    _persistentRun = newRun;
    setRun(newRun);
  }, []);

  const clear = useCallback(() => {
    _persistentRun = null;
    setRun(null);
  }, []);

  // Sync state changes back to the module-level store so a remount picks them up.
  useEffect(() => { _persistentRun = run; }, [run]);
  useEffect(() => { _persistentLastCompleted = lastCompleted; }, [lastCompleted]);

  const remaining = run
    ? Math.max(0, run.durationSec - (now - run.startedAt) / 1000)
    : 0;

  return { run, lastCompleted, remaining, start, clear };
}
