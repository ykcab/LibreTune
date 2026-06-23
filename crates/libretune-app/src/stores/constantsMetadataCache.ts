import { invoke } from '@tauri-apps/api/core';
import type { Constant } from '../components/dialogs/types';
import type { DialogDefinition } from '../components/dialogs/types';
import { getCachedPanelDefinition } from './panelDefinitionCache';

const metadataCache = new Map<string, Constant>();
const inflightBatches = new Map<string, Promise<void>>();

/** Incremented on clear — stale in-flight writes are ignored. */
let cacheGeneration = 0;

const BATCH_PREFETCH_TIMEOUT_MS = 12_000;

export function getCachedConstantMetadata(name: string): Constant | undefined {
  return metadataCache.get(name);
}

export function mergeCachedConstantMetadata(batch: Record<string, Constant>): void {
  let changed = false;
  for (const [name, info] of Object.entries(batch)) {
    if (metadataCache.get(name) !== info) {
      metadataCache.set(name, info);
      changed = true;
    }
  }
  if (changed) {
    queueMicrotask(() => {
      window.dispatchEvent(new Event('constants-metadata:updated'));
    });
  }
}

export function clearConstantMetadataCache(): void {
  cacheGeneration++;
  metadataCache.clear();
  inflightBatches.clear();
}

export function collectFieldNamesFromDefinition(def: DialogDefinition): string[] {
  return (def.components ?? [])
    .filter((c) => c.type === 'Field' && c.name)
    .map((c) => c.name!);
}

/** Collect field names from a dialog and any nested panels already in the panel cache. */
export function collectFieldNamesForDialogTree(def: DialogDefinition): string[] {
  const names = new Set(collectFieldNamesFromDefinition(def));
  for (const comp of def.components ?? []) {
    if (comp.type === 'Panel' && comp.name) {
      const nested = getCachedPanelDefinition(comp.name);
      if (nested) {
        for (const fieldName of collectFieldNamesFromDefinition(nested)) {
          names.add(fieldName);
        }
      }
    }
  }
  return [...names];
}

function batchKey(names: string[]): string {
  return names.slice().sort().join('\0');
}

/** One IPC round-trip for many fields; dedupes concurrent requests for the same name set. */
export async function prefetchConstantMetadata(names: string[]): Promise<void> {
  const uncached = names.filter((n) => !metadataCache.has(n));
  if (uncached.length === 0) return;

  const key = batchKey(uncached);
  const pending = inflightBatches.get(key);
  if (pending) {
    await pending;
    return;
  }

  const gen = cacheGeneration;
  const task = Promise.race([
    invoke<Record<string, Constant>>('get_constants_batch', { names: uncached }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('constants batch prefetch timed out')), BATCH_PREFETCH_TIMEOUT_MS);
    }),
  ])
    .then((batch) => {
      if (gen !== cacheGeneration) return;
      mergeCachedConstantMetadata(batch);
    })
    .catch((err) => {
      console.warn('[constantsMetadataCache] batch prefetch failed:', err);
    })
    .finally(() => {
      inflightBatches.delete(key);
    });

  inflightBatches.set(key, task);
  await task;
}

export async function prefetchFieldsForDefinition(def: DialogDefinition): Promise<void> {
  const names = collectFieldNamesFromDefinition(def);
  await prefetchConstantMetadata(names);
}

export async function prefetchFieldsForDialogTree(def: DialogDefinition): Promise<void> {
  const names = collectFieldNamesForDialogTree(def);
  await prefetchConstantMetadata(names);
}
