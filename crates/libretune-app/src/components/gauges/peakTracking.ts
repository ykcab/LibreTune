/**
 * peakTracking — peak-hold state machine for gauges with `peak_hold`
 * (TunerStudio's `ShowHistory`) — issue #129.
 *
 * TunerStudio persists the last peak as `HistoryValue` and holds the
 * on-gauge peak marker for `HistoryDelay` milliseconds before letting it
 * fall back to the present value. A `HistoryDelay <= 0` is treated as
 * "hold forever": the value is undocumented in the `.dash` format, and
 * holding matches the previous renderer behaviour, so it can never make
 * the marker worse than before.
 *
 * Pure functions only — no canvas, no timers — so the rAF loop in
 * `useGaugeRenderer` stays thin and this stays unit-testable.
 */

import type { TsGaugeConfig } from '../dashboards/dashTypes';

export interface PeakState {
  peak: number;
  /**
   * Timestamp (ms, rAF clock) of the last upward ratchet or decay reset.
   * `null` before the first frame; the first `nextPeakState` call starts
   * the decay clock, which is what makes a peak seeded from the file's
   * `history_value` decay like a freshly observed one.
   */
  lastNewPeakAt: number | null;
}

/**
 * Seed the peak from the file's persisted `history_value`, clamped into
 * the gauge range. Falls back to the caller's value (the current display
 * value) when history is absent or peak-hold is off.
 */
export function seedPeak(
  config: Pick<TsGaugeConfig, 'peak_hold' | 'history_value' | 'min' | 'max'>,
  fallback: number,
): number {
  if (!config.peak_hold) return fallback;
  const history = config.history_value;
  if (!Number.isFinite(history)) return fallback;
  return Math.max(config.min, Math.min(config.max, history));
}

/**
 * Advance the peak state by one frame.
 *
 * @param state   Current state.
 * @param target  The gauge's current animation target (fresh store value).
 * @param nowMs   Frame timestamp (rAF clock).
 * @param delayMs `history_delay` in ms; `<= 0` holds the peak forever.
 */
export function nextPeakState(
  state: PeakState,
  target: number,
  nowMs: number,
  delayMs: number,
): PeakState {
  // First frame: start the decay clock without moving the (possibly
  // seeded) peak.
  const lastNewPeakAt = state.lastNewPeakAt ?? nowMs;
  if (target > state.peak) {
    return { peak: target, lastNewPeakAt: nowMs };
  }
  if (delayMs > 0 && nowMs - lastNewPeakAt >= delayMs) {
    // Hold expired — the marker falls back to the present value and the
    // timer restarts (a visual no-op while the value stays put).
    return { peak: target, lastNewPeakAt: nowMs };
  }
  return state.lastNewPeakAt === lastNewPeakAt ? state : { ...state, lastNewPeakAt };
}
