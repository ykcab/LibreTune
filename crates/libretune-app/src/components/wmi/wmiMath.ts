/**
 * WMI mixture and nozzle math.
 *
 * Volume percent is not mass percent: methanol is 0.791 g/mL, so a 50/50 mix
 * is ~44% methanol by mass and ~56% water by mass. The ECU uses the water
 * fraction for the W/F readout; these helpers mirror that math for the
 * calibration wizard so the preview matches what the firmware will report.
 */

export const WATER_DENSITY_G_PER_CC = 1.0;
export const METHANOL_DENSITY_G_PER_CC = 0.791;
export const METHANOL_LATENT_HEAT_RATIO = 0.475;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** Density of the water-methanol mixture in g/cc. */
export function mixtureDensityGPerCc(methanolPct: number): number {
  const methanol = clamp(methanolPct, 0, 100) / 100;
  return (1 - methanol) * WATER_DENSITY_G_PER_CC
    + methanol * METHANOL_DENSITY_G_PER_CC;
}

/** Methanol mass fraction of the mixture. */
export function mixtureMethanolMassFraction(methanolPct: number): number {
  const density = mixtureDensityGPerCc(methanolPct);
  if (density <= 0) return 0;
  const methanol = clamp(methanolPct, 0, 100) / 100;
  return (methanol * METHANOL_DENSITY_G_PER_CC) / density;
}

/** Water mass fraction of the mixture. */
export function mixtureWaterMassFraction(methanolPct: number): number {
  return 1 - mixtureMethanolMassFraction(methanolPct);
}

/** Latent-heat capability relative to pure water (100 = water). */
export function mixtureCoolingRatio(methanolPct: number): number {
  return 1 - mixtureMethanolMassFraction(methanolPct) * (1 - METHANOL_LATENT_HEAT_RATIO);
}

/**
 * Modeled total mixture flow at a commanded duty.
 *
 * `nozzleCcMin` is the jug-test result: cc collected in 60 s at 100% duty.
 * Flow is assumed proportional to duty, matching the firmware model.
 */
export function modeledMixtureFlowGps(
  nozzleCcMin: number,
  dutyPct: number,
  methanolPct: number,
): number {
  if (!Number.isFinite(nozzleCcMin) || nozzleCcMin <= 0 || nozzleCcMin > 2000) {
    return 0;
  }
  const duty = clamp(dutyPct, 0, 100) / 100;
  return (nozzleCcMin * duty * mixtureDensityGPerCc(methanolPct)) / 60;
}

/** Modeled water mass flow at a commanded duty. */
export function modeledWaterFlowGps(
  nozzleCcMin: number,
  dutyPct: number,
  methanolPct: number,
): number {
  return modeledMixtureFlowGps(nozzleCcMin, dutyPct, methanolPct)
    * mixtureWaterMassFraction(methanolPct);
}

/** A 60 s jug test measures cc/min directly. */
export function ccMinFromCollectedCc(collectedCc: number): number {
  if (!Number.isFinite(collectedCc) || collectedCc < 0) return 0;
  return collectedCc;
}

/** Water/fuel mass ratio, or undefined when either side is not flowing. */
export function wfRatio(
  waterFlowGps: number,
  fuelFlowGps: number,
): number | undefined {
  if (!(waterFlowGps > 0) || !(fuelFlowGps > 0.01)) return undefined;
  return waterFlowGps / fuelFlowGps;
}
