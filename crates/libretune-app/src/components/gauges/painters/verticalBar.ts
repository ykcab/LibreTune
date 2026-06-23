/** VerticalBarGauge — vertical progress bar with tick marks and 3D gradient fill. */

import { tsColorToRgba, tsColorToHex } from '../../dashboards/dashTypes';
import { roundRect, lightenColor, drawHudPanel, applyNeonGlow, clearNeonGlow, HUD_COLORS } from '../drawUtils';
import type { Painter } from './types';

export const verticalBarPainter: Painter = (pctx) => {
  const { ctx, width, height, value, config, getValueColor, getFontSpec } = pctx;

  const padding = 8;
  const labelHeight = height * 0.11;
  const barWidth = width * 0.42;
  const barHeight = height - labelHeight * 2 - padding * 3;
  const barX = (width - barWidth) / 2;
  const barY = labelHeight + padding * 1.5;
  const cornerRadius = 2;

  drawHudPanel(ctx, 0, 0, width, height, 3);

  ctx.fillStyle = tsColorToRgba(config.trim_color);
  ctx.font = getFontSpec(Math.max(8, labelHeight * 0.7), { bold: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(config.title.toUpperCase(), width / 2, 5);

  ctx.fillStyle = HUD_COLORS.track;
  roundRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
  ctx.fill();
  ctx.strokeStyle = HUD_COLORS.trackEdge;
  ctx.lineWidth = 1;
  roundRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
  ctx.stroke();

  const fillPercent = (value - config.min) / (config.max - config.min);
  const fillHeight = barHeight * Math.max(0, Math.min(1, fillPercent));
  if (fillHeight > 0) {
    const valueColor = getValueColor();
    const valueHex = tsColorToHex(valueColor);
    applyNeonGlow(ctx, valueHex, 10);
    const fillGradient = ctx.createLinearGradient(barX, barY + barHeight - fillHeight, barX, barY + barHeight);
    fillGradient.addColorStop(0, lightenColor(valueHex, 15));
    fillGradient.addColorStop(1, valueHex);
    ctx.fillStyle = fillGradient;
    roundRect(ctx, barX, barY + barHeight - fillHeight, barWidth, fillHeight, cornerRadius);
    ctx.fill();
    clearNeonGlow(ctx);
  }

  const valueHex = tsColorToHex(getValueColor());
  applyNeonGlow(ctx, valueHex, 8);
  ctx.fillStyle = tsColorToRgba(getValueColor());
  ctx.font = getFontSpec(Math.max(12, labelHeight * 0.95), { bold: true, monospace: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(value.toFixed(config.value_digits), width / 2, height - 5);
  clearNeonGlow(ctx);
};
