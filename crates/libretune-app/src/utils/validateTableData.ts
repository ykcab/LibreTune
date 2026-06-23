import type { TableData } from '../components/tuner-ui';

/** Returns true when table data is safe to render in TableEditor. */
export function isValidTableData(data: unknown): data is TableData {
  if (!data || typeof data !== 'object') return false;
  const t = data as TableData;
  if (!Array.isArray(t.xAxis) || t.xAxis.length === 0) return false;
  if (!Array.isArray(t.yAxis) || t.yAxis.length === 0) return false;
  if (!Array.isArray(t.zValues) || t.zValues.length !== t.yAxis.length) return false;
  for (const row of t.zValues) {
    if (!Array.isArray(row) || row.length !== t.xAxis.length) return false;
  }
  return true;
}
