import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { TableData as TunerTableData } from '../components/tuner-ui';

/**
 * Wraps table onChange to update UI state immediately and debounce backend persistence.
 */
export function usePersistTableChange(
  onChange: (newData: TunerTableData) => void,
  onError?: (message: string) => void,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  return useCallback((newData: TunerTableData) => {
    onChange(newData);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      invoke('update_table_data', {
        table_name: newData.name,
        z_values: newData.zValues,
      }).catch((err) => {
        console.error('Failed to save table data:', err);
        onError?.('Failed to save table changes');
      });
    }, 250);
  }, [onChange, onError]);
}
