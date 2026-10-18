/**
 * Reveal the main window once it has content in it.
 *
 * The window is created hidden (`"visible": false` in `tauri.conf.json`) and
 * with an opaque surface. It used to be created visible *and* transparent, which
 * mapped an unpainted surface the moment the process started and left it there
 * for the whole JS parse plus the boot IPC chain — the OS showed a window frame
 * over nothing, and the first meaningful paint often arrived with the first
 * focus or click. That is the "it looks like it is waiting for me to click"
 * symptom.
 *
 * Two things this must not do:
 *
 * 1. **Wait on `requestAnimationFrame`.** A hidden window does not paint, and
 *    WebKit does not run rAF callbacks for one — the callback never fires and
 *    the window never appears. (This was the first version's bug: the reveal was
 *    also denied by the Tauri ACL, so the 8 s Rust safety net was doing the
 *    work and the app looked like it took 8 s to open.) rAF is kept only as an
 *    accelerator for the case where it does run.
 * 2. **Reveal before the shell is committed.** This is called from a mount
 *    effect, so React has already committed the menu bar, toolbar, side bar and
 *    status bar to the DOM. The first frame the compositor produces after
 *    `show()` therefore contains the real shell — which is the closest thing to
 *    "painted" that exists while the window is hidden.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";

let requested = false;
let shown = false;

export function revealWindowWhenPainted(): void {
  if (requested) return;
  if (!("__TAURI_INTERNALS__" in window)) return;
  requested = true;

  const showOnce = () => {
    if (shown) return;
    shown = true;
    try {
      void getCurrentWindow()
        .show()
        .catch((e) => {
          // Not fatal: the Rust side reveals the window on a timer, so a
          // failure here degrades to a late window rather than a hidden one.
          shown = false;
          console.warn("Window reveal failed:", e);
        });
    } catch (e) {
      shown = false;
      console.warn("Window reveal unavailable:", e);
    }
  };

  // The path that works while hidden: a task after the commit, before paint.
  setTimeout(showOnce, 0);
  // Accelerator — fires first when the window is already paintable.
  requestAnimationFrame(() => requestAnimationFrame(showOnce));
}
