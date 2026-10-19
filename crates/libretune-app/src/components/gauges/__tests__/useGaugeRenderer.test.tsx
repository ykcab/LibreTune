/**
 * The renderer host's repaint contract.
 *
 * Verified here rather than in the running app because the interesting cases are
 * timing-dependent and invisible in a screenshot: a gauge woken by the shared
 * loop for a neighbour's sake must NOT repaint, a gauge whose value moved must
 * repaint, and a time-series gauge must repaint for new samples even when its
 * value is steady. The old design could not get any of this wrong — every gauge
 * had its own loop and painted whenever its own watchdog said so — so these are
 * the assertions that keep the consolidation honest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useGaugeRenderer, type GaugePaintFn } from '../useGaugeRenderer';
import { IDLE_TICK_MS, registerGauge } from '../gaugeScheduler';
import { setForTest, resetForTest } from '../renderSettings';
import { useRealtimeStore } from '../../../stores/realtimeStore';
import type { TsGaugeConfig } from '../../dashboards/dashTypes';

/** Manual rAF queue — frames run only when a test asks for one. */
let frameQueue: Array<(t: number) => void> = [];

function runFrame(t: number): void {
  const queue = frameQueue;
  frameQueue = [];
  for (const cb of queue) cb(t);
}

/** `now` for the frames this test drives. */
let clock = 0;

function config(overrides: Partial<TsGaugeConfig> = {}): TsGaugeConfig {
  return {
    id: 'g1',
    output_channel: 'rpm',
    gauge_painter: 'BasicReadout',
    min: 0,
    max: 8000,
    ...overrides,
  } as TsGaugeConfig;
}

/** Size the stubbed canvases report; the resize test changes it. */
let canvasSize = { w: 100, h: 100 };

/** The setup file's stub never fires; this one lets a test simulate a resize. */
let resizeCallbacks: Array<() => void> = [];

class TestResizeObserver {
  constructor(cb: () => void) {
    resizeCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const rect = () =>
  ({
    width: canvasSize.w,
    height: canvasSize.h,
    top: 0,
    left: 0,
    right: canvasSize.w,
    bottom: canvasSize.h,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;

function Harness({
  cfg,
  paint,
  continuousRender = false,
}: {
  cfg: TsGaugeConfig;
  paint: GaugePaintFn;
  continuousRender?: boolean;
}) {
  const { canvasRef } = useGaugeRenderer({
    config: cfg,
    value: 0,
    overrideStore: false,
    enabled: true,
    paint,
    continuousRender,
  });

  return <canvas ref={canvasRef} />;
}

/** Minimal 2D context — the renderer only needs these entry points. */
function stubContext(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
  } as unknown as CanvasRenderingContext2D;
}

describe('useGaugeRenderer repaint contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    frameQueue = [];
    clock = 1000;
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      frameQueue.push(cb);
      return frameQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    // The setup file already stubs the full 2D surface; cast so the overloaded
    // `getContext` signature accepts it.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      stubContext() as unknown as GPUCanvasContext,
    );
    // jsdom has no layout, so every canvas must report a size before the
    // renderer's own effects run (they run before any test-applied override).
    canvasSize = { w: 100, h: 100 };
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(rect);
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    setForTest({ refreshHz: 30 });
    useRealtimeStore.getState().clearChannels();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetForTest();
    useRealtimeStore.getState().clearChannels();
  });

  it('paints on mount, then stays still while the value is unchanged', () => {
    const paint = vi.fn();
    render(<Harness cfg={config()} paint={paint} />);

    // A neighbouring gauge that keeps the shared loop running at full rate —
    // which is the whole risk of sharing one loop: every gauge gets a turn on
    // every frame whether or not anything changed for it.
    const stopNeighbour = registerGauge({ frame: () => true, idle: () => {} });

    runFrame((clock += 16));
    expect(paint).toHaveBeenCalledTimes(1);

    // Frames keep coming (the neighbour wants them), and the interval gate has
    // expired several times over — but this gauge has nothing new to draw.
    runFrame((clock += 16));
    runFrame((clock += 16));
    runFrame((clock += 16));
    expect(paint).toHaveBeenCalledTimes(1);

    stopNeighbour();
  });

  it('repaints after the channel value moves', () => {
    const paint = vi.fn();
    render(<Harness cfg={config()} paint={paint} />);
    runFrame((clock += 16));
    expect(paint).toHaveBeenCalledTimes(1);

    useRealtimeStore.getState().updateChannels({ rpm: 4000 });
    // The idle tick notices the new sample and requests frames.
    vi.advanceTimersByTime(IDLE_TICK_MS);
    runFrame((clock += 16));
    runFrame((clock += 16));

    expect(paint.mock.calls.length).toBeGreaterThan(1);
    // The painter receives the animated value, not the raw one.
    const lastValue = paint.mock.calls[paint.mock.calls.length - 1][3];
    expect(lastValue).toBeGreaterThan(0);
    expect(lastValue).toBeLessThanOrEqual(4000);
  });

  it('keeps painting a time-series gauge while its value is steady', () => {
    // Issue #71: the trace has to keep scrolling even when the value does not
    // move, because a new sample lands in the history buffer every tick.
    const paint = vi.fn();
    render(<Harness cfg={config({ gauge_painter: 'LineGraph' })} paint={paint} continuousRender />);

    runFrame((clock += 16));
    const afterFirst = paint.mock.calls.length;

    vi.advanceTimersByTime(IDLE_TICK_MS);
    runFrame((clock += 16));
    vi.advanceTimersByTime(IDLE_TICK_MS);
    runFrame((clock += 16));

    expect(paint.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('repaints after a resize, which clears the backing store', () => {
    const paint = vi.fn();
    render(<Harness cfg={config()} paint={paint} />);
    runFrame((clock += 16));
    const before = paint.mock.calls.length;

    // Reallocating the canvas clears it; the renderer must not treat the
    // unchanged value as "nothing to draw".
    canvasSize = { w: 140, h: 90 };
    resizeCallbacks.forEach((cb) => cb());
    runFrame((clock += 16));

    expect(paint.mock.calls.length).toBeGreaterThan(before);
  });
});
