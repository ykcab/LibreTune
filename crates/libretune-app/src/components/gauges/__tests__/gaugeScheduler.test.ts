/**
 * The shared dashboard render loop.
 *
 * The previous design gave every `<TsGauge>` its own rAF loop and its own 100 ms
 * watchdog; a 42-gauge dashboard therefore had 42 of each. These tests pin the
 * properties that replacement has to keep: one loop for the whole dashboard,
 * one timer, one store read per tick, and a loop that actually parks when
 * nothing needs frames.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  channelsForTick,
  IDLE_TICK_MS,
  registerGauge,
  registeredGaugeCount,
  requestFrames,
  type GaugeRenderer,
} from '../gaugeScheduler';
import { useRealtimeStore } from '../../../stores/realtimeStore';

/** Manual rAF queue so frames can be run deterministically. */
let frameQueue: Array<(t: number) => void> = [];
let rafRequests = 0;

function runFrame(t: number): void {
  const queue = frameQueue;
  frameQueue = [];
  for (const cb of queue) cb(t);
}

function gauge(needsFrames: boolean, onIdle?: () => void): GaugeRenderer {
  return {
    frame: vi.fn(() => needsFrames),
    idle: vi.fn(() => onIdle?.()),
  };
}

describe('gaugeScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    frameQueue = [];
    rafRequests = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      rafRequests += 1;
      frameQueue.push(cb);
      return rafRequests;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    useRealtimeStore.getState().clearChannels();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('runs one loop for every gauge on the dashboard', () => {
    const a = gauge(true);
    const b = gauge(true);
    const c = gauge(true);
    const offs = [registerGauge(a), registerGauge(b), registerGauge(c)];

    expect(rafRequests).toBe(1);
    runFrame(16);

    expect(a.frame).toHaveBeenCalledTimes(1);
    expect(b.frame).toHaveBeenCalledTimes(1);
    expect(c.frame).toHaveBeenCalledTimes(1);
    offs.forEach((off) => off());
  });

  it('parks the loop as soon as no gauge needs frames', () => {
    const settled = gauge(false);
    const off = registerGauge(settled);

    runFrame(16);
    const afterParking = rafRequests;

    // Nothing asked for another frame, so the loop is idle: no further
    // callbacks are queued no matter how much time passes.
    expect(rafRequests).toBe(afterParking);
    vi.advanceTimersByTime(IDLE_TICK_MS * 5);
    expect(rafRequests).toBe(afterParking);
    off();
  });

  it('keeps the loop alive while any gauge is still animating', () => {
    const animating = gauge(true);
    const settled = gauge(false);
    const offA = registerGauge(animating);
    const offB = registerGauge(settled);

    runFrame(16);
    expect(rafRequests).toBe(2);
    runFrame(32);
    expect(rafRequests).toBe(3);

    offA();
    offB();
  });

  it('polls every parked gauge from a single timer', () => {
    const a = gauge(false);
    const b = gauge(false);
    const offA = registerGauge(a);
    const offB = registerGauge(b);

    vi.advanceTimersByTime(IDLE_TICK_MS);

    expect(a.idle).toHaveBeenCalledTimes(1);
    expect(b.idle).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it('stops the timer when the last gauge unregisters', () => {
    const a = gauge(false);
    const off = registerGauge(a);
    expect(registeredGaugeCount()).toBe(1);
    off();

    expect(registeredGaugeCount()).toBe(0);
    vi.advanceTimersByTime(IDLE_TICK_MS * 3);
    expect(a.idle).not.toHaveBeenCalled();
  });

  it('reads the store once per tick, however many gauges ask', () => {
    const getState = vi.spyOn(useRealtimeStore, 'getState');

    channelsForTick(1000);
    channelsForTick(1000);
    channelsForTick(1000);
    expect(getState).toHaveBeenCalledTimes(1);

    // A new tick re-reads (the store may have delivered a new sample).
    channelsForTick(1016);
    expect(getState).toHaveBeenCalledTimes(2);

    getState.mockRestore();
  });

  it('ignores a frame request once the loop is already running', () => {
    const off = registerGauge(gauge(true));
    expect(rafRequests).toBe(1);

    // The idle tick calls this every 100 ms; it must not queue extra frames.
    requestFrames();
    requestFrames();
    expect(rafRequests).toBe(1);

    runFrame(16);
    off();
  });
});
