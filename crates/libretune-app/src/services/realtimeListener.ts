import { listen } from "@tauri-apps/api/event";
import { useRealtimeStore } from "../stores/realtimeStore";

// ─── Module-level realtime event listener ───────────────────────────────────
// Registered once and never unregistered. This prevents the race condition
// where React 18 StrictMode's mount→cleanup→mount cycle (or any effect re-run)
// unregisters the listener and drops events. The backend's start_realtime_stream
// always replaces any existing task, so concurrent start calls are harmless.
let _realtimeListenerPromise: Promise<void> | null = null;

export function ensureRealtimeListener(): Promise<void> {
  if (_realtimeListenerPromise) return _realtimeListenerPromise;
  _realtimeListenerPromise = (async () => {
    let eventCount = 0;
    await listen("realtime:update", (event) => {
      eventCount++;
      if (eventCount <= 5 || eventCount % 100 === 0) {
        console.log(`[realtime] event #${eventCount}, keys=${Object.keys(event.payload as object).length}`);
      }
      useRealtimeStore.getState().updateChannels(event.payload as Record<string, number>);
    });
    await listen("realtime:error", (event) => {
      console.error("Realtime error:", event.payload);
    });
    console.log("[realtime] Global event listener registered");
  })();
  return _realtimeListenerPromise;
}
