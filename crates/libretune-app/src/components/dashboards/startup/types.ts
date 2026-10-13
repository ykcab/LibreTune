/**
 * Shared types for the Startup dashboard.
 *
 * Kept separate from `channels.ts` / `session.ts` so the catalogue, the
 * accumulator and the presentational components can all depend on them without
 * creating an import cycle.
 */

/** Visual/semantic severity used by bands, tiles, chips and events. */
export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'dim';

/** Event severities (a subset of Tone — a colour is not a severity). */
export type Severity = 'warn' | 'crit' | 'info';

/** What kind of thing an event describes — drives its title and icon shape. */
export type EventKind = 'limit' | 'fueling' | 'dropout' | 'sync' | 'boost';

/** Minimal channel metadata passed down from the dashboard host. */
export interface ChannelMeta {
  name: string;
  label?: string | null;
  units?: string | null;
}

/** Connection + project identity shown in the status strip. */
export interface DashIdentity {
  project: string;
  signature: string | null;
  iniName: string | null;
  connectionState: 'Connected' | 'Connecting' | 'Disconnected' | 'Error';
  port: string | null;
  baud: number | null;
  tuneModified: boolean;
  hasTune: boolean;
}

/** Logging session state (mirrors `LoggingStatus` from the Rust command). */
export interface LoggingState {
  isRecording: boolean;
  durationMs: number;
  channelCount: number;
  entryCount: number;
  streamPath: string | null;
}
