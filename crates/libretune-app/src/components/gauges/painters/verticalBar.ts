/** VerticalBarGauge — vertical progress bar with tick marks and 3D gradient fill.
 *  `extra_attrs.lt_link_bar=1` → Link-style trough: blue fill, 0/100 labels, no chrome plate.
 */

import { tsColorToRgba, tsColorToHex } from '../../dashboards/dashTypes';
import { roundRect, lightenColor, darkenColor } from '../drawUtils';
import type { Painter } from './types';

export const verticalBarPainter: Painter = (pctx) => {
  const { ctx, width, height, value, config, getValueColor, getFontSpec } = pctx;

  if (config.extra_attrs?.lt_link_bar === '1') {
    paintLinkBar(pctx);
    return;
  }

  const padding = 6;
  const labelHeight = height * 0.12;
  const barWidth = width * 0.45;
  const barHeight = height - labelHeight * 2 - padding * 3;
  const barX = (width - barWidth) / 2;
  const barY = labelHeight + padding * 1.5;
  const cornerRadius = Math.min(4, barWidth * 0.15);

  const bgGradient = ctx.createLinearGradient(0, 0, width, 0);
  const bgHex = tsColorToHex(config.back_color);
  bgGradient.addColorStop(0, lightenColor(bgHex, 5));
  bgGradient.addColorStop(0.5, bgHex);
  bgGradient.addColorStop(1, darkenColor(bgHex, 10));
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 2;
  ctx.fillStyle = tsColorToRgba(config.trim_color);
  ctx.font = getFontSpec(Math.max(9, labelHeight * 0.75), { bold: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(config.title, width / 2, 3);
  ctx.shadowColor = 'transparent';

  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  const barBgGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
  barBgGradient.addColorStop(0, '#202020');
  barBgGradient.addColorStop(0.3, '#383838');
  barBgGradient.addColorStop(0.7, '#383838');
  barBgGradient.addColorStop(1, '#282828');
  ctx.fillStyle = barBgGradient;
  roundRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  const fillPercent = (value - config.min) / (config.max - config.min);
  const fillHeight = barHeight * Math.max(0, Math.min(1, fillPercent));
  if (fillHeight > 0) {
    const valueColor = getValueColor();
    const valueHex = tsColorToHex(valueColor);
    const fillGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    fillGradient.addColorStop(0, darkenColor(valueHex, 15));
    fillGradient.addColorStop(0.3, lightenColor(valueHex, 15));
    fillGradient.addColorStop(0.7, lightenColor(valueHex, 10));
    fillGradient.addColorStop(1, darkenColor(valueHex, 10));
    ctx.fillStyle = fillGradient;
    roundRect(ctx, barX, barY + barHeight - fillHeight, barWidth, fillHeight, cornerRadius);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(barX + 3, barY + barHeight - fillHeight + 2, barWidth * 0.35, fillHeight - 4);
  }

  ctx.strokeStyle = tsColorToRgba(config.trim_color);
  ctx.lineWidth = 1;
  roundRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
  ctx.stroke();

  const tickCount = 5;
  ctx.strokeStyle = tsColorToRgba(config.trim_color);
  ctx.lineWidth = 1;
  for (let i = 0; i <= tickCount; i++) {
    const tickY = barY + barHeight - (barHeight * i / tickCount);
    ctx.beginPath();
    ctx.moveTo(barX + barWidth + 2, tickY);
    ctx.lineTo(barX + barWidth + 6, tickY);
    ctx.stroke();
  }

  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 3;
  ctx.fillStyle = tsColorToRgba(config.font_color);
  ctx.font = getFontSpec(Math.max(11, labelHeight * 0.9), { bold: true, monospace: true });
  ctx.textBaseline = 'bottom';
  if (pctx.rightAlignValues) {
    // Fixed right edge — text grows leftward, no layout shift (issue #82).
    ctx.textAlign = 'right';
    ctx.fillText(`${value.toFixed(config.value_digits)}`, width - 4, height - 2);
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(`${value.toFixed(config.value_digits)}`, width / 2, height - 2);
  }
  ctx.shadowColor = 'transparent';
};

function paintLinkBar(pctx: Parameters<Painter>[0]) {
  const { ctx, width, height, value, config, getFontSpec } = pctx;
  const pad = Math.max(4, width * 0.06);
  const titleH = Math.max(16, height * 0.08);
  const valueH = Math.max(18, height * 0.08);
  const barW = Math.min(width * 0.42, 56);
  const barX = (width - barW) / 2;
  const barY = titleH + valueH + pad;
  const barH = height - barY - pad * 2;

  ctx.fillStyle = '#9aa0a6';
  ctx.font = getFontSpec(Math.max(11, titleH * 0.7), { bold: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(config.title || 'TP (Main)', width / 2, 2);

  const fillHex = tsColorToHex(config.needle_color);
  ctx.fillStyle = fillHex;
  ctx.font = getFontSpec(Math.max(13, valueH * 0.75), { bold: true });
  ctx.textBaseline = 'top';
  const unit = config.units ? ` ${config.units}` : '';
  ctx.fillText(`${value.toFixed(config.value_digits)}${unit}`, width / 2, titleH + 2);

  // Dark trough
  ctx.fillStyle = '#2a2d32';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.strokeStyle = 'rgba(180, 180, 180, 0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);

  const pct = Math.max(0, Math.min(1, (value - config.min) / (config.max - config.min)));
  const fillH = barH * pct;
  if (fillH > 0) {
    ctx.fillStyle = fillHex;
    ctx.fillRect(barX + 2, barY + barH - fillH, barW - 4, fillH);
  }

  // Scale labels + ticks (Link shows 0.0 … 100.0)
  ctx.fillStyle = '#b0b4b8';
  ctx.font = getFontSpec(Math.max(9, width * 0.14));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const labelX = barX + barW + 4;
  ctx.fillText(config.max.toFixed(1), labelX, barY);
  ctx.fillText(config.min.toFixed(1), labelX, barY + barH);

  ctx.strokeStyle = 'rgba(180, 180, 180, 0.5)';
  for (let i = 0; i <= 5; i++) {
    const y = barY + (barH * i) / 5;
    ctx.beginPath();
    ctx.moveTo(barX + barW, y);
    ctx.lineTo(barX + barW + 4, y);
    ctx.stroke();
  }
}
