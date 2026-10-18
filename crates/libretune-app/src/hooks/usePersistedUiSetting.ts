import { RefObject, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Persist a UI-layout setting, debounced and gated on the initial restore.
 *
 * These three (sidebar visibility, ECU menus in the menubar, agent panel
 * visibility) fired an un-debounced `update_setting` on every change: toggling
 * the sidebar three times in a row meant three settings read-modify-write
 * cycles — and before the backend learned to skip no-op writes and serve reads
 * from memory, each of those was a file read, an OS keychain query, a full
 * pretty-printed rewrite and an fsync, all under the process-wide settings lock.
 *
 * Nothing is dropped: the debounce keeps the last value. The restore gate is
 * checked when the timer fires rather than when the effect runs, because boot
 * sets the flag *after* it applies the restored values — checking earlier would
 * let a default value overwrite what the user had saved.
 */
export function usePersistedUiSetting(
  key: string,
  value: string | number | boolean,
  restoredRef: RefObject<boolean>,
  delayMs = 400,
): void {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!restoredRef.current) return;
      void invoke("update_setting", { key, value: String(value) }).catch(() => {});
    }, delayMs);
    return () => clearTimeout(timer);
  }, [key, value, restoredRef, delayMs]);
}
