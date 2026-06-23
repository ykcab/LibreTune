/**
 * BasicReadout painter — LCD-style digital numeric display.
 *
 * Migrated from the inline `drawBasicReadout` closure in
 * `TsGauge.tsx` as the first proof-of-concept for the per-painter
 * module pattern. Behavior is byte-for-byte identical to the original
 * closure.
 */

import { tsColorToRgba, tsColorToHex } from '../../dashboards/dashTypes';
import {
  roundRect,
  applyNeonGlow,
  clearNeonGlow,
  drawHudPanel,
  drawCompactTile,
  drawModernStatCard,
  isFramelessGauge,
} from '../drawUtils';
import type { Painter } from './types';

export const basicReadoutPainter: Painter = (pctx) => {
  const { ctx, width, height, value, config, legacyMode, bgImage, getValueColor, getFontSpec } = pctx;

  const style = config.gauge_style?.toLowerCase() ?? '';

  if (style === 'stat' && !(legacyMode && bgImage)) {
    drawModernStatCard(
      ctx,
      width,
      height,
      config.title,
      value,
      config.units,
      config.value_digits,
      tsColorToRgba(config.trim_color),
      tsColorToHex(getValueColor()),
      getFontSpec,
    );
    return;
  }

  const isCompact = style === 'compact' || style === 'command';

  if (isCompact && !(legacyMode && bgImage)) {
    drawCompactTile(
      ctx,
      width,
      height,
      config.title,
      value,
      config.units,
      config.value_digits,
      tsColorToRgba(config.trim_color),
      tsColorToHex(getValueColor()),
      getFontSpec,
    );
    return;
  }

  const padding = 8;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const cornerRadius = 3;

  const minDim = Math.min(width, height);
  const fontScale = 1 + (config.font_size_adjustment ?? 0) * 0.1;

  const useLegacyBackground = legacyMode && !!bgImage;
  if (useLegacyBackground && bgImage) {
    ctx.drawImage(bgImage, 0, 0, width, height);
  } else if (!isFramelessGauge(config.back_color)) {
    drawHudPanel(ctx, 0, 0, width, height, cornerRadius);

    // Inner LCD readout zone
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    roundRect(ctx, padding, padding + 2, innerWidth, innerHeight - 2, cornerRadius - 1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 181, 246, 0.12)';
    ctx.lineWidth = 1;
    roundRect(ctx, padding, padding + 2, innerWidth, innerHeight - 2, cornerRadius - 1);
    ctx.stroke();
  }

  const titleFontSize = Math.max(8, minDim * 0.1 * fontScale);
  const valueFontSize = Math.max(14, minDim * 0.34 * fontScale);
  const unitsFontSize = Math.max(8, minDim * 0.09 * fontScale);

  ctx.fillStyle = tsColorToRgba(config.trim_color);
  ctx.font = getFontSpec(titleFontSize, { bold: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(config.title.toUpperCase(), width / 2, padding + 3);

  const valueColor = getValueColor();
  const valueText = value.toFixed(config.value_digits);
  const valueHex = tsColorToHex(valueColor);

  applyNeonGlow(ctx, valueHex, valueColor !== config.font_color ? 14 : 6);
  ctx.fillStyle = tsColorToRgba(valueColor);
  ctx.font = getFontSpec(valueFontSize, { bold: true, monospace: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(valueText, width / 2, height / 2 + titleFontSize * 0.25);
  clearNeonGlow(ctx);

  ctx.fillStyle = tsColorToRgba(config.trim_color);
  ctx.font = getFontSpec(unitsFontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(config.units, width / 2, height - padding - 2);
};
