import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface ConstantValuesState {
  values: Record<string, number>;
  setAll: (values: Record<string, number>) => void;
  patch: (name: string, value: number) => void;
}

export const useConstantValuesStore = create<ConstantValuesState>()(
  subscribeWithSelector((set) => ({
    values: {},
    setAll: (values) => set({ values }),
    patch: (name, value) =>
      set((state) => {
        if (state.values[name] === value) return state;
        const next = { values: { ...state.values, [name]: value } };
        queueMicrotask(() => {
          window.dispatchEvent(new Event('constants:updated'));
        });
        return next;
      }),
  })),
);

/** Subscribe to a single constant — avoids re-rendering when unrelated values change. */
export function useConstantValue(name: string): number | undefined {
  return useConstantValuesStore((s) => s.values[name]);
}

export function getConstantValues(): Record<string, number> {
  return useConstantValuesStore.getState().values;
}
