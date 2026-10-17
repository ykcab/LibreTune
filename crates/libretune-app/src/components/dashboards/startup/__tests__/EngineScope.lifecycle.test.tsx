import type { ComponentProps } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EngineScope from '../EngineScope';
import type { ScopeLane } from '../lanes';
import type { SessionSnapshot } from '../session';

const LANE = {
  id: 'ch:rpm',
  channel: 'rpm',
  label: 'RPM',
  sourceUnit: 'rpm',
  unit: 'rpm',
  scale: 1,
  offset: 0,
  color: '#4ea8dc',
  min: 0,
  max: 8000,
  digits: 0,
} as unknown as ScopeLane;

const SNAPSHOT = { values: {}, intervalMs: 100, staleMs: 0 } as unknown as SessionSnapshot;

function props(overrides: Partial<ComponentProps<typeof EngineScope>> = {}) {
  return {
    lanes: [LANE],
    markers: [],
    snapshot: SNAPSHOT,
    intervalMs: 100,
    windowSec: 20,
    paused: false,
    onPausedChange: () => {},
    live: true,
    isConnected: true,
    ...overrides,
  };
}

describe('EngineScope canvas lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the canvas when the measured stream interval wobbles', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const { rerender } = render(<EngineScope {...props()} />);
    const initial = getContext.mock.calls.length;

    // The frame-interval EWMA moves on every stream frame. Each move changes the
    // derived sample count, and that used to tear the canvas down and rebuild it.
    for (const ms of [98.7, 101.2, 99.4, 100.9, 97.8]) {
      rerender(<EngineScope {...props({ intervalMs: ms })} />);
    }

    expect(getContext.mock.calls.length).toBe(initial);
  });

  it('keeps the canvas when the connection state changes', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const { rerender } = render(<EngineScope {...props({ isConnected: false })} />);
    const initial = getContext.mock.calls.length;

    rerender(<EngineScope {...props({ isConnected: true })} />);

    expect(getContext.mock.calls.length).toBe(initial);
  });

  it('reassigns the bitmap only when the container size changes', () => {
    // Assigning canvas.width clears the bitmap, so a resize notification with an
    // unchanged container must not touch it.
    const observer: { callback?: () => void } = {};
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        observer.callback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    let width = 600;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({ x: 0, y: 0, top: 0, left: 0, width, height: 300, right: width, bottom: 300, toJSON() {} }) as DOMRect,
    );
    const bitmapWidth = vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set');

    try {
      render(<EngineScope {...props()} />);
      const initial = bitmapWidth.mock.calls.length;

      observer.callback?.();
      observer.callback?.();
      expect(bitmapWidth.mock.calls.length).toBe(initial);

      width = 640;
      observer.callback?.();
      expect(bitmapWidth.mock.calls.length).toBe(initial + 1);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});
