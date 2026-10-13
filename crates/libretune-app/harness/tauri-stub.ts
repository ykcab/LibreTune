/**
 * Screenshot harness — Tauri command stub.
 *
 * Aliased over `@tauri-apps/api/core` by `vite.config.ts` so the real
 * `StartupDash` component can be rendered (and screenshotted) outside the Tauri
 * shell with representative device/project/logging state.
 */
const offline = new URLSearchParams(window.location.search).get('state') === 'offline';

const project = {
  name: 'MX-5 BP Turbo',
  path: 'C:/Users/dev/Documents/LibreTuneProjects/MX-5 BP Turbo',
  signature: 'speeduino 202501',
  has_tune: true,
  tune_modified: true,
  connection: { port: 'COM4', baud_rate: 115200, auto_connect: true },
};

const responses: Record<string, (args?: Record<string, unknown>) => unknown> = {
  get_connection_status: () => ({
    state: offline ? 'Disconnected' : 'Connected',
    signature: offline ? null : 'speeduino 202501',
    has_definition: !offline,
    ini_name: offline ? null : 'speeduino_202501_na6.ini',
  }),
  get_current_project: () => project,
  // Virtual dynamometer: reimplemented in miniature for the harness only, so the
  // performance panel has numbers to render. The shipped app calls the real Rust
  // implementation of this model.
  compute_virtual_dyno_pull: (args?: Record<string, unknown>) => {
    const samples = (args?.samples ?? []) as {
      time_secs: number;
      rpm: number;
      speed_kph: number;
      map_kpa?: number;
    }[];
    const points = samples
      .filter((s) => s.rpm > 1500 && s.speed_kph > 0)
      .map((s) => {
        const load = Math.min(1, (s.map_kpa ?? 100) / 200);
        const hp = (s.rpm / 7000) * 190 * load;
        const torque = s.rpm > 0 ? (hp * 5252) / s.rpm : 0;
        return { rpm: s.rpm, hp, torque, afr: 12.6, boost: null, time: s.time_secs };
      });
    if (points.length < 5) throw new Error('Not enough acceleration data in this pull.');
    const peakHp = points.reduce((best, p) => (p.hp > best.hp ? p : best), points[0]);
    const peakTorque = points.reduce((best, p) => (p.torque > best.torque ? p : best), points[0]);
    return {
      run: {
        name: 'Harness pull',
        data: points,
        peak_hp: [peakHp.hp, peakHp.rpm],
        peak_torque: [peakTorque.torque, peakTorque.rpm],
        color: '#66bb6a',
        source_file: null,
      },
      gear_verified: true,
      warnings: [],
    };
  },
  get_logging_status: () => ({    is_recording: !offline,
    duration_ms: 132_000,
    channel_count: 28,
    entry_count: offline ? 0 : 1_320,
    channels: offline ? [] : LOGGED_CHANNELS,
    stream_path: offline
      ? null
      : 'C:/Users/dev/Documents/LibreTuneProjects/MX-5 BP Turbo/datalogs/2026-10-13_18.42.11.ltlog',
  }),
  // A recorded session for the Review view — the same shape the Rust logger
  // returns, generated deterministically so the replay chart has content.
  get_log_entries: () => {
    const out: { timestamp_ms: number; values: Record<string, number> }[] = [];
    for (let i = 0; i < 600; i++) {
      const cycle = (i / 60) % 14;
      const pull = cycle >= 2 && cycle < 9.5 ? Math.sin(Math.min(1, (cycle - 2) / 7.5) * Math.PI * 0.5) : 0;
      const rpm = 1200 + 4900 * pull;
      const map = 40 + 170 * pull;
      const target = map > 100 ? 0.85 : 1.0;
      out.push({
        timestamp_ms: 1_700_000_000_000 + i * 100,
        values: {
          rpm,
          map,
          tps: 10 + 88 * pull,
          lambda: target + 0.01 + Math.sin(i / 9) * 0.006,
          targetLambda: target,
          afrTarget: target * 14.7,
          advance: 10 + 18 * pull,
          dutyCycle: 8 + 70 * pull,
          pulseWidth: 1.5 + 10 * pull,
          coolant: 88 + cycle * 0.2,
          iat: 32 + 10 * pull,
          battery: 14.1,
        },
      });
    }
    return out;
  },
};

const LOGGED_CHANNELS = [
  'rpm', 'map', 'tps', 'lambda', 'targetLambda', 'afrTarget',
  'advance', 'dutyCycle', 'pulseWidth', 'coolant', 'iat', 'battery',
];

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const handler = responses[command];
  if (!handler) throw new Error(`[harness] unmocked command: ${command}`);
  return handler(args) as T;
}

export default { invoke };
