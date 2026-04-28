/**
 * TS Gauge Renderer
 * 
 * Renders gauges based on TS GaugePainter types.
 * Uses canvas for all gauge rendering with high-quality visual effects.
 * Wrapped in React.memo with custom comparator for performance optimization.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { TsGaugeConfig, TsColor, tsColorToRgba, tsColorToHex } from '../dashboards/dashTypes';
import {
  roundRect,
  lightenColor,
  darkenColor,
  createMetallicGradient,
} from './drawUtils';
import {
  getEmbeddedImage as getCachedEmbeddedImage,
  isFontLoaded,
  loadEmbeddedAssets,
} from './assetCache';
import { useGaugeRenderer } from './useGaugeRenderer';
import {
  ensurePaintersRegistered,
  painterRegistry,
  type PainterContext,
} from './painters';

ensurePaintersRegistered();

interface TsGaugeProps {
  config: TsGaugeConfig;
  value: number;
  embeddedImages?: Map<string, string>;
  legacyMode?: boolean;
  /** When true, the value prop takes priority over the store subscription (sweep/demo mode) */
  overrideStore?: boolean;
}

/**
 * Internal TsGauge component - wrapped in React.memo below
 */
function TsGaugeInner({ config, value, embeddedImages, legacyMode = false, overrideStore = false }: TsGaugeProps) {
  const [fontsReady, setFontsReady] = useState(false);
  const [imagesReady, setImagesReady] = useState(false);

  // Load embedded fonts and images
  useEffect(() => {
    if (!embeddedImages) {
      setFontsReady(true);
      setImagesReady(true);
      return;
    }

    let cancelled = false;
    loadEmbeddedAssets(embeddedImages).then(() => {
      if (cancelled) return;
      setFontsReady(true);
      setImagesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [embeddedImages]);

  /** Get a loaded image by name or id */
  const getEmbeddedImage = useCallback(
    (name: string | null | undefined): HTMLImageElement | null => getCachedEmbeddedImage(name),
    [],
  );
  
  /** 
   * Get font family with web-safe fallbacks.
   * If the configured font is an embedded font ID, it will be used first,
   * followed by similar web-safe alternatives.
   */
  const getFontFamily = useCallback((preferMonospace = false): string => {
    const customFont = config.font_family;
    
    // Map common font names to web-safe stacks
    const webSafeStacks: Record<string, string> = {
      'Arial': 'Arial, Helvetica, sans-serif',
      'Arial Black': '"Arial Black", Gadget, sans-serif',
      'Verdana': 'Verdana, Geneva, sans-serif',
      'Tahoma': 'Tahoma, Geneva, sans-serif',
      'Trebuchet MS': '"Trebuchet MS", Helvetica, sans-serif',
      'Georgia': 'Georgia, serif',
      'Times New Roman': '"Times New Roman", Times, serif',
      'Courier New': '"Courier New", Courier, monospace',
      'Consolas': 'Consolas, Monaco, "Lucida Console", monospace',
      'Monaco': 'Monaco, Consolas, monospace',
    };
    
    const defaultStack = preferMonospace 
      ? '"Courier New", Consolas, Monaco, monospace'
      : 'Arial, Helvetica, sans-serif';
    
    if (!customFont) {
      return defaultStack;
    }
    
    // Check if it's a well-known font with a web-safe stack
    if (webSafeStacks[customFont]) {
      return webSafeStacks[customFont];
    }
    
    // If it's an embedded font (should be loaded), use it with fallbacks
    if (isFontLoaded(customFont)) {
      return preferMonospace 
        ? `"${customFont}", "Courier New", monospace`
        : `"${customFont}", Arial, sans-serif`;
    }
    
    // Unknown font - try it but add fallbacks
    return preferMonospace 
      ? `"${customFont}", "Courier New", Consolas, monospace`
      : `"${customFont}", Arial, Helvetica, sans-serif`;
  }, [config.font_family]);

  const getFontSpec = useCallback((
    size: number,
    options?: { bold?: boolean; monospace?: boolean }
  ): string => {
    const italic = config.italic_font ? 'italic ' : '';
    const bold = options?.bold ? 'bold ' : '';
    const monospace = options?.monospace ?? false;
    const adjustedSize = Math.max(1, size + (config.font_size_adjustment ?? 0));
    return `${italic}${bold}${adjustedSize}px ${getFontFamily(monospace)}`;
  }, [config.font_size_adjustment, config.italic_font, getFontFamily]);

  /** Get color based on value thresholds */
  const getValueColor = useCallback((): TsColor => {
    // Use != null to catch both null and undefined
    if (config.high_critical != null && displayValueRef.current >= config.high_critical) {
      return config.critical_color;
    }
    if (config.low_critical != null && displayValueRef.current <= config.low_critical) {
      return config.critical_color;
    }
    if (config.high_warning != null && displayValueRef.current >= config.high_warning) {
      return config.warn_color;
    }
    if (config.low_warning != null && displayValueRef.current <= config.low_warning) {
      return config.warn_color;
    }
    return config.font_color;
  }, [config]);

  /**
   * Per-frame painter dispatcher.
   *
   * Migrated painters live as pure top-level functions in
   * `gauges/painters/` and are looked up via `painterRegistry`.
   * Painters not yet migrated still live as inline `drawXxx`
   * closures in this file and are dispatched by the `switch` below.
   * The hook stores this callback in a ref, so swapping it across
   * renders does not restart the rAF loop.
   */
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, cssW: number, cssH: number, displayValue: number) => {
      const needleImage = getEmbeddedImage(config.needle_image_file_name);
      const bgImage = getEmbeddedImage(config.background_image_file_name);

      // 1. Try the registry first.
      const migrated = painterRegistry[config.gauge_painter];
      if (migrated) {
        const pctx: PainterContext = {
          ctx,
          width: cssW,
          height: cssH,
          value: displayValue,
          config,
          legacyMode,
          bgImage,
          needleImage,
          getValueColor,
          getFontSpec,
          getFontFamily,
          getEmbeddedImage,
        };
        migrated(pctx);
        return;
      }

      // 2. Fall back to inline closures for painters not yet migrated.
      switch (config.gauge_painter) {
        case 'AnalogGauge':
        case 'BasicAnalogGauge':
        case 'CircleAnalogGauge':
          drawAnalogGauge(ctx, cssW, cssH, needleImage, bgImage);
          break;
        case 'AnalogBarGauge':
          drawAnalogBarGauge(ctx, cssW, cssH);
          break;
        case 'AnalogMovingBarGauge':
          drawAnalogMovingBarGauge(ctx, cssW, cssH);
          break;
        default:
          // Unknown painter — fall back to the migrated BasicReadout.
          painterRegistry.BasicReadout?.({
            ctx,
            width: cssW,
            height: cssH,
            value: displayValue,
            config,
            legacyMode,
            bgImage,
            needleImage,
            getValueColor,
            getFontSpec,
            getFontFamily,
            getEmbeddedImage,
          });
      }
    },
    // The legacy painter closures close over `config`, helpers, and
    // `displayValueRef`; we only need to refresh `paint` when the
    // dispatch key or config-derived inputs change. The hook stores
    // the callback in a ref, so we don't pay an effect-restart cost.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, legacyMode, getEmbeddedImage, getValueColor, getFontSpec, getFontFamily],
  );

  const { canvasRef, displayValueRef } = useGaugeRenderer({
    config,
    value,
    overrideStore,
    enabled: fontsReady && imagesReady,
    paint,
  });

  /** Draw analog dial gauge with metallic bezel and improved visuals */
  const drawAnalogGauge = (
    ctx: CanvasRenderingContext2D, 
    width: number, 
    height: number,
    needleImage?: HTMLImageElement | null,
    bgImage?: HTMLImageElement | null
  ) => {
    // Enforce perfect circle: use the smaller of width/height, center in canvas
    const size = Math.min(width, height);
    // const pivotOffsetX = config.needle_pivot_offset_x ?? 0;
    // const pivotOffsetY = config.needle_pivot_offset_y ?? 0;
    const pivotOffsetX = 0;
    const pivotOffsetY = 0;
    const centerX = width / 2 + pivotOffsetX;
    const centerY = height / 2 + pivotOffsetY;
    const radius = size / 2 - 8;

    // Background - use image if available, otherwise use color
    if (bgImage) {
      // Center the image in the square area
      ctx.drawImage(bgImage, centerX - size / 2, centerY - size / 2, size, size);
    } else {
      ctx.fillStyle = tsColorToRgba(config.back_color);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Outer shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#333';
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Metallic bezel - outer ring
    const bezelWidth = config.border_width > 0
      ? Math.min(radius * 0.3, config.border_width)
      : Math.max(6, radius * 0.08);
    const bezelGradient = createMetallicGradient(ctx, centerX, centerY, radius + 2, radius - bezelWidth, config.trim_color);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.arc(centerX, centerY, radius - bezelWidth, 0, Math.PI * 2, true);
    ctx.fillStyle = bezelGradient;
    ctx.fill();

    // Inner bezel highlight
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - bezelWidth + 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Face background with subtle radial gradient
    const faceRadius = radius - bezelWidth - 2;
    const faceGradient = ctx.createRadialGradient(
      centerX - faceRadius * 0.3, centerY - faceRadius * 0.3, 0,
      centerX, centerY, faceRadius
    );
    const backHex = tsColorToHex(config.back_color);
    faceGradient.addColorStop(0, lightenColor(backHex, 15));
    faceGradient.addColorStop(0.7, backHex);
    faceGradient.addColorStop(1, darkenColor(backHex, 10));
    ctx.beginPath();
    ctx.arc(centerX, centerY, faceRadius, 0, Math.PI * 2);
    ctx.fillStyle = faceGradient;
    ctx.fill();

    // Calculate angles (TS uses degrees, canvas uses radians)
    // Use actual values from config, only fallback if truly undefined
    const startDeg = config.sweep_begin_degree ?? config.start_angle ?? 225;
    const sweepDeg = config.sweep_angle ?? 270;
    const ccw = config.counter_clockwise ?? false;
    
    // Convert to radians: TS angles are measured from 3 o'clock position,
    // canvas arc() measures from the positive x-axis (also 3 o'clock)
    // So we just need to convert degrees to radians
    const startAngle = startDeg * Math.PI / 180;
    const sweepAngle = sweepDeg * Math.PI / 180;
    const endAngle = ccw ? startAngle - sweepAngle : startAngle + sweepAngle;
    
    // Helper to calculate angle at a given percentage (0-1) along the sweep
    const angleAt = (percent: number) => ccw 
      ? startAngle - percent * sweepAngle 
      : startAngle + percent * sweepAngle;

    // Draw warning/critical zones as arcs (behind tick marks)
    const zoneRadius = faceRadius - 4;
    const zoneWidth = Math.max(4, faceRadius * 0.06);
    
    if (config.high_warning !== null) {
      const warnStartPercent = (config.high_warning - config.min) / (config.max - config.min);
      const warnStartAngle = angleAt(warnStartPercent);
      ctx.beginPath();
      ctx.arc(centerX, centerY, zoneRadius, warnStartAngle, endAngle, ccw);
      const warnHex = tsColorToHex(config.warn_color);
      ctx.strokeStyle = warnHex;
      ctx.lineWidth = zoneWidth;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }

    if (config.high_critical !== null) {
      const critStartPercent = (config.high_critical - config.min) / (config.max - config.min);
      const critStartAngle = angleAt(critStartPercent);
      ctx.beginPath();
      ctx.arc(centerX, centerY, zoneRadius, critStartAngle, endAngle, ccw);
      const critHex = tsColorToHex(config.critical_color);
      ctx.strokeStyle = critHex;
      ctx.lineWidth = zoneWidth;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }

    // Draw tick marks
    const tickRadius = faceRadius - Math.max(10, faceRadius * 0.12);
    const majorTicks = config.major_ticks > 0 ? config.major_ticks : (config.max - config.min) / 10;
    const numMajorTicks = Math.floor((config.max - config.min) / majorTicks) + 1;
    const minorTicksPerMajor = config.minor_ticks > 0 ? config.minor_ticks : 0;

    const cullLabels = radius < 70;
    const trimHex = tsColorToHex(config.trim_color);
    const fontHex = tsColorToHex(config.font_color);

    // Minor ticks
    ctx.strokeStyle = darkenColor(trimHex, 30);
    ctx.lineWidth = 1;
    if (minorTicksPerMajor > 0) {
      const totalMinorTicks = (numMajorTicks - 1) * minorTicksPerMajor;
      for (let i = 0; i < totalMinorTicks; i++) {
        if (i % minorTicksPerMajor === 0) continue;
        const tickPercent = i / totalMinorTicks;
        const tickAngle = angleAt(tickPercent);
        const innerRadius = tickRadius - (faceRadius * 0.05);
        ctx.beginPath();
        ctx.moveTo(centerX + Math.cos(tickAngle) * innerRadius, centerY + Math.sin(tickAngle) * innerRadius);
        ctx.lineTo(centerX + Math.cos(tickAngle) * tickRadius, centerY + Math.sin(tickAngle) * tickRadius);
        ctx.stroke();
      }
    }

    // Major ticks and labels
    ctx.strokeStyle = trimHex;
    ctx.fillStyle = fontHex;
    const fontSize = Math.max(8, faceRadius * 0.14);
    ctx.font = getFontSpec(fontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < numMajorTicks; i++) {
      const tickValue = config.min + i * majorTicks;
      const tickPercent = (tickValue - config.min) / (config.max - config.min);
      const tickAngle = angleAt(tickPercent);

      const innerRadius = tickRadius - (faceRadius * 0.10);
      ctx.beginPath();
      ctx.moveTo(centerX + Math.cos(tickAngle) * innerRadius, centerY + Math.sin(tickAngle) * innerRadius);
      ctx.lineTo(centerX + Math.cos(tickAngle) * tickRadius, centerY + Math.sin(tickAngle) * tickRadius);
      ctx.lineWidth = 2;
      ctx.stroke();

      const shouldDrawLabel = !cullLabels || (i === 0 || i === numMajorTicks - 1);
      if (shouldDrawLabel) {
        const labelRadius = tickRadius - (faceRadius * 0.22);
        ctx.fillText(
          tickValue.toFixed(config.label_digits),
          centerX + Math.cos(tickAngle) * labelRadius,
          centerY + Math.sin(tickAngle) * labelRadius
        );
      }
    }

    // Draw needle with shadow
    const valuePercent = (displayValueRef.current - config.min) / (config.max - config.min);
    const needleAngle = angleAt(valuePercent);
    // Use config.needle_length if present, otherwise use a visually correct default
    let needleLength: number;
    if (typeof config.needle_length === 'number' && config.needle_length > 0 && config.needle_length <= 1.5) {
      // If needle_length is a fraction (<=1.5), treat as percent of faceRadius
      needleLength = faceRadius * config.needle_length;
    } else if (typeof config.needle_length === 'number' && config.needle_length > 1.5) {
      // If needle_length is a pixel value
      needleLength = Math.min(faceRadius, config.needle_length);
    } else {
      // Default: 35% of faceRadius (shrink by 50%)
      needleLength = faceRadius * 0.35;
    }
    const needleWidth = Math.max(3, faceRadius * 0.04);

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(needleAngle);

    // Needle shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    if (needleImage) {
      // Draw custom needle image - center image at pivot, allow for config offset
      const imgWidth = needleImage.width;
      const imgHeight = needleImage.height;
      const scale = needleLength / imgWidth;
      // Optionally allow config offsets for image alignment
      const imgOffsetX = config.needle_image_offset_x ?? 0;
      const imgOffsetY = config.needle_image_offset_y ?? 0;
      ctx.drawImage(
        needleImage,
        -imgWidth * scale / 2 + imgOffsetX,
        -imgHeight * scale / 2 + imgOffsetY,
        imgWidth * scale,
        imgHeight * scale
      );
    } else {
      // Needle body with gradient, symmetric about pivot
      const needleGradient = ctx.createLinearGradient(0, -needleWidth, 0, needleWidth);
      const needleHex = tsColorToHex(config.needle_color);
      needleGradient.addColorStop(0, lightenColor(needleHex, 30));
      needleGradient.addColorStop(0.5, needleHex);
      needleGradient.addColorStop(1, darkenColor(needleHex, 20));

      ctx.beginPath();
      // Needle base at pivot (0,0), symmetric left/right
      ctx.moveTo(-needleLength * 0.08, -needleWidth);
      ctx.lineTo(needleLength, 0);
      ctx.lineTo(-needleLength * 0.08, needleWidth);
      ctx.closePath();
      ctx.fillStyle = needleGradient;
      ctx.fill();
    }
    ctx.shadowColor = 'transparent';

    // Needle center cap with metallic finish
    const capRadius = Math.max(6, faceRadius * 0.1);
    const capGradient = ctx.createRadialGradient(-capRadius * 0.3, -capRadius * 0.3, 0, 0, 0, capRadius);
    capGradient.addColorStop(0, '#aaaaaa');
    capGradient.addColorStop(0.5, '#666666');
    capGradient.addColorStop(1, '#444444');
    ctx.beginPath();
    ctx.arc(0, 0, capRadius, 0, Math.PI * 2);
    ctx.fillStyle = capGradient;
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();

    // Title with shadow (move up to avoid overlap)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 2;
    ctx.fillStyle = fontHex;
    ctx.font = getFontSpec(Math.max(9, faceRadius * 0.13), { bold: true });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(config.title, centerX, centerY + faceRadius * 0.25);
    ctx.shadowColor = 'transparent';

    // Value display with background (move down to avoid overlap)
    const valueFontSize = Math.max(11, faceRadius * 0.16);
    const valueText = `${displayValueRef.current.toFixed(config.value_digits)} ${config.units}`;
    ctx.font = getFontSpec(valueFontSize, { bold: true, monospace: true });
    const valueWidth = ctx.measureText(valueText).width;
    const valueY = centerY + faceRadius * 0.55;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    roundRect(ctx, centerX - valueWidth / 2 - 4, valueY - valueFontSize / 2 - 2, valueWidth + 8, valueFontSize + 4, 3);
    ctx.fill();
    ctx.fillStyle = fontHex;
    ctx.textBaseline = 'middle';
    ctx.fillText(valueText, centerX, valueY);
  };

  /** Draw analog bar gauge - semicircular bar indicator */
  const drawAnalogBarGauge = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const centerX = width / 2;
    const centerY = height * 0.85;
    const radius = Math.min(width, height) * 0.75;
    const barWidth = radius * 0.15;
    
    // Angle range: 180° arc from left to right
    const startAngle = Math.PI;
    const endAngle = 0;
    const totalSweep = Math.PI;
    
    // Background arc with metallic bezel
    const bezelGradient = createMetallicGradient(ctx, centerX, centerY, 0, radius + barWidth/2 + 8, config.trim_color);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + barWidth/2 + 4, startAngle, endAngle, false);
    ctx.arc(centerX, centerY, radius - barWidth/2 - 4, endAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = bezelGradient;
    ctx.fill();
    
    // Track background
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle, false);
    ctx.lineWidth = barWidth;
    ctx.strokeStyle = darkenColor(tsColorToHex(config.back_color), 30);
    ctx.lineCap = 'butt';
    ctx.stroke();
    
    // Calculate value angle
    const range = config.max - config.min;
    const normalizedValue = Math.max(0, Math.min(1, (displayValueRef.current - config.min) / range));
    const valueAngle = startAngle - (normalizedValue * totalSweep);
    
    // Value bar with gradient
    if (normalizedValue > 0) {
      const valueColorTs = getValueColor();
      const valueColorHex = tsColorToHex(valueColorTs);
      const barGradient = ctx.createLinearGradient(0, centerY - radius, width, centerY);
      barGradient.addColorStop(0, darkenColor(valueColorHex, 20));
      barGradient.addColorStop(0.5, valueColorHex);
      barGradient.addColorStop(1, lightenColor(valueColorHex, 20));
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, valueAngle, true);
      ctx.lineWidth = barWidth - 4;
      ctx.strokeStyle = barGradient;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    
    // Tick marks
    const tickCount = 10;
    ctx.strokeStyle = tsColorToHex(config.trim_color);
    ctx.lineWidth = 1;
    for (let i = 0; i <= tickCount; i++) {
      const tickAngle = startAngle - (i / tickCount) * totalSweep;
      const innerRadius = radius - barWidth/2 - 8;
      const outerRadius = radius - barWidth/2 - 15;
      const isMajor = i % 2 === 0;
      
      ctx.beginPath();
      ctx.moveTo(
        centerX + Math.cos(tickAngle) * (isMajor ? outerRadius : innerRadius + 3),
        centerY + Math.sin(tickAngle) * (isMajor ? outerRadius : innerRadius + 3)
      );
      ctx.lineTo(
        centerX + Math.cos(tickAngle) * innerRadius,
        centerY + Math.sin(tickAngle) * innerRadius
      );
      ctx.stroke();
    }
    
    // Value text in center
    const valueColorTs = getValueColor();
    ctx.fillStyle = tsColorToHex(valueColorTs);
    const fontSize = Math.max(12, radius * 0.2);
    ctx.font = getFontSpec(fontSize, { bold: true, monospace: true });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayValueRef.current.toFixed(config.value_digits), centerX, centerY - radius * 0.3);
    
    // Units below value
    if (config.units) {
      ctx.fillStyle = tsColorToHex(config.font_color);
      ctx.font = getFontSpec(fontSize * 0.5);
      ctx.fillText(config.units, centerX, centerY - radius * 0.1);
    }
    
    // Title at top
    if (config.title) {
      ctx.fillStyle = tsColorToHex(config.font_color);
      ctx.font = getFontSpec(fontSize * 0.5);
      ctx.textBaseline = 'top';
      ctx.fillText(config.title, centerX, 4);
    }
  };

  /** Draw analog moving bar gauge - sweeping needle with bar trail */
  const drawAnalogMovingBarGauge = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const centerX = width / 2;
    const centerY = height * 0.9;
    const radius = Math.min(width, height) * 0.8;
    const barWidth = radius * 0.08;
    
    // Angle range: 140° arc
    const startAngle = Math.PI + Math.PI * 0.2;
    const endAngle = -Math.PI * 0.2;
    const totalSweep = startAngle - endAngle;
    
    // Metallic bezel
    const bezelWidth = 6;
    const bezelGradient = createMetallicGradient(ctx, centerX, centerY, 0, radius + bezelWidth * 2, config.trim_color);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + bezelWidth, startAngle, endAngle, false);
    ctx.lineWidth = bezelWidth * 2;
    ctx.strokeStyle = bezelGradient;
    ctx.stroke();
    
    // Track background with inset shadow
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - barWidth, startAngle, endAngle, false);
    ctx.arc(centerX, centerY, radius - barWidth * 3, endAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = darkenColor(tsColorToHex(config.back_color), 40);
    ctx.fill();
    
    // Warning/danger zones
    const warnStart = config.high_warning ?? (config.min + (config.max - config.min) * 0.7);
    const dangerStart = config.high_critical ?? (config.min + (config.max - config.min) * 0.9);
    const range = config.max - config.min;
    
    // Draw zone arcs
    const drawZone = (startVal: number, endVal: number, color: string) => {
      const s = Math.max(0, Math.min(1, (startVal - config.min) / range));
      const e = Math.max(0, Math.min(1, (endVal - config.min) / range));
      const sAngle = startAngle - s * totalSweep;
      const eAngle = startAngle - e * totalSweep;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius - barWidth * 2, sAngle, eAngle, true);
      ctx.lineWidth = barWidth;
      ctx.strokeStyle = color;
      ctx.lineCap = 'butt';
      ctx.stroke();
    };
    
    drawZone(config.min, warnStart, tsColorToHex(config.font_color));
    drawZone(warnStart, dangerStart, tsColorToHex(config.warn_color));
    drawZone(dangerStart, config.max, tsColorToHex(config.critical_color));
    
    // Calculate value angle
    const normalizedValue = Math.max(0, Math.min(1, (displayValueRef.current - config.min) / range));
    const valueAngle = startAngle - normalizedValue * totalSweep;
    
    // Moving bar (filled from start to current value)
    const barColorTs = getValueColor();
    const barColorHex = tsColorToHex(barColorTs);
    const barGradient = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius);
    barGradient.addColorStop(0, lightenColor(barColorHex, 30));
    barGradient.addColorStop(1, barColorHex);
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - barWidth * 0.5, startAngle, valueAngle, true);
    ctx.lineWidth = barWidth * 0.8;
    ctx.strokeStyle = barGradient;
    ctx.lineCap = 'round';
    ctx.stroke();
    
    // Needle at current position
    const needleLength = radius * 0.85;
    const needleWidth = 4;
    
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(valueAngle);
    
    // Needle shadow
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    
    // Needle body
    ctx.beginPath();
    ctx.moveTo(needleLength, 0);
    ctx.lineTo(0, -needleWidth);
    ctx.lineTo(-needleLength * 0.1, 0);
    ctx.lineTo(0, needleWidth);
    ctx.closePath();
    
    const needleGradient = ctx.createLinearGradient(0, -needleWidth, 0, needleWidth);
    needleGradient.addColorStop(0, '#ff4444');
    needleGradient.addColorStop(0.5, '#ff0000');
    needleGradient.addColorStop(1, '#aa0000');
    ctx.fillStyle = needleGradient;
    ctx.fill();
    
    ctx.restore();
    
    // Center cap
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 4;
    const capGradient = ctx.createRadialGradient(centerX - 2, centerY - 2, 0, centerX, centerY, 12);
    capGradient.addColorStop(0, '#666666');
    capGradient.addColorStop(0.5, '#444444');
    capGradient.addColorStop(1, '#222222');
    ctx.beginPath();
    ctx.arc(centerX, centerY, 10, 0, Math.PI * 2);
    ctx.fillStyle = capGradient;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    
    // Value text
    const valueTextColorTs = getValueColor();
    ctx.fillStyle = tsColorToHex(valueTextColorTs);
    const fontSize = Math.max(14, radius * 0.18);
    ctx.font = getFontSpec(fontSize, { bold: true, monospace: true });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayValueRef.current.toFixed(config.value_digits), centerX, centerY - radius * 0.35);
    
    // Units
    if (config.units) {
      ctx.fillStyle = tsColorToHex(config.font_color);
      ctx.font = getFontSpec(fontSize * 0.6);
      ctx.fillText(config.units, centerX, centerY - radius * 0.18);
    }
    
    // Title
    if (config.title) {
      ctx.fillStyle = tsColorToHex(config.font_color);
      ctx.font = getFontSpec(fontSize * 0.5);
      ctx.textBaseline = 'top';
      ctx.fillText(config.title, centerX, 4);
    }
  };


  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    />
  );
}

/**
 * TsGauge - Memoized gauge component.
 * 
 * Uses custom comparator to skip re-renders when:
 * - Config hasn't changed
 * For live data, the internal store subscription drives the animation loop
 * directly (bypassing React rendering). The value prop only matters for
 * sweep/demo mode (when overrideStore is true).
 */
const TsGauge = React.memo(TsGaugeInner, (prevProps, nextProps) => {
  return (
    prevProps.value === nextProps.value &&
    prevProps.config === nextProps.config &&
    prevProps.embeddedImages === nextProps.embeddedImages &&
    prevProps.legacyMode === nextProps.legacyMode &&
    prevProps.overrideStore === nextProps.overrideStore
  );
});

export default TsGauge;
