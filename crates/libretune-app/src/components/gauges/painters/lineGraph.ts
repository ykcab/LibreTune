/** LineGraph — time-series line chart with filled gradient area and current value dot. */

import { tsColorToHex } from '../../dashboards/dashTypes';
import { roundRect, lightenColor, drawHudPanel, drawHudGrid, applyNeonGlow, clearNeonGlow } from '../drawUtils';
import { getChannelHistoryBuffer } from '../../../stores/realtimeStore';
import type { Painter } from './types';

function drawModernGraphCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  valueText: string,
  valueHex: string,
  getFontSpec: (size: number, options?: { bold?: boolean; monospace?: boolean }) => string,
): number {
  const r = Math.min(14, height * 0.08);
  ctx.fillStyle = 'rgba(24, 26, 36, 0.92)';
  roundRect(ctx, 0.5, 0.5, width - 1, height - 1, r);
  ctx.fill();

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

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, width - 1, height - 1, r);
  ctx.stroke();

  const pad = Math.max(10, width * 0.04);
  const titleH = Math.max(22, height * 0.14);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
  ctx.font = getFontSpec(Math.max(9, titleH * 0.55), { bold: true });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(title.toUpperCase(), pad, pad);

  applyNeonGlow(ctx, valueHex, 8);
  ctx.fillStyle = valueHex;
  ctx.font = getFontSpec(Math.max(10, titleH * 0.65), { bold: true, monospace: true });
  ctx.textAlign = 'right';
  ctx.fillText(valueText, width - pad, pad);
  clearNeonGlow(ctx);

  return titleH + pad;
}

export const lineGraphPainter: Painter = (pctx) => {
  const { ctx, width, height, value, config, getValueColor, getFontSpec } = pctx;

  const isModern = config.gauge_style?.toLowerCase() === 'modern';
  const padding = isModern ? Math.max(10, width * 0.04) : 8;
  const valueHex = tsColorToHex(getValueColor());
  const valueLabel = `${value.toFixed(config.value_digits)} ${config.units}`;

  const titleHeight = isModern
    ? drawModernGraphCard(ctx, width, height, config.title, valueLabel, valueHex, getFontSpec)
    : (() => {
        drawHudPanel(ctx, 0, 0, width, height, 3);
        ctx.fillStyle = tsColorToHex(config.trim_color);
        ctx.font = getFontSpec(Math.max(8, height * 0.12 * 0.75), { bold: true });
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(config.title.toUpperCase(), padding, 5);
        applyNeonGlow(ctx, valueHex, 8);
        ctx.fillStyle = valueHex;
        ctx.font = getFontSpec(Math.max(9, height * 0.12 * 0.85), { bold: true, monospace: true });
        ctx.textAlign = 'right';
        ctx.fillText(valueLabel, width - padding, 5);
        clearNeonGlow(ctx);
        return height * 0.12;
      })();

  const graphWidth = width - padding * 2;
  const graphHeight = height - titleHeight - padding;
  const graphY = titleHeight + (isModern ? padding * 0.35 : padding);

  ctx.fillStyle = isModern ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.35)';
  roundRect(ctx, padding, graphY, graphWidth, graphHeight, isModern ? 8 : 2);
  ctx.fill();
  if (!isModern) {
    drawHudGrid(ctx, padding, graphY, graphWidth, graphHeight, 14);
  } else {
    // Subtle horizontal guides
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = graphY + (graphHeight * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding, gy);
      ctx.lineTo(padding + graphWidth, gy);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = isModern ? 'rgba(255, 255, 255, 0.06)' : 'rgba(100, 181, 246, 0.12)';
  ctx.lineWidth = 1;
  roundRect(ctx, padding, graphY, graphWidth, graphHeight, isModern ? 8 : 2);
  ctx.stroke();

  // Build points from history (or generate sample data if no history)
  // Read history imperatively from the non-reactive buffer — no React re-renders needed.
  const history = getChannelHistoryBuffer(config.output_channel);
  const points: { x: number; y: number }[] = [];

  if (history && history.length > 0) {
    // Use actual history data
    const dataRange = config.max - config.min;
    for (let i = 0; i < history.length; i++) {
      const t = i / (history.length - 1);
      const historicalValue = history[i];
      const historicalPercent = (historicalValue - config.min) / dataRange;
      const clampedPercent = Math.max(0, Math.min(1, historicalPercent));

      points.push({
        x: padding + t * graphWidth,
        y: graphY + graphHeight - clampedPercent * graphHeight,
      });
    }
  } else {
    // No history available - show simulated data for demo
    const numPoints = 50;
    const valuePercent = (value - config.min) / (config.max - config.min);

    for (let i = 0; i < numPoints; i++) {
      const t = i / (numPoints - 1);
      // Simulate some variation leading up to current value
      const noise = Math.sin(t * 20) * 0.05 + Math.sin(t * 7) * 0.03;
      const historicalPercent = valuePercent + (1 - t) * (Math.random() * 0.2 - 0.1) + noise * (1 - t);
      const clampedPercent = Math.max(0, Math.min(1, historicalPercent));

      points.push({
        x: padding + t * graphWidth,
        y: graphY + graphHeight - clampedPercent * graphHeight,
      });
    }
  }

  if (points.length === 0) return; // Nothing to draw

  // Draw filled area under the line
  const lineColor = tsColorToHex(getValueColor());
  const fillGradient = ctx.createLinearGradient(0, graphY, 0, graphY + graphHeight);
  if (isModern) {
    fillGradient.addColorStop(0, 'rgba(100, 181, 246, 0.35)');
    fillGradient.addColorStop(0.5, 'rgba(124, 77, 255, 0.18)');
    fillGradient.addColorStop(1, 'rgba(124, 77, 255, 0.02)');
  } else {
    fillGradient.addColorStop(0, lineColor + '60');
    fillGradient.addColorStop(1, lineColor + '10');
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, graphY + graphHeight);
  for (const point of points) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.lineTo(points[points.length - 1].x, graphY + graphHeight);
  ctx.closePath();
  ctx.fillStyle = fillGradient;
  ctx.fill();

  // Draw the line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = isModern ? '#64B5F6' : lineColor;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  applyNeonGlow(ctx, lineColor, 10);
  ctx.stroke();
  clearNeonGlow(ctx);

  // Draw current value dot with glow
  const lastPoint = points[points.length - 1];
  ctx.shadowColor = lineColor;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = lightenColor(lineColor, 30);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // Min/max labels on Y axis
  ctx.fillStyle = tsColorToHex(config.trim_color);
  ctx.font = getFontSpec(Math.max(7, graphHeight * 0.08));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(config.max.toFixed(0), padding + 2, graphY + 2);
  ctx.textBaseline = 'bottom';
  ctx.fillText(config.min.toFixed(0), padding + 2, graphY + graphHeight - 2);
};
