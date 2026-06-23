/**
 * Pure canvas-drawing helpers shared by gauge painters.
 *
 * These are intentionally free of React, store subscriptions, and
 * gauge-config knowledge so they can be unit-tested and reused by any
 * future per-painter module without dragging in component state.
 */

import type { TsColor } from '../dashboards/dashTypes';
import { tsColorToHex } from '../dashboards/dashTypes';

/** Stroke/fill helper to define a rounded-rectangle path. */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Lighten a #rrggbb hex color by `percent` (0-100). */
export function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, (num >> 16) + amt);
  const G = Math.min(255, ((num >> 8) & 0x00ff) + amt);
  const B = Math.min(255, (num & 0x0000ff) + amt);
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}

/** Darken a #rrggbb hex color by `percent` (0-100). */
export function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, (num >> 16) - amt);
  const G = Math.max(0, ((num >> 8) & 0x00ff) - amt);
  const B = Math.max(0, (num & 0x0000ff) - amt);
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}

/**
 * Build a radial gradient that gives a metallic-bezel look around a
 * circular gauge.
 */
export function createMetallicGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r1: number,
  r2: number,
  baseColor: TsColor,
): CanvasGradient {
  const gradient = ctx.createRadialGradient(x - r2 * 0.3, y - r2 * 0.3, r1, x, y, r2);
  const hex = tsColorToHex(baseColor);
  gradient.addColorStop(0, lightenColor(hex, 60));
  gradient.addColorStop(0.3, lightenColor(hex, 30));
  gradient.addColorStop(0.5, hex);
  gradient.addColorStop(0.7, darkenColor(hex, 20));
  gradient.addColorStop(1, darkenColor(hex, 40));
  return gradient;
}

/* ---- Futuristic HUD chrome (shared by gauge painters) ---- */

export const HUD_COLORS = {
  panel: 'rgba(6, 9, 16, 0.78)',
  panelEdge: 'rgba(255, 179, 0, 0.2)',
  accent: 'rgba(255, 179, 0, 0.55)',
  accentBright: 'rgba(255, 179, 0, 0.85)',
  grid: 'rgba(100, 181, 246, 0.07)',
  track: 'rgba(18, 22, 32, 0.95)',
  trackEdge: 'rgba(100, 181, 246, 0.15)',
} as const;

/** L-shaped corner brackets for HUD panels */
export function drawHudCornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  len = 10,
): void {
  const color = HUD_COLORS.accent;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'square';

  const drawCorner = (cx: number, cy: number, dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + dy * len);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx * len, cy);
    ctx.stroke();
  };

  drawCorner(x, y, 1, 1);
  drawCorner(x + w, y, -1, 1);
  drawCorner(x, y + h, 1, -1);
  drawCorner(x + w, y + h, -1, -1);
}

/** Dark glass HUD panel with amber top accent and corner brackets */
export function drawHudPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 3,
): void {
  ctx.fillStyle = HUD_COLORS.panel;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();

  ctx.strokeStyle = HUD_COLORS.panelEdge;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, radius);
  ctx.stroke();

  ctx.strokeStyle = HUD_COLORS.accentBright;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + radius, y + 0.5);
  ctx.lineTo(x + w - radius, y + 0.5);
  ctx.stroke();

  drawHudCornerBrackets(ctx, x + 2, y + 2, w - 4, h - 4, Math.min(10, w * 0.06, h * 0.06));
}

/** Subtle HUD grid inside a rect */
export function drawHudGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  step = 16,
): void {
  ctx.strokeStyle = HUD_COLORS.grid;
  ctx.lineWidth = 1;
  for (let gx = x + step; gx < x + w; gx += step) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
    ctx.stroke();
  }
  for (let gy = y + step; gy < y + h; gy += step) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }
}

/** Apply neon glow for value text / needles */
export function applyNeonGlow(ctx: CanvasRenderingContext2D, color: string, blur = 12): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

export function clearNeonGlow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

/** True when the gauge should render without a rectangular HUD frame */
export function isFramelessGauge(backColor: { alpha?: number | null }): boolean {
  return (backColor.alpha ?? 255) === 0;
}

/** Minimal command-center tile: label + glowing value, no bar chrome */
export function drawCompactTile(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  value: number,
  units: string,
  digits: number,
  trimColor: string,
  valueColor: string,
  getFontSpec: (size: number, options?: { bold?: boolean; monospace?: boolean }) => string,
): void {
  const pad = Math.max(3, height * 0.12);

  ctx.fillStyle = 'rgba(255, 179, 0, 0.05)';
  ctx.strokeStyle = 'rgba(255, 179, 0, 0.14)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, width - 1, height - 1, 2);
  ctx.fill();
  ctx.stroke();

  const labelSize = Math.max(7, height * 0.22);
  ctx.fillStyle = trimColor;
  ctx.font = getFontSpec(labelSize, { bold: true });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(title.toUpperCase(), pad, pad);

  const valueSize = Math.max(11, height * 0.42);
  const valueText = units
    ? `${value.toFixed(digits)} ${units}`
    : value.toFixed(digits);

  applyNeonGlow(ctx, valueColor, 8);
  ctx.fillStyle = valueColor;
  ctx.font = getFontSpec(valueSize, { bold: true, monospace: true });
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(valueText, width - pad, height - pad);
  clearNeonGlow(ctx);
}

/** Premium dashboard stat card — dark widget with gradient accent */
export function drawModernStatCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  value: number,
  units: string,
  digits: number,
  trimColor: string,
  valueColor: string,
  getFontSpec: (size: number, options?: { bold?: boolean; monospace?: boolean }) => string,
): void {
  const r = Math.min(14, height * 0.22);
  const pad = Math.max(8, width * 0.08);

  // Card fill
  ctx.fillStyle = 'rgba(24, 26, 36, 0.92)';
  roundRect(ctx, 0.5, 0.5, width - 1, height - 1, r);
  ctx.fill();

  // Gradient top accent line
  const accent = ctx.createLinearGradient(0, 0, width, 0);
  accent.addColorStop(0, 'rgba(100, 181, 246, 0.9)');
  accent.addColorStop(0.55, 'rgba(124, 77, 255, 0.85)');
  accent.addColorStop(1, 'rgba(100, 181, 246, 0.5)');
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r, 1);
  ctx.lineTo(width - r, 1);
  ctx.stroke();

  // Subtle border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, width - 1, height - 1, r);
  ctx.stroke();

  const labelSize = Math.max(9, height * 0.16);
  ctx.fillStyle = trimColor;
  ctx.font = getFontSpec(labelSize, { bold: true });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(title.toUpperCase(), pad, pad + 4);

  const valueSize = Math.max(16, height * 0.38);
  const valueText = units ? `${value.toFixed(digits)}` : value.toFixed(digits);

  applyNeonGlow(ctx, valueColor, 14);
  ctx.fillStyle = valueColor;
  ctx.font = getFontSpec(valueSize, { bold: true, monospace: true });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(valueText, pad, height - pad);
  clearNeonGlow(ctx);

  if (units) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.font = getFontSpec(Math.max(9, height * 0.14));
    ctx.textAlign = 'right';
    ctx.fillText(units, width - pad, height - pad);
  }
}

/** Modern gradient progress ring */
export function drawModernRing(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  value: number,
  min: number,
  max: number,
  units: string,
  digits: number,
  accentHex: string,
  trimColor: string,
  valueColor: string,
  getFontSpec: (size: number, options?: { bold?: boolean; monospace?: boolean }) => string,
  startAngleDeg = 135,
  sweepDeg = 270,
): void {
  const cx = width / 2;
  const cy = height / 2 + height * 0.04;
  const radius = Math.min(width, height) * 0.38;
  const trackW = Math.max(8, radius * 0.14);
  const start = (startAngleDeg * Math.PI) / 180;
  const sweep = (sweepDeg * Math.PI) / 180;
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));

  // Title
  ctx.fillStyle = trimColor;
  ctx.font = getFontSpec(Math.max(10, radius * 0.14), { bold: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(title.toUpperCase(), cx, height * 0.04);

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, start + sweep);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = trackW;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Value arc with gradient
  if (norm > 0.005) {
    const grad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    grad.addColorStop(0, '#64B5F6');
    grad.addColorStop(0.5, accentHex);
    grad.addColorStop(1, '#7C4DFF');

    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep * norm);
    ctx.strokeStyle = grad;
    ctx.lineWidth = trackW;
    ctx.lineCap = 'round';
    ctx.shadowColor = accentHex;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Center value
  const valSize = Math.max(18, radius * 0.42);
  applyNeonGlow(ctx, valueColor, 12);
  ctx.fillStyle = valueColor;
  ctx.font = getFontSpec(valSize, { bold: true, monospace: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value.toFixed(digits), cx, cy - valSize * 0.08);
  clearNeonGlow(ctx);

  if (units) {
    ctx.fillStyle = trimColor;
    ctx.font = getFontSpec(valSize * 0.32);
    ctx.fillText(units, cx, cy + valSize * 0.38);
  }
}
