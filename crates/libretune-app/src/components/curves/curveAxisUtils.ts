/**
 * Safe axis tick generation for curve charts.
 * Guards against zero/NaN step sizes that would freeze the UI in tight loops.
 */

export function safeAxisRange(
  min: number,
  max: number,
  fallbackSpan = 1,
): { min: number; max: number; span: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: fallbackSpan, span: fallbackSpan };
  }
  if (Math.abs(max - min) < 1e-9) {
    const pad = Math.max(Math.abs(min) * 0.1, fallbackSpan * 0.5, 0.5);
    return { min: min - pad, max: max + pad, span: pad * 2 };
  }
  return { min, max, span: max - min };
}

/** Build tick values from min→max with a bounded iteration count. */
export function buildAxisTickValues(min: number, max: number, targetTicks = 7): number[] {
  const { min: safeMin, max: safeMax, span } = safeAxisRange(min, max);
  if (span <= 0) return [safeMin];

  const roughStep = span / Math.max(1, targetTicks);
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(roughStep, 1e-9))));
  const frac = roughStep / pow10;
  let niceFrac = 1;
  if (frac >= 5) niceFrac = 5;
  else if (frac >= 2) niceFrac = 2;
  const step = niceFrac * pow10;
  if (!Number.isFinite(step) || step <= 0) {
    return [safeMin, safeMax];
  }

  const ticks: number[] = [];
  const start = Math.ceil(safeMin / step - 1e-9) * step;
  const maxTicks = 64;

  for (let i = 0; i < maxTicks; i++) {
    const v = start + i * step;
    if (v > safeMax + step * 0.001) break;
    ticks.push(v);
  }

  if (ticks.length === 0) {
    return [safeMin, safeMax];
  }
  return ticks;
}
