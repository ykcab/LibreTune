/**
 * Per-table generator helpers.
 *
 * TunerStudio lets you (re)generate a VE, ignition, or AFR/lambda table from
 * basic engine parameters directly inside that table's editor. These helpers
 * decide whether to OFFER that action for the open table and provide the
 * matching labels. The authoritative classifier lives in the Rust
 * `generate_table_values` command (which also consults the INI-derived table
 * role); this mirror only gates the UI affordance.
 */

export type GeneratableTableKind = "ve" | "ignition" | "afr";

// Mirrors the name lists used by the backend (see commands/apply_base_map.rs
// and commands/generate_table.rs). Kept in sync intentionally.
const VE_TABLE_NAMES = ["veTable1Tbl", "veTableTbl", "fuelTable1Tbl", "fuelTableTbl"];
const IGN_TABLE_NAMES = ["sparkTbl", "ignitionTableTbl", "advTable1Tbl", "ignitionTbl", "spark1Tbl"];
const AFR_TABLE_NAMES = ["afrTable1Tbl", "lambdaTableTbl", "afrTableTbl", "lambdaTable1Tbl"];

/**
 * Classify a table by its INI name or map name. Returns `null` for tables that
 * have no generator (e.g. boost, staging, warm-up curves).
 */
export function classifyGeneratableTable(
  nameOrMap: string | null | undefined,
): GeneratableTableKind | null {
  if (!nameOrMap) return null;
  if (VE_TABLE_NAMES.includes(nameOrMap)) return "ve";
  if (IGN_TABLE_NAMES.includes(nameOrMap)) return "ignition";
  if (AFR_TABLE_NAMES.includes(nameOrMap)) return "afr";
  return null;
}

/** Human-readable label for a generatable table kind. */
export function generatableTableLabel(kind: GeneratableTableKind): string {
  switch (kind) {
    case "ve":
      return "VE Table";
    case "ignition":
      return "Ignition Table";
    case "afr":
      return "AFR Target Table";
  }
}
