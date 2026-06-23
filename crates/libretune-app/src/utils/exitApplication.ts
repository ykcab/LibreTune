import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

const SHUTDOWN_TIMEOUT_MS = 4_000;

/** Quit LibreTune. `window.close()` is not valid in Tauri — it blanks the webview without exiting. */
export async function exitApplication(): Promise<void> {
  const cleanup = Promise.allSettled([
    invoke('stop_realtime_stream').catch(() => {}),
    invoke('disconnect_ecu').catch(() => {}),
    invoke('close_project').catch(() => {}),
  ]);

  await Promise.race([
    cleanup,
    new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
  ]);

  try {
    await getCurrentWindow().close();
  } catch (e) {
    console.error('[exitApplication] Failed to close window:', e);
  }
}
