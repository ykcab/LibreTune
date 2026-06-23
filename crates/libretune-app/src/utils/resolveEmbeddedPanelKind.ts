import { invoke } from '@tauri-apps/api/core';

type PanelKind = 'table' | 'curve';

/** Heuristic when a name exists as both table and curve in the INI (rare). */
function preferTableOrCurve(name: string): PanelKind {
  if (/Curve$/i.test(name) || /^scriptCurve/i.test(name)) {
    return 'curve';
  }
  if (/Tbl$/i.test(name) || /Table$/i.test(name)) {
    return 'table';
  }
  return 'table';
}

/**
 * Decide whether an embedded panel name is a table or curve using lightweight
 * INI lookups (no data fetch). Curves are preferred when the name looks curve-like.
 */
export async function resolveEmbeddedPanelKind(name: string): Promise<PanelKind | null> {
  const [tableResult, curveResult] = await Promise.allSettled([
    invoke<{ name: string; title: string }>('get_table_info', { tableName: name }),
    invoke<{ name: string; title: string }>('get_curve_info', { curveName: name }),
  ]);

  const hasTable = tableResult.status === 'fulfilled';
  const hasCurve = curveResult.status === 'fulfilled';

  if (hasTable && hasCurve) {
    return preferTableOrCurve(name);
  }
  if (hasCurve) return 'curve';
  if (hasTable) return 'table';
  return null;
}
