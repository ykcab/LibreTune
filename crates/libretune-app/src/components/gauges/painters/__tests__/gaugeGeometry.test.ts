import { describe, it, expect } from 'vitest';
import { resolveGaugeArc, traceFacePath, faceOppositeDirection } from '../gaugeGeometry';
import type { TsGaugeConfig } from '../../../dashboards/dashTypes';

type GeometryFields = Pick<
  TsGaugeConfig,
  'sweep_begin_degree' | 'start_angle' | 'sweep_angle' | 'face_angle' | 'counter_clockwise'
>;

const geom = (overrides: Partial<GeometryFields>): GeometryFields => ({
  sweep_begin_degree: 135,
  start_angle: 135,
  sweep_angle: 270,
  face_angle: 360,
  counter_clockwise: false,
  ...overrides,
});

describe('resolveGaugeArc (issue #129: face_angle applied at render time)', () => {
  it('keeps legacy geometry for a full-circle face (face_angle=360)', () => {
    const arc = resolveGaugeArc(geom({}));
    expect(arc.isFullCircle).toBe(true);
    expect(arc.startDeg).toBe(135);
    expect(arc.sweepDeg).toBe(270);
    expect(arc.faceAngleDeg).toBe(360);
  });

  it('a FaceAngle=180 gauge resolves to a half-sweep sector centered on the needle sweep', () => {
    // Needle sweeps 180°→360° across the top half; the face must span the
    // same region instead of drawing a full circle.
    const arc = resolveGaugeArc(geom({ face_angle: 180, sweep_angle: 180, sweep_begin_degree: 180 }));
    expect(arc.isFullCircle).toBe(false);
    expect(arc.faceAngleDeg).toBe(180);
    expect(arc.sweepDeg).toBe(180);
    // Face centered on the sweep mid (270° = up): 270 − 90 = 180.
    expect(arc.faceStartDeg).toBe(180);
  });

  it('a 182° face wraps a 180° sweep with a 1° margin per side', () => {
    const arc = resolveGaugeArc(geom({ face_angle: 182, sweep_angle: 180, sweep_begin_degree: 180 }));
    expect(arc.faceAngleDeg).toBe(182);
    expect(arc.faceStartDeg).toBe(270 - 91); // 179 — one degree before the sweep starts
  });

  it('clamps the needle sweep to the face extent', () => {
    // File sets FaceAngle=180 but omits SweepAngle (parser default 270):
    // the needle must not sweep outside the half-circle face.
    const arc = resolveGaugeArc(geom({ face_angle: 180, sweep_angle: 270 }));
    expect(arc.sweepDeg).toBe(180);
  });

  it('mirrors the face around the sweep for counter-clockwise gauges', () => {
    // CCW sweep starting at 180° (left) travelling downward through 90°
    // (bottom) to 0° (right): mid = 90° (down), so the face covers the
    // bottom half (0°→180°).
    const arc = resolveGaugeArc(
      geom({ face_angle: 180, sweep_angle: 180, sweep_begin_degree: 180, counter_clockwise: true }),
    );
    expect(arc.counterClockwise).toBe(true);
    expect(arc.faceStartDeg).toBe(0);
  });

  it('treats absent, NaN, or degenerate face angles as a full circle', () => {
    for (const face_angle of [undefined, Number.NaN, 0, 10, -90]) {
      const arc = resolveGaugeArc(geom({ face_angle: face_angle as number }));
      expect(arc.isFullCircle, `face_angle=${face_angle}`).toBe(true);
      expect(arc.faceAngleDeg, `face_angle=${face_angle}`).toBe(360);
    }
  });

  it('treats over-full face angles as a full circle', () => {
    const arc = resolveGaugeArc(geom({ face_angle: 999 }));
    expect(arc.isFullCircle).toBe(true);
    expect(arc.faceAngleDeg).toBe(360);
  });
});

describe('traceFacePath', () => {
  const calls = () => {
    const arcs: Array<number[]> = [];
    const ctx = {
      beginPath: () => {},
      moveTo: () => {},
      closePath: () => {},
      arc: (...a: number[]) => { arcs.push(a); },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, arcs };
  };

  it('traces a single full-circle arc for a 360° face', () => {
    const { ctx, arcs } = calls();
    traceFacePath(ctx, 50, 50, 40, resolveGaugeArc(geom({})));
    expect(arcs).toEqual([[50, 50, 40, 0, Math.PI * 2]]);
  });

  it('traces a closed wedge (pivot → arc → close) for a sector face', () => {
    const { ctx, arcs } = calls();
    let closed = 0;
    const ctx2 = {
      ...ctx,
      closePath: () => { closed += 1; },
      moveTo: () => {},
    } as unknown as CanvasRenderingContext2D;
    const arc = resolveGaugeArc(geom({ face_angle: 180, sweep_angle: 180, sweep_begin_degree: 180 }));
    traceFacePath(ctx2, 50, 50, 40, arc);
    expect(closed).toBe(1);
    expect(arcs).toHaveLength(1);
    const [cx, cy, r, start, end] = arcs[0];
    expect(cx).toBe(50);
    expect(cy).toBe(50);
    expect(r).toBe(40);
    expect(start).toBeCloseTo(Math.PI, 5); // 180°
    expect(end).toBeCloseTo(Math.PI * 2, 5); // 360°
  });
});

describe('faceOppositeDirection', () => {
  it('points down for a top-half gauge (text anchors below the pivot)', () => {
    const arc = resolveGaugeArc(geom({ face_angle: 180, sweep_angle: 180, sweep_begin_degree: 180 }));
    const dir = faceOppositeDirection(arc);
    expect(dir.x).toBeCloseTo(0, 5);
    expect(dir.y).toBeCloseTo(1, 5); // canvas +y = down
  });

  it('points up for a bottom-half (CCW) gauge', () => {
    // CCW from 180° through the bottom: the face covers the bottom half,
    // so the text anchor must be above the pivot.
    const arc = resolveGaugeArc(
      geom({ face_angle: 180, sweep_angle: 180, sweep_begin_degree: 180, counter_clockwise: true }),
    );
    const dir = faceOppositeDirection(arc);
    expect(dir.x).toBeCloseTo(0, 5);
    expect(dir.y).toBeCloseTo(-1, 5);
  });
});
