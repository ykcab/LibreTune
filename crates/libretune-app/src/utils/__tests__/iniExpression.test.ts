import { describe, expect, it } from "vitest";
import { evaluateIniBoolean } from "../iniExpression";

describe("evaluateIniBoolean", () => {
  it("evaluates comparisons", () => {
    expect(evaluateIniBoolean("fuelAlgorithm == 1", { fuelAlgorithm: 1 })).toBe(true);
    expect(evaluateIniBoolean("fuelAlgorithm == 1", { fuelAlgorithm: 0 })).toBe(false);
  });

  it("evaluates logical expressions", () => {
    expect(evaluateIniBoolean("nCylinders > 4 && useSequential == 1", { nCylinders: 6, useSequential: 1 })).toBe(true);
    expect(evaluateIniBoolean("nCylinders > 4 && useSequential == 1", { nCylinders: 4, useSequential: 1 })).toBe(false);
  });

  it("treats missing variables as zero", () => {
    expect(evaluateIniBoolean("unknownFlag == 1", {})).toBe(false);
  });

  it("evaluates bits() helper", () => {
    expect(evaluateIniBoolean("bits(flags, 4)", { flags: 5 })).toBe(true);
    expect(evaluateIniBoolean("bits(flags, 4)", { flags: 3 })).toBe(false);
  });
});
