/**
 * Reveal the main window once it actually has something in it.
 *
 * The window is created hidden (`"visible": false` in `tauri.conf.json`) and
 * with an opaque surface. It used to be created visible *and* transparent, which
 * mapped an unpainted surface the moment the process started and left it there
 * for the whole JS parse plus the boot IPC chain — the OS showed a window frame
 * over nothing, and the first meaningful paint often arrived with the first
 * focus or click. That is the "it looks like it is waiting for me to click"
 * symptom.
 *
 * Two frames rather than one: the first lets React commit, the second runs after
 * the browser has painted that commit, so `show()` cannot reveal an empty
 * surface.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";

let revealed = false;

export function revealWindowWhenPainted(): void {
  if (revealed) return;
  if (!("__TAURI_INTERNALS__" in window)) return;
  revealed = true;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        void getCurrentWindow().show().catch((e) => {
          // Never fatal: the Rust side has the same reveal on a timer, so a
          // failure here degrades to the old behaviour rather than a hidden app.
          console.warn("Window reveal failed:", e);
        });
      } catch (e) {
        console.warn("Window reveal unavailable:", e);
      }
    });
  });
}
