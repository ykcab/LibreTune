import { listen } from "@tauri-apps/api/event";
import { useRealtimeStore } from "../stores/realtimeStore";

// Registered once and never unregistered — prevents race conditions when React
// effects re-run during connect/disconnect cycles.
let _realtimeListenerPromise: Promise<void> | null = null;

export function ensureRealtimeListener(): Promise<void> {
  if (_realtimeListenerPromise) return _realtimeListenerPromise;
  _realtimeListenerPromise = (async () => {
    // The backend streams at 20 Hz (50 ms tick), but every subscriber — gauges,
    // columns, AutoTune, tables — re-renders on store change. Decimate to the
    // documented 100 ms history-sample cadence (CHANNEL_HISTORY_MS_PER_SAMPLE):
    // halves React render churn app-wide, keeps the graph window length correct
    // (previously 300 samples was 15 s of data, labelled 30 s), and matches the
    // 10 Hz update cadence ECUMaster-style tools use. Latest payload wins; the
    // interval picks up whatever arrived since the last flush.
    let latestPayload: Record<string, number> | null = null;
    const FLUSH_MS = 100;
    window.setInterval(() => {
      const payload = latestPayload;
      latestPayload = null;
      if (payload) useRealtimeStore.getState().updateChannels(payload);
    }, FLUSH_MS);

    await listen("realtime:update", (event) => {
      latestPayload = event.payload as Record<string, number>;
    });
    await listen("realtime:error", (event) => {
      console.error("Realtime error:", event.payload);
    });
  })();
  return _realtimeListenerPromise;
}
