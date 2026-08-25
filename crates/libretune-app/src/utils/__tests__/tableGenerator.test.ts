import { describe, it, expect } from "vitest";
import {
  classifyGeneratableTable,
  generatableTableLabel,
} from "../tableGenerator";

describe("classifyGeneratableTable", () => {
  it("classifies VE / fuel tables", () => {
    expect(classifyGeneratableTable("veTable1Tbl")).toBe("ve");
    expect(classifyGeneratableTable("veTableTbl")).toBe("ve");
    expect(classifyGeneratableTable("fuelTable1Tbl")).toBe("ve");
  });

  it("classifies ignition / spark tables", () => {
    expect(classifyGeneratableTable("sparkTbl")).toBe("ignition");
    expect(classifyGeneratableTable("ignitionTableTbl")).toBe("ignition");
    expect(classifyGeneratableTable("advTable1Tbl")).toBe("ignition");
  });

  it("classifies AFR / lambda target tables", () => {
    expect(classifyGeneratableTable("afrTable1Tbl")).toBe("afr");
    expect(classifyGeneratableTable("lambdaTableTbl")).toBe("afr");
  });

  it("returns null for non-generatable and empty inputs", () => {
    expect(classifyGeneratableTable("boostTbl")).toBeNull();
    expect(classifyGeneratableTable("stagingTable")).toBeNull();
    expect(classifyGeneratableTable("")).toBeNull();
    expect(classifyGeneratableTable(null)).toBeNull();
    expect(classifyGeneratableTable(undefined)).toBeNull();
  });
});

describe("generatableTableLabel", () => {
  it("labels each kind", () => {
    expect(generatableTableLabel("ve")).toBe("VE Table");
    expect(generatableTableLabel("ignition")).toBe("Ignition Table");
    expect(generatableTableLabel("afr")).toBe("AFR Target Table");
  });
});
