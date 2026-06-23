/**
 * HorizontalBarGauge painter — horizontal progress bar with rounded
 * corners, gradient fill, and a value readout in the corner.
 *
 * Migrated from the inline `drawHorizontalBar` closure in
 * `TsGauge.tsx`. Behavior is byte-for-byte identical to the original.
 */

import { tsColorToRgba, tsColorToHex } from '../../dashboards/dashTypes';
import { roundRect, lightenColor, darkenColor, drawHudPanel, applyNeonGlow, clearNeonGlow, HUD_COLORS } from '../drawUtils';
import type { Painter } from './types';

export const horizontalBarPainter: Painter = (pctx) => {
  const { ctx, width, height, value, config, getValueColor, getFontSpec } = pctx;

  const padding = 8;
  const barHeight = height * 0.32;
  const barY = (height - barHeight) / 2 + height * 0.1;
  const barWidth = width - padding * 2;
  const cornerRadius = 2;

  drawHudPanel(ctx, 0, 0, width, height, 3);

  ctx.fillStyle = tsColorToRgba(config.trim_color);
  ctx.font = getFontSpec(Math.max(8, height * 0.12), { bold: true });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(config.title.toUpperCase(), padding, 5);

  ctx.fillStyle = HUD_COLORS.track;
  roundRect(ctx, padding, barY, barWidth, barHeight, cornerRadius);
  ctx.fill();
  ctx.strokeStyle = HUD_COLORS.trackEdge;
  ctx.lineWidth = 1;
  roundRect(ctx, padding, barY, barWidth, barHeight, cornerRadius);
  ctx.stroke();

  const fillPercent = (value - config.min) / (config.max - config.min);
  const fillWidth = barWidth * Math.max(0, Math.min(1, fillPercent));
  if (fillWidth > 0) {
    const valueColor = getValueColor();
    const valueHex = tsColorToHex(valueColor);
    applyNeonGlow(ctx, valueHex, 10);
    const fillGradient = ctx.createLinearGradient(padding, 0, padding + fillWidth, 0);
    fillGradient.addColorStop(0, darkenColor(valueHex, 10));
    fillGradient.addColorStop(0.5, valueHex);
    fillGradient.addColorStop(1, lightenColor(valueHex, 20));
    ctx.fillStyle = fillGradient;
    roundRect(ctx, padding, barY, fillWidth, barHeight, cornerRadius);
    ctx.fill();
    clearNeonGlow(ctx);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(padding + 1, barY + 1, fillWidth - 2, Math.max(2, barHeight * 0.25));
  }

  const valueHex = tsColorToHex(getValueColor());
  applyNeonGlow(ctx, valueHex, 6);
  ctx.fillStyle = tsColorToRgba(config.font_color);
  ctx.font = getFontSpec(Math.max(11, height * 0.17), { bold: true, monospace: true });
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`${value.toFixed(config.value_digits)} ${config.units}`, width - padding, 5);
  clearNeonGlow(ctx);
};
