/**
 * `gaugeScheduler` — one animation frame loop and one idle timer for the whole
 * dashboard, instead of one of each per gauge.
 *
 * The previous design gave every `<TsGauge>` its own `requestAnimationFrame`
 * loop and its own 100 ms `setInterval` watchdog (`useGaugeRenderer`). On the
 * 42-gauge `Telemetry Live` dashboard that is 42 loops and 42 timers: 42
 * callbacks per frame, 420 timer wake-ups a second, 42 independent store reads,
 * and no way for the dashboard as a whole to be idle — one time-series gauge
 * (LineGraph, Histogram, MultiChannelTrend) kept its own 60 Hz loop running
 * forever.
 *
 * Now:
 *
 *  - **One rAF loop.** It runs only while at least one registered gauge reports
 *    that it still needs frames, so a converged dashboard has no loop at all.
 *  - **One idle timer.** Gauges are polled from a single 100 ms interval, which
 *    is the same latency they had before (and the frontend only delivers new
 *    samples every 100 ms anyway).
 *  - **One store read per tick.** Every gauge in a tick shares the same
 *    `channels` snapshot instead of each calling `getState()` for itself.
 *
 * Renderer hosts stay responsible for their own smoothing, peak hold, spike
 * flash and frame-rate cap — this module only decides *when* they get a turn.
 */

import { useRealtimeStore } from '../../stores/realtimeStore';

/** Poll interval for parked gauges — the pre-existing per-gauge watchdog period. */
export const IDLE_TICK_MS = 100;

export interface GaugeRenderer {
  /**
   * Advance one frame.
   *
   * @returns true while this gauge still needs frames (an animation is
   *   converging, or a time-series painter is waiting on its next sample).
   */
  frame(now: number): boolean;
  /**
   * Called from the shared idle tick while the rAF loop is parked. Implementors
   * use it to notice new data (and call `requestFrames`), to expire a spike
   * flash, or to advance a peak-hold decay.
   */
  idle(now: number): void;
}

const gauges = new Set<GaugeRenderer>();

let rafId: number | null = null;
let idleTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Cached `channels` snapshot, keyed by the timestamp of the tick that asked for
 * it. All gauges visited in one tick pass the same `now`, so they share one
 * `getState()` instead of one each.
 */
let snapshot: Record<string, number> = {};
let snapshotAt = -1;

/** The store's channel map for this tick — one read, shared by every gauge. */
export function channelsForTick(now: number): Record<string, number> {
  if (now !== snapshotAt) {
    snapshot = useRealtimeStore.getState().channels;
    snapshotAt = now;
  }
  return snapshot;
}

function frameTick(now: number): void {
  rafId = null;
  let needsMore = false;
  // Copy nothing and allocate nothing here: `frame` is expected to be cheap
  // when nothing changed, and returning false is how a gauge parks itself.
  for (const gauge of gauges) {
    if (gauge.frame(now)) needsMore = true;
  }
  if (needsMore && gauges.size > 0) {
    rafId = requestAnimationFrame(frameTick);
  }
}

/** Ask for frames — idempotent, so callers can request them every tick. */
export function requestFrames(): void {
  if (rafId !== null || gauges.size === 0) return;
  rafId = requestAnimationFrame(frameTick);
}

function idleTick(): void {
  const now = performance.now();
  for (const gauge of gauges) {
    gauge.idle(now);
  }
}

/**
 * Register a gauge renderer. Returns the unregister function.
 *
 * Registration kicks the loop once so a newly mounted gauge paints its first
 * frame immediately rather than waiting for the idle tick.
 */
export function registerGauge(gauge: GaugeRenderer): () => void {
  gauges.add(gauge);
  if (idleTimer === null) {
    idleTimer = setInterval(idleTick, IDLE_TICK_MS);
  }
  requestFrames();

  return () => {
    gauges.delete(gauge);
    if (gauges.size > 0) return;
    // Last gauge gone — stop both the timer and the loop.
    if (idleTimer !== null) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}

/** Test hook: how many gauges are attached (leaks are otherwise invisible). */
export function registeredGaugeCount(): number {
  return gauges.size;
}
