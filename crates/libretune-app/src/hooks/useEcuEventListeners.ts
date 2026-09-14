import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CurrentProject, ConnectionStatus } from "../types/app";
import { requestReconnect } from "../utils/connectionWorkflow";
import { subscribeTauri } from "../utils/subscribeTauri";
import { useRealtimeStore } from "../stores/realtimeStore";

export interface UseEcuEventListenersDeps {
  isTauri: boolean;
  status: ConnectionStatus;
  currentProject: CurrentProject | null;
  activeTabId: string | null;
  doSync: () => Promise<unknown>;
  checkStatus: () => Promise<void>;
  fetchConstants: () => Promise<Record<string, number>>;
  fetchMenuTree: (context?: Record<string, number>) => Promise<void>;
  showLoading: (msg: string) => void;
  hideLoading: () => void;
}

/**
 * Bundles app-level lifecycle/event listeners that don't belong to a more
 * specific concern: window title, active tab persistence, reconnect:request,
 * ini:changed, demo:changed.
 */
export function useEcuEventListeners(deps: UseEcuEventListenersDeps) {
  const {
    isTauri,
    status,
    currentProject,
    activeTabId,
    doSync,
    checkStatus,
    fetchConstants,
    fetchMenuTree,
    showLoading,
    hideLoading,
  } = deps;

  // `doSync`/`checkStatus`/`fetchConstants`/`fetchMenuTree` are plain
  // (non-memoized) functions on the App side, recreated every render. Hold
  // the latest ones in refs (mirroring useAutoConnect.ts) so the listener
  // effects below don't need them in their deps and aren't torn down/
  // re-registered on every render.
  const doSyncRef = useRef(doSync);
  doSyncRef.current = doSync;
  const checkStatusRef = useRef(checkStatus);
  checkStatusRef.current = checkStatus;
  const fetchConstantsRef = useRef(fetchConstants);
  fetchConstantsRef.current = fetchConstants;
  const fetchMenuTreeRef = useRef(fetchMenuTree);
  fetchMenuTreeRef.current = fetchMenuTree;
  const showLoadingRef = useRef(showLoading);
  showLoadingRef.current = showLoading;
  const hideLoadingRef = useRef(hideLoading);
  hideLoadingRef.current = hideLoading;
  const statusRef = useRef(status);
  statusRef.current = status;
  const currentProjectRef = useRef(currentProject);
  currentProjectRef.current = currentProject;

  // Update window title with project name
  useEffect(() => {
    const base = "LibreTune";
    if (currentProject) {
      const title = `${currentProject.name} — ${base}`;
      document.title = title;
      getCurrentWindow().setTitle(title).catch(() => {});
    } else {
      document.title = base;
      getCurrentWindow().setTitle(base).catch(() => {});
    }
  }, [currentProject]);

  // Persist active tab state
  useEffect(() => {
    if (activeTabId && currentProject) {
      invoke("update_setting", { key: "last_active_tab", value: activeTabId })
        .catch(e => console.warn("Failed to save last_active_tab", e));
    }
  }, [activeTabId, currentProject]);

  useEffect(() => {
    if (!isTauri) return;
    return subscribeTauri<string>("ini:changed", async (event) => {
      if (event.payload === "resync_required" && statusRef.current.state === "Connected") {
        showLoadingRef.current("Syncing with ECU...");
        try {
          await doSyncRef.current();
        } finally {
          hideLoadingRef.current();
        }
      }
    });
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    return subscribeTauri<string>("ecu:connection_lost", async (event) => {
      console.warn("ECU connection lost:", event.payload);
      useRealtimeStore.getState().clearChannels();
      await checkStatusRef.current();
      const project = currentProjectRef.current;
      if (project) {
        requestReconnect({
          source: "ecu-disconnect",
          delayMs: 1200,
          retries: 20,
          port: project.connection.port ?? undefined,
        });
      }
    });
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    return subscribeTauri("demo:changed", async (event) => {
      try {
        await checkStatusRef.current();
        const values = await fetchConstantsRef.current();
        await fetchMenuTreeRef.current(values);
        const demoEnabled = Boolean(event.payload as unknown as boolean);
        if (demoEnabled) {
          try { await invoke('start_realtime_stream', { intervalMs: 50 }); } catch { /* ignore */ }
        } else {
          try { await invoke('stop_realtime_stream'); } catch { /* ignore */ }
        }
      } catch (e) {
        console.error('Error handling demo:changed event', e);
      }
    });
  }, [isTauri]);
}
