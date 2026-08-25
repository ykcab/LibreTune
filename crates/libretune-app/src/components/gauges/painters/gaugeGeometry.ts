/**
 * gaugeGeometry — shared TunerStudio geometry resolution for circular
 * painters (issue #129).
 *
 * A `.dash` gauge carries four geometry properties. TunerStudio semantics:
 *  - `FaceAngle` — total angular extent of the gauge FACE (360 = full
 *    circle, 180 = half-sweep face). Stock corpus values are only
 *    360/180/182/188; the face arc is centered on the needle sweep, so a
 *    182° face wrapping a 180° sweep leaves a 1° margin per side.
 *  - `SweepBeginDegree` / `StartAngle` — where the needle sweep begins
 *    (canvas degrees; 0° = right, 90° = down, clockwise positive).
 *  - `SweepAngle` — how far the needle travels from min to max.
 *
 * The needle can never travel outside the face, so the effective sweep is
 * clamped to the face extent. That also self-heals files that set
 * `FaceAngle=180` but omit `SweepAngle` (where the parser default of 270
 * would otherwise over-sweep a half-circle gauge).
 */

import type { TsGaugeConfig } from '../../dashboards/dashTypes';

/** Smallest sector face we will render — below this, authored data is noise. */
const MIN_FACE_ANGLE = 45;
const MIN_SWEEP = 1;

export interface GaugeArc {
  /** Angle (canvas degrees) where the needle sweep starts. */
  startDeg: number;
  /** Effective needle travel in degrees (never exceeds `faceAngleDeg`). */
  sweepDeg: number;
  counterClockwise: boolean;
  /** Face arc extent in degrees; 360 = full circle. */
  faceAngleDeg: number;
  /** Angle where the face arc starts (the face is centered on the sweep). */
  faceStartDeg: number;
  /** True when the face covers the full circle — painters keep their legacy path. */
  isFullCircle: boolean;
}

/**
 * Resolve the render-time arc geometry for a gauge. Pure — no canvas, no
 * side effects — so it can be unit-tested against the stock-corpus shapes.
 */
export function resolveGaugeArc(
  config: Pick<
    TsGaugeConfig,
    'sweep_begin_degree' | 'start_angle' | 'sweep_angle' | 'face_angle' | 'counter_clockwise'
  >,
): GaugeArc {
  const startDeg =
    config.sweep_begin_degree ??
    config.start_angle ??
    225;
  const requestedSweep = Number.isFinite(config.sweep_angle) ? config.sweep_angle : 270;
  // Absent/NaN/too-small faces fall back to full circle — garbage data must
  // not shrink a gauge into a sliver; anything above 360 is still full.
  const rawFace = config.face_angle;
  const faceAngleDeg =
    rawFace == null || !Number.isFinite(rawFace) || rawFace < MIN_FACE_ANGLE
      ? 360
      : Math.min(rawFace, 360);
  // The needle travels inside the face, never beyond it.
  const sweepDeg = Math.max(MIN_SWEEP, Math.min(requestedSweep, faceAngleDeg));
  const ccw = config.counter_clockwise ?? false;

  // Face arc is centered on the sweep arc (mirrored for counter-clockwise).
  const sweepMidDeg = ccw ? startDeg - sweepDeg / 2 : startDeg + sweepDeg / 2;
  const faceStartDeg = sweepMidDeg - faceAngleDeg / 2;

  return {
    startDeg,
    sweepDeg,
    counterClockwise: ccw,
    faceAngleDeg,
    faceStartDeg,
    isFullCircle: faceAngleDeg >= 360,
  };
}

/**
 * Trace the gauge face onto the canvas: a full circle, or a closed pie
 * wedge covering `[faceStartDeg, faceStartDeg + faceAngleDeg]`. Only
 * traces the path — the caller fills/strokes it.
 */
export function traceFacePath(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  arc: GaugeArc,
): void {
  ctx.beginPath();
  if (arc.isFullCircle) {
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    return;
  }
  const startRad = (arc.faceStartDeg * Math.PI) / 180;
  const endRad = ((arc.faceStartDeg + arc.faceAngleDeg) * Math.PI) / 180;
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, radius, startRad, endRad);
  ctx.closePath();
}

/**
 * Unit vector pointing AWAY from the face — where a sector-face gauge
 * should anchor its title/value text (e.g. a top-half gauge puts its
 * readout below the pivot, like TunerStudio's half gauges). Only meaningful
 * when `!arc.isFullCircle`.
 */
export function faceOppositeDirection(arc: GaugeArc): { x: number; y: number } {
  const midRad = ((arc.faceStartDeg + arc.faceAngleDeg / 2) * Math.PI) / 180;
  return { x: -Math.cos(midRad), y: -Math.sin(midRad) };
}
