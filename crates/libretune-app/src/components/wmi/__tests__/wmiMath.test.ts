import { describe, expect, it } from 'vitest';
import {
  ccMinFromCollectedCc,
  mixtureDensityGPerCc,
  mixtureWaterMassFraction,
  modeledMixtureFlowGps,
  modeledWaterFlowGps,
  wfRatio,
} from '../wmiMath';

describe('WMI mixture math', () => {
  it('uses mass fraction, not volume fraction', () => {
    expect(mixtureDensityGPerCc(50)).toBeCloseTo(0.8955, 4);
    expect(mixtureWaterMassFraction(50)).toBeCloseTo(0.5583, 4);
    expect(mixtureWaterMassFraction(0)).toBeCloseTo(1, 6);
    expect(mixtureWaterMassFraction(100)).toBeCloseTo(0, 6);
  });

  it('models 250 cc/min at 50/50 and 100% duty', () => {
    expect(modeledMixtureFlowGps(250, 100, 50)).toBeCloseTo(3.731, 3);
    expect(modeledWaterFlowGps(250, 100, 50)).toBeCloseTo(2.083, 3);
  });

  it('scales modeled flow with duty', () => {
    expect(modeledMixtureFlowGps(250, 50, 50)).toBeCloseTo(1.866, 3);
    expect(modeledWaterFlowGps(250, 50, 50)).toBeCloseTo(1.042, 3);
  });

  it('treats 0 and out-of-range nozzle values as uncalibrated', () => {
    expect(modeledMixtureFlowGps(0, 100, 50)).toBe(0);
    expect(modeledMixtureFlowGps(2001, 100, 50)).toBe(0);
    expect(modeledMixtureFlowGps(-1, 100, 50)).toBe(0);
  });

  it('converts a 60 s jug result directly to cc/min', () => {
    expect(ccMinFromCollectedCc(250)).toBe(250);
    expect(ccMinFromCollectedCc(Number.NaN)).toBe(0);
    expect(ccMinFromCollectedCc(-5)).toBe(0);
  });

  it('returns no W/F without water or fuel flow', () => {
    expect(wfRatio(2, 10)).toBeCloseTo(0.2, 6);
    expect(wfRatio(0, 10)).toBeUndefined();
    expect(wfRatio(2, 0)).toBeUndefined();
  });
});
