import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';

/** `listen` that still unlistens if the caller tears down before the promise resolves. */
export function subscribeTauri<T>(
  event: string,
  handler: (event: Event<T>) => void,
): () => void {
  let unlisten: UnlistenFn | null = null;
  let dead = false;
  const take = (fn: UnlistenFn) => {
    if (dead) fn();
    else unlisten = fn;
  };
  try {
    const result = listen<T>(event, handler) as Promise<UnlistenFn> | UnlistenFn;
    if (typeof result === 'function') take(result);
    else result.then(take).catch(() => {});
  } catch {
    // non-Tauri / tests
  }
  return () => {
    dead = true;
    unlisten?.();
  };
}
