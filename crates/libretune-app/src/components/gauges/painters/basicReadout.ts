/**
 * BasicReadout painter — LCD-style digital numeric display.
 *
 * Default: metallic/LCD frame. With `extra_attrs.lt_plain_readout=1` (or flat
 * transparent back + zero border), draws Link-style bare label + huge value.
 */

import { tsColorToRgba, tsColorToHex } from '../../dashboards/dashTypes';
import { roundRect, lightenColor, darkenColor } from '../drawUtils';
import type { Painter } from './types';

function isPlainReadout(config: {
  border_width: number;
  back_color: { alpha?: number };
  extra_attrs?: Record<string, string>;
}): boolean {
  if (config.extra_attrs?.lt_plain_readout === '1') return true;
  return config.border_width === 0 && (config.back_color.alpha ?? 255) === 0;
}

export const basicReadoutPainter: Painter = (pctx) => {
  const { ctx, width, height, value, config, legacyMode, bgImage, getValueColor, getFontSpec } = pctx;

  const padding = 6;
  const minDim = Math.min(width, height);
  const fontScale = 1 + (config.font_size_adjustment ?? 0) * 0.1;
  const valueColor = getValueColor();
  const valueText = value.toFixed(config.value_digits);

  if (isPlainReadout(config)) {
    const titleFontSize = Math.max(11, minDim * 0.14 * fontScale);
    const valueFontSize = Math.max(28, minDim * 0.52 * fontScale);
    const unitsFontSize = Math.max(10, minDim * 0.12 * fontScale);

    ctx.fillStyle = tsColorToRgba(config.trim_color);
    ctx.font = getFontSpec(titleFontSize);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(config.title, padding, padding);

    ctx.fillStyle = tsColorToRgba(valueColor);
    ctx.font = getFontSpec(valueFontSize, { bold: true });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(valueText, padding, height * 0.55);

    if (config.units) {
      ctx.fillStyle = tsColorToRgba(config.trim_color);
      ctx.font = getFontSpec(unitsFontSize);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(config.units, padding, height - padding);
    }
    return;
  }

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const cornerRadius = Math.min(8, width * 0.05);

  const useLegacyBackground = legacyMode && !!bgImage;
  if (useLegacyBackground && bgImage) {
    ctx.drawImage(bgImage, 0, 0, width, height);
  } else {
    const frameGradient = ctx.createLinearGradient(0, 0, width, height);
    frameGradient.addColorStop(0, '#555555');
    frameGradient.addColorStop(0.5, '#333333');
    frameGradient.addColorStop(1, '#222222');
    ctx.fillStyle = frameGradient;
    roundRect(ctx, 0, 0, width, height, cornerRadius);
    ctx.fill();

    const innerX = padding - 2;
    const innerY = padding - 2;
    const innerW = innerWidth + 4;
    const innerH = innerHeight + 4;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = tsColorToRgba(config.back_color);
    roundRect(ctx, innerX, innerY, innerW, innerH, cornerRadius - 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    const lcdGradient = ctx.createLinearGradient(padding, padding, padding, height - padding);
    const bgHex = tsColorToHex(config.back_color);
    lcdGradient.addColorStop(0, lightenColor(bgHex, 5));
    lcdGradient.addColorStop(1, darkenColor(bgHex, 10));
    ctx.fillStyle = lcdGradient;
    roundRect(ctx, padding, padding, innerWidth, innerHeight, cornerRadius - 2);
    ctx.fill();
  }

  const titleFontSize = Math.max(9, minDim * 0.12 * fontScale);
  const valueFontSize = Math.max(14, minDim * 0.35 * fontScale);
  const unitsFontSize = Math.max(8, minDim * 0.10 * fontScale);

  ctx.fillStyle = tsColorToRgba(config.trim_color);
  ctx.font = getFontSpec(titleFontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(config.title, width / 2, padding + 2);

  if (valueColor !== config.font_color) {
    ctx.shadowColor = tsColorToRgba(valueColor);
    ctx.shadowBlur = 8;
  }

  ctx.fillStyle = tsColorToRgba(valueColor);
  ctx.font = getFontSpec(valueFontSize, { bold: true, monospace: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(valueText, width / 2, height / 2 + titleFontSize * 0.3);
  ctx.shadowColor = 'transparent';

  ctx.fillStyle = tsColorToRgba(config.trim_color);
  ctx.font = getFontSpec(unitsFontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(config.units, width / 2, height - padding - 2);
};
