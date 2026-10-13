/**
 * Startup dashboard — data hooks.
 *
 * Three jobs, kept out of the presentational components:
 *  1. feed the `TelemetrySession` accumulator straight from the realtime store
 *     (one push per stream frame, no React re-render per frame);
 *  2. poll the low-rate device/project/logging state the status strip shows;
 *  3. expose a unit-aware formatter so every number on the face honours the
 *     user's unit preferences.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRealtimeStore } from '../../../stores/realtimeStore';
import { useUnitPreferences } from '../../../contexts/useUnitPreferences';
import { STOICH_AFR } from '../../../utils/unitConversions';
import type { ConnectionStatus, CurrentProject } from '../../../types/app';
import { formatNumber } from './channels';
import { TelemetrySession, type SessionSnapshot } from './session';
import type { ChannelMeta, DashIdentity, LoggingState } from './types';

/** How often the derived analytics snapshot is published to React. */
const SNAPSHOT_INTERVAL_MS = 250;

export interface StartupTelemetry {
  session: TelemetrySession;
  snapshot: SessionSnapshot;
  /** All channel names the ECU publishes (INI list ∪ everything seen live). */
  available: Set<string>;
}

/**
 * Single subscription point for the whole dashboard.
 *
 * The session accumulates on the store's `lastUpdateTime` (which ticks even when
 * no value changed, so link health stays measurable at standstill) while the
 * derived snapshot is republished at a fixed low rate. The rails read their own
 * channels directly from the store, so a 10 Hz stream never re-renders them
 * through this hook.
 */
export function useStartupTelemetry(isConnected: boolean, channelMeta: ChannelMeta[]): StartupTelemetry {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => new TelemetrySession().snapshot(Date.now()));
  const stoich = useStoich();
  // The accumulator outlives preference changes but must always convert with the
  // fuel type the user has selected right now.
  const stoichRef = useRef(stoich);
  stoichRef.current = stoich;
  const sessionRef = useRef<TelemetrySession | null>(null);
  if (sessionRef.current === null) sessionRef.current = new TelemetrySession(() => stoichRef.current);
  const session = sessionRef.current;

  const publish = useCallback(() => setSnapshot(session.snapshot(Date.now())), [session]);

  // INI channel list → streaming keys (canonical aliases included). Publishing
  // straight away means the rails and the scope light up with the INI's channels
  // on the first frame instead of after the first throttled snapshot.
  useEffect(() => {
    session.syncChannels(channelMeta.map((c) => c.name));
    publish();
  }, [session, channelMeta, publish]);

  useEffect(() => {
    const store = useRealtimeStore.getState();
    // Seed with whatever the store already holds (e.g. after a tab switch).
    if (Object.keys(store.channels).length > 0) session.push(store.channels, Date.now());

    const unsubscribe = useRealtimeStore.subscribe(
      (state) => state.lastUpdateTime,
      () => {
        const before = session.resolvedCount;
        session.push(useRealtimeStore.getState().channels, Date.now());
        // A newly resolved channel changes which tiles exist — republish at once.
        if (session.resolvedCount !== before) publish();
      },
    );
    const timer = window.setInterval(publish, SNAPSHOT_INTERVAL_MS);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [session, publish]);

  // A new connection starts a new session: coverage, extremes and events are
  // per-run by definition.
  const wasConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnected.current) {
      session.reset();
      publish();
    }
    wasConnected.current = isConnected;
  }, [isConnected, session, publish]);

  const available = useMemo(() => {
    const names = new Set<string>();
    for (const meta of channelMeta) names.add(meta.name);
    for (const id of snapshot.present) {
      const key = session.keyFor(id);
      if (key) names.add(key);
    }
    for (const key of Object.keys(snapshot.values)) names.add(key);
    // Every channel the ECU has ever published, so reference channels that are
    // not part of the catalogue (rev limit, boost target) resolve too.
    for (const key of Object.keys(useRealtimeStore.getState().channels)) names.add(key);
    return names;
  }, [channelMeta, snapshot, session]);

  return { session, snapshot, available };
}

/* ------------------------------------------------------------------ status */

function emptyIdentity(): DashIdentity {
  return {
    project: '',
    signature: null,
    iniName: null,
    connectionState: 'Disconnected',
    port: null,
    baud: null,
    tuneModified: false,
    hasTune: false,
  };
}

function emptyLogging(): LoggingState {
  return { isRecording: false, durationMs: 0, channelCount: 0, entryCount: 0, streamPath: null };
}

export interface DashStatus {
  identity: DashIdentity;
  logging: LoggingState;
  seenProject: boolean;
  toggleLogging: () => Promise<void>;
  logBusy: boolean;
  logError: string | null;
}

/**
 * Device + project identity and the logging transport.
 *
 * Polling (not events) because these change on human timescales and the poll is
 * a single cheap command read. Every call failure is swallowed: the dashboard
 * must stay usable with no backend at all (tests, offline review).
 */
export function useDashStatus(isConnected: boolean): DashStatus {
  const [identity, setIdentity] = useState<DashIdentity>(emptyIdentity);
  const [logging, setLogging] = useState<LoggingState>(emptyLogging);
  const [seenProject, setSeenProject] = useState(false);
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const readIdentity = async () => {
      let connection: ConnectionStatus | null = null;
      let project: CurrentProject | null = null;
      try {
        connection = await invoke<ConnectionStatus>('get_connection_status');
      } catch { /* offline */ }
      try {
        project = await invoke<CurrentProject>('get_current_project');
      } catch { /* no project open */ }
      if (cancelled) return;
      if (project) setSeenProject(true);
      setIdentity((prev) => ({
        project: project?.name ?? prev.project,
        signature: connection?.signature ?? project?.signature ?? null,
        iniName: connection?.ini_name ?? null,
        connectionState: connection?.state ?? (isConnected ? 'Connected' : 'Disconnected'),
        port: project?.connection?.port ?? null,
        baud: project?.connection?.baud_rate ?? null,
        tuneModified: project?.tune_modified ?? false,
        hasTune: project?.has_tune ?? false,
      }));
    };

    const readLogging = async () => {
      try {
        const status = await invoke<{
          is_recording: boolean;
          duration_ms: number;
          channel_count: number;
          entry_count: number;
          stream_path: string | null;
        }>('get_logging_status');
        if (cancelled) return;
        setLogging({
          isRecording: status.is_recording,
          durationMs: status.duration_ms,
          channelCount: status.channel_count,
          entryCount: status.entry_count,
          streamPath: status.stream_path,
        });
      } catch { /* offline */ }
    };

    void readIdentity();
    void readLogging();
    const identityTimer = window.setInterval(() => void readIdentity(), 3000);
    const loggingTimer = window.setInterval(() => void readLogging(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(identityTimer);
      window.clearInterval(loggingTimer);
    };
  }, [isConnected]);

  const toggleLogging = useCallback(async () => {
    setLogBusy(true);
    setLogError(null);
    try {
      if (logging.isRecording) {
        await invoke('stop_logging');
      } else {
        await invoke('start_logging', { sampleRate: null, channels: null });
      }
      const status = await invoke<{ is_recording: boolean; duration_ms: number; channel_count: number; entry_count: number; stream_path: string | null }>('get_logging_status');
      setLogging({
        isRecording: status.is_recording,
        durationMs: status.duration_ms,
        channelCount: status.channel_count,
        entryCount: status.entry_count,
        streamPath: status.stream_path,
      });
    } catch (e) {
      setLogError(String(e));
    } finally {
      setLogBusy(false);
    }
  }, [logging.isRecording]);

  return { identity, logging, seenProject, toggleLogging, logBusy, logError };
}

/* --------------------------------------------------------------- formatting */

export interface FormattedValue {
  text: string;
  unit: string;
  /** Converted value, or undefined when the channel has no reading. */
  value: number | undefined;
}

/** Linear display conversion for one source unit: display = raw × scale + offset. */
export interface UnitDisplay {
  scale: number;
  offset: number;
  /** Display unit label (e.g. 'PSI'). */
  unit: string;
}

export interface ValueFormatter {
  /** Format a reading given its source unit + precision ('' unit passes through). */
  format: (unit: string, digits: number, value: number | undefined) => FormattedValue;
  /** Format a threshold boundary — same conversion, so tick labels always match. */
  boundary: (unit: string, digits: number, value: number) => FormattedValue;
  /** Raw conversion, for canvas rendering (traces, ranges). */
  display: (unit: string) => UnitDisplay;
}

/**
 * Unit-aware conversion, driven entirely by the app's unit-preference layer.
 *
 * Returns a linear `display = raw × scale + offset` per source unit so that both
 * the DOM tiles *and* the canvas scope render in the user's units: when a US
 * user picks °F/PSI, the traces are drawn in °F/PSI too, with converted range
 * labels — no mixed-unit screen. Requires the app-level
 * `UnitPreferencesProvider` (mounted in `main.tsx`).
 */
export function useUnitDisplay(): (unit: string) => UnitDisplay {
  const { preferences } = useUnitPreferences();
  const stoich = STOICH_AFR[preferences.fuelType];

  return useMemo(() => {
    const temperature: UnitDisplay =
      preferences.temperature === 'F'
        ? { scale: 9 / 5, offset: 32, unit: '°F' }
        : preferences.temperature === 'K'
          ? { scale: 1, offset: 273.15, unit: 'K' }
          : { scale: 1, offset: 0, unit: '°C' };

    const pressure: UnitDisplay =
      preferences.pressure === 'PSI'
        ? { scale: 1 / 6.89476, offset: 0, unit: 'PSI' }
        : preferences.pressure === 'bar'
          ? { scale: 1 / 100, offset: 0, unit: 'bar' }
          : preferences.pressure === 'inHg'
            ? { scale: 1 / 3.38639, offset: 0, unit: 'inHg' }
            : { scale: 1, offset: 0, unit: 'kPa' };

    const speed: UnitDisplay = preferences.speed === 'mph'
      ? { scale: 0.621371, offset: 0, unit: 'mph' }
      : { scale: 1, offset: 0, unit: 'km/h' };

    // AFR ↔ λ both directions, using the configured stoichiometric ratio.
    const afr: UnitDisplay = preferences.afr === 'Lambda'
      ? { scale: 1 / stoich, offset: 0, unit: 'λ' }
      : { scale: 1, offset: 0, unit: 'AFR' };
    const lambda: UnitDisplay = preferences.afr === 'AFR'
      ? { scale: stoich, offset: 0, unit: 'AFR' }
      : { scale: 1, offset: 0, unit: 'λ' };

    return (unit: string): UnitDisplay => {
      switch (unit) {
        case '°C':
        case 'C':
          return temperature;
        case 'kPa':
          return pressure;
        case 'km/h':
          return speed;
        case 'AFR':
          return afr;
        case 'λ':
        case 'Lambda':
          return lambda;
        default:
          return { scale: 1, offset: 0, unit };
      }
    };
  }, [preferences.temperature, preferences.pressure, preferences.speed, preferences.afr, stoich]);
}

/**
 * Precision after conversion: PSI needs a decimal where kPa did not, °F keeps the
 * integer precision of °C, bar needs more digits than kPa.
 */
export function displayDigits(sourceUnit: string, displayUnit: string, digits: number): number {
  if (sourceUnit === 'kPa' && displayUnit === 'PSI') return Math.max(digits, 1);
  if (sourceUnit === 'kPa' && displayUnit === 'inHg') return Math.max(digits, 1);
  if (sourceUnit === 'kPa' && displayUnit === 'bar') return Math.max(digits, 3);
  return digits;
}

export function useValueFormatter(): ValueFormatter {
  const display = useUnitDisplay();

  return useMemo<ValueFormatter>(() => {
    const convert = (unit: string, value: number, digits: number): FormattedValue => {
      if (!unit) return { text: formatNumber(value, digits), unit: '', value };
      const spec = display(unit);
      const converted = value * spec.scale + spec.offset;
      return {
        text: formatNumber(converted, displayDigits(unit, spec.unit, digits)),
        unit: spec.unit,
        value: converted,
      };
    };

    return {
      format: (unit, digits, value) => {
        if (value === undefined || !Number.isFinite(value)) {
          return { text: '—', unit: display(unit).unit, value: undefined };
        }
        return convert(unit, value, digits);
      },
      boundary: (unit, digits, value) => convert(unit, value, digits),
      display,
    };
  }, [display]);
}

/** Stoichiometric ratio for the currently selected fuel type. */
export function useStoich(): number {
  const { preferences } = useUnitPreferences();
  return STOICH_AFR[preferences.fuelType];
}
