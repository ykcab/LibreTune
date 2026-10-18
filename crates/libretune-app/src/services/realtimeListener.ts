import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useRealtimeStore } from "../stores/realtimeStore";

// Registered once and never unregistered — prevents race conditions when React
// effects re-run during connect/disconnect cycles.
let _realtimeListenerPromise: Promise<void> | null = null;

/**
 * Pull the tune's constants into the store.
 *
 * The stream also pushes them on `realtime:config`, but that event only fires
 * when the backend's copy actually changes — so a window that opens later (a
 * pop-out dashboard) or a session that never starts the stream would miss it.
 * Asking on mount makes a channel-named-constant resolve in every window, at
 * any time, regardless of stream state.
 */
export function fetchRealtimeConfig(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return Promise.resolve();
  return invoke<Record<string, number>>("get_realtime_config")
    .then((config) => {
      if (config && Object.keys(config).length > 0) {
        useRealtimeStore.getState().applyConfig(config);
      }
    })
    .catch((e) => {
      // Not fatal: gauges fall back to the stream's own config event.
      console.warn("Realtime config unavailable:", e);
    });
}

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

    await listen<Record<string, number>>("realtime:update", (event) => {
      latestPayload = event.payload as Record<string, number>;
    });
    // Tune constants travel on their own event — they only move when the user
    // edits the tune, so they must not ride the 20 Hz payload.
    await listen<Record<string, number>>("realtime:config", (event) => {
      useRealtimeStore.getState().applyConfig(event.payload as Record<string, number>);
    });
    await listen<string>("realtime:error", (event) => {
      console.error("Realtime error:", event.payload);
    });

    // Covers the window that attaches after the stream's config event, and the
    // session that never starts a stream at all.
    await fetchRealtimeConfig();
  })();
  return _realtimeListenerPromise;
}
