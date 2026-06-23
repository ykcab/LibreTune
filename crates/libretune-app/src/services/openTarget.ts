import { invoke } from "@tauri-apps/api/core";
import type { Tab } from "../components/tuner-ui";
import type { SimpleGaugeInfo } from "../components/curves/CurveEditor";
import type { DialogDefinition as RendererDialogDef } from "../components/dialogs/DialogRenderer";
import type { PinConfig } from "../components/hardware/PortEditor";
import { resolveEmbeddedPanelKind } from "../utils/resolveEmbeddedPanelKind";
import {
  type BackendTableData,
  type BackendCurveData,
  type IniCapabilities,
  type TabContent,
  toTunerTableData,
  toCurveData,
} from "../types/app";
import {
  cachePanelDefinition,
  deferPrefetchNestedPanels,
  fetchPanelDefinitionPriority,
  getCachedPanelDefinition,
} from "../stores/panelDefinitionCache";
import { prefetchFieldsForDefinition } from "../stores/constantsMetadataCache";

/** IPC budget for table/curve loads (panel cache uses its own timeout). */
const IPC_TIMEOUT_MS = 15_000;

export type OpenTargetKind = "Table" | "Dialog" | undefined;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${IPC_TIMEOUT_MS / 1000}s`)),
      IPC_TIMEOUT_MS,
    );
    promise
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

export interface OpenTargetDeps {
  tabs: Tab[];
  tabContents: Record<string, TabContent>;
  activeTabId: string | null;
  iniCapabilities: IniCapabilities | null;
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  setTabContents: React.Dispatch<React.SetStateAction<Record<string, TabContent>>>;
  setActiveTabId: (id: string) => void;
  setPortEditorAssignments: React.Dispatch<React.SetStateAction<Record<string, PinConfig[]>>>;
  showToast: (msg: string, kind?: "info" | "success" | "error" | "warning") => void;
}

function openTab(
  deps: OpenTargetDeps,
  id: string,
  title: string,
  icon: Tab["icon"],
  content: TabContent,
) {
  const { setTabs, setTabContents, setActiveTabId } = deps;
  setTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, title, icon }]));
  setTabContents((prev) => ({ ...prev, [id]: content }));
  setActiveTabId(id);
}

/** Remove a tab shell that failed to load (prevents perpetual "Loading…"). */
function removeTab(deps: OpenTargetDeps, name: string, fallbackActiveId = "dashboard") {
  deps.setTabContents((prev) => {
    const next = { ...prev };
    delete next[name];
    return next;
  });
  deps.setTabs((prev) => prev.filter((t) => t.id !== name));
  if (deps.activeTabId === name) {
    deps.setActiveTabId(fallbackActiveId);
  }
}

function resolveDialogTitle(
  name: string,
  title: string | undefined,
  def: RendererDialogDef,
): string {
  if (title && title !== name) return `${title} (${name})`;
  return def.title || title || name;
}

function displayTitleFor(name: string, title?: string): string {
  return title && title !== name ? `${title} (${name})` : title || name;
}

/** INI naming convention — avoids a failed dialog probe for *Tbl / *Table / *Curve targets. */
function heuristicTargetKind(name: string): "table" | "curve" | null {
  if (/Tbl$/i.test(name) || /Table$/i.test(name)) return "table";
  if (/Curve$/i.test(name) || /^scriptCurve/i.test(name)) return "curve";
  return null;
}

function tabHasLoadedContent(content: TabContent | undefined): boolean {
  if (!content?.data) return false;
  return content.type === "dialog" || content.type === "table" || content.type === "curve";
}

async function tryResolveEmbeddedKind(name: string): Promise<"table" | "curve" | null> {
  try {
    const kind = await withTimeout(resolveEmbeddedPanelKind(name), `Resolve ${name}`);
    if (kind === "table" || kind === "curve") return kind;
  } catch (err) {
    console.warn(`[openTarget] Could not resolve kind for '${name}':`, err);
  }
  return null;
}

async function loadTableIntoTab(
  deps: OpenTargetDeps,
  name: string,
  title?: string,
): Promise<boolean> {
  const data = await withTimeout(
    invoke<BackendTableData>("get_table_data", { tableName: name }),
    `Open table ${name}`,
  );
  const resolvedTitle = title && title !== name ? `${title} (${name})` : data.title || title || name;
  deps.setTabs((prev) =>
    prev.map((t) => (t.id === name ? { ...t, title: resolvedTitle, icon: "table" } : t)),
  );
  deps.setTabContents((prev) => ({
    ...prev,
    [name]: { type: "table", data: toTunerTableData(data) },
  }));
  return true;
}

async function openTableTarget(
  deps: OpenTargetDeps,
  name: string,
  title?: string,
  forceReload = false,
): Promise<boolean> {
  if (!forceReload) {
    let hasLoadedData = false;
    deps.setTabContents((prev) => {
      const existing = prev[name];
      hasLoadedData = existing?.type === "table" && !!existing.data;
      return prev;
    });
    if (hasLoadedData) {
      deps.setActiveTabId(name);
      return true;
    }
  }

  let tabExists = false;
  deps.setTabs((prev) => {
    tabExists = prev.some((t) => t.id === name);
    return prev;
  });

  if (!tabExists) {
    openTab(deps, name, displayTitleFor(name, title), "table", { type: "table" });
  } else {
    deps.setActiveTabId(name);
    deps.setTabContents((prev) => {
      const existing = prev[name];
      if (!forceReload && existing?.type === "table" && existing.data) return prev;
      return { ...prev, [name]: { type: "table" } };
    });
  }

  try {
    return await loadTableIntoTab(deps, name, title);
  } catch (err) {
    console.error(`[openTarget] Failed to open table '${name}':`, err);
    removeTab(deps, name);
    deps.showToast(`Could not open table "${title || name}"`, "warning");
    return false;
  }
}

async function loadCurveIntoTab(
  deps: OpenTargetDeps,
  name: string,
  title?: string,
): Promise<boolean> {
  const data = await withTimeout(
    invoke<BackendCurveData>("get_curve_data", { curveName: name }),
    `Open curve ${name}`,
  );
  const curveData = toCurveData(data);
  let gaugeInfo: SimpleGaugeInfo | null = null;
  if (data.gauge) {
    try {
      gaugeInfo = await invoke<SimpleGaugeInfo>("get_gauge_config", { gaugeName: data.gauge });
    } catch (gaugeErr) {
      console.warn(`[openTarget] Failed to load gauge '${data.gauge}':`, gaugeErr);
    }
  }
  const resolvedTitle = title && title !== name ? `${title} (${name})` : data.title || title || name;
  deps.setTabs((prev) =>
    prev.map((t) => (t.id === name ? { ...t, title: resolvedTitle, icon: "curve" } : t)),
  );
  deps.setTabContents((prev) => ({
    ...prev,
    [name]: { type: "curve", data: curveData, gauge: gaugeInfo },
  }));
  return true;
}

async function openCurveTarget(
  deps: OpenTargetDeps,
  name: string,
  title?: string,
  forceReload = false,
): Promise<boolean> {
  if (!forceReload) {
    let hasLoadedData = false;
    deps.setTabContents((prev) => {
      const existing = prev[name];
      hasLoadedData = existing?.type === "curve" && !!existing.data;
      return prev;
    });
    if (hasLoadedData) {
      deps.setActiveTabId(name);
      return true;
    }
  }

  let tabExists = false;
  deps.setTabs((prev) => {
    tabExists = prev.some((t) => t.id === name);
    return prev;
  });

  if (!tabExists) {
    openTab(deps, name, displayTitleFor(name, title), "curve", { type: "curve" });
  } else {
    deps.setActiveTabId(name);
    deps.setTabContents((prev) => {
      const existing = prev[name];
      if (!forceReload && existing?.type === "curve" && existing.data) return prev;
      return { ...prev, [name]: { type: "curve" } };
    });
  }

  try {
    return await loadCurveIntoTab(deps, name, title);
  } catch (err) {
    console.error(`[openTarget] Failed to open curve '${name}':`, err);
    removeTab(deps, name);
    deps.showToast(`Could not open curve "${title || name}"`, "warning");
    return false;
  }
}

async function loadDialogIntoTab(
  deps: OpenTargetDeps,
  name: string,
  title: string | undefined,
  highlightTerm?: string,
): Promise<RendererDialogDef | null> {
  // fetchPanelDefinitionPriority has its own timeout — no double-wrap here.
  const def = await fetchPanelDefinitionPriority(name);
  if (!def) return null;

  const resolvedTitle = resolveDialogTitle(name, title, def);
  deps.setTabs((prev) =>
    prev.map((t) => (t.id === name ? { ...t, title: resolvedTitle, icon: "dialog" } : t)),
  );
  deps.setTabContents((prev) => ({
    ...prev,
    [name]: { type: "dialog", data: def, highlightTerm },
  }));
  cachePanelDefinition(def.name, def);
  void prefetchFieldsForDefinition(def);
  deferPrefetchNestedPanels(def);
  return def;
}

async function openDialogTarget(
  deps: OpenTargetDeps,
  name: string,
  title?: string,
  highlightTerm?: string,
  forceReload = false,
): Promise<boolean> {
  if (!forceReload) {
    const cached = getCachedPanelDefinition(name);
    if (cached) {
      openTab(deps, name, resolveDialogTitle(name, title, cached), "dialog", {
        type: "dialog",
        data: cached,
        highlightTerm,
      });
      deferPrefetchNestedPanels(cached);
      return true;
    }

    let hasLoadedData = false;
    deps.setTabContents((prev) => {
      const existing = prev[name];
      hasLoadedData = existing?.type === "dialog" && !!existing.data;
      return prev;
    });
    if (hasLoadedData) {
      deps.setActiveTabId(name);
      return true;
    }
  }

  let tabExists = false;
  deps.setTabs((prev) => {
    tabExists = prev.some((t) => t.id === name);
    return prev;
  });

  if (!tabExists) {
    openTab(deps, name, displayTitleFor(name, title), "dialog", { type: "dialog", highlightTerm });
  } else {
    deps.setActiveTabId(name);
    deps.setTabContents((prev) => {
      const existing = prev[name];
      if (!forceReload && existing?.type === "dialog" && existing.data) return prev;
      return { ...prev, [name]: { type: "dialog", highlightTerm } };
    });
  }

  try {
    const def = await loadDialogIntoTab(deps, name, title, highlightTerm);
    if (!def) {
      removeTab(deps, name);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[openTarget] Failed to open dialog '${name}':`, err);
    removeTab(deps, name);
    return false;
  }
}

async function openWithKindFallbacks(
  deps: OpenTargetDeps,
  name: string,
  title?: string,
  highlightTerm?: string,
  forceReload = false,
): Promise<boolean> {
  if (await openDialogTarget(deps, name, title, highlightTerm, forceReload)) return true;

  const heuristic = heuristicTargetKind(name);
  if (heuristic === "table") {
    if (await openTableTarget(deps, name, title, forceReload)) return true;
  } else if (heuristic === "curve") {
    if (await openCurveTarget(deps, name, title, forceReload)) return true;
  }

  const embedded = await tryResolveEmbeddedKind(name);
  if (embedded === "table") {
    if (await openTableTarget(deps, name, title, forceReload)) return true;
  } else if (embedded === "curve") {
    if (await openCurveTarget(deps, name, title, forceReload)) return true;
  }

  return false;
}

export async function openTargetImpl(
  deps: OpenTargetDeps,
  name: string,
  title?: string,
  highlightTerm?: string,
  forceReload = false,
  targetKind?: OpenTargetKind,
  replaceCurrent = false,
): Promise<void> {
  const { iniCapabilities, showToast } = deps;

  // Built-in views — open immediately (no backend probe)
  if (name === "autotune") {
    openTab(deps, "autotune", "AutoTune", "autotune", { type: "autotune", data: "" });
    return;
  }
  if (name === "datalog") {
    if (!iniCapabilities?.has_datalog_entries && !iniCapabilities?.has_output_channels) {
      showToast("Data Logging is not available for this ECU definition.", "warning");
      return;
    }
    openTab(deps, "datalog", "Data Logging", "datalog", { type: "datalog" });
    return;
  }
  if (name === "console") {
    if (!iniCapabilities?.supports_console) {
      showToast("ECU Console is not available for this ECU definition.", "warning");
      return;
    }
    openTab(deps, "console", title || "ECU Console", "terminal", { type: "console" });
    return;
  }
  if (name === "lua-console") {
    showToast("Lua Console is not available for this ECU definition.", "warning");
    return;
  }
  if (name === "tooth-logger") {
    openTab(deps, "tooth-logger", title || "Tooth Logger", "scope", { type: "tooth-logger" });
    return;
  }
  if (name === "composite-logger") {
    openTab(deps, "composite-logger", title || "Composite Logger", "scope", { type: "composite-logger" });
    return;
  }
  if (name === "och-status") {
    openTab(deps, "och-status", title || "Output Channel Status", "dashboard", { type: "och-status" });
    return;
  }

  if (!forceReload) {
    let existingContent: TabContent | undefined;
    deps.setTabContents((prev) => {
      existingContent = prev[name];
      return prev;
    });
    if (existingContent && tabHasLoadedContent(existingContent)) {
      const kindMatches =
        !targetKind
        || (targetKind === "Table" && existingContent.type === "table")
        || (targetKind === "Dialog" && (existingContent.type === "dialog" || existingContent.type === "portEditor"));
      if (kindMatches) {
        deps.setActiveTabId(name);
        return;
      }
    }
  }

  // Hybrid: for replaceable content (dialogs), repurpose the current tab if appropriate.
  if (replaceCurrent && !forceReload) {
    const activeTab = deps.tabs.find((t) => t.id === deps.activeTabId);
    const activeContent = activeTab ? deps.tabContents[activeTab.id] : undefined;
    const isReplaceable =
      activeContent && (activeContent.type === "dialog" || activeContent.type === "portEditor");

    if (isReplaceable && activeTab && activeTab.id !== name) {
      const oldId = activeTab.id;
      deps.setTabs((prev) =>
        prev.map((t) =>
          t.id === oldId
            ? { ...t, id: name, title: displayTitleFor(name, title), icon: "dialog" as const }
            : t,
        ),
      );
      deps.setTabContents((prev) => {
        const next = { ...prev };
        delete next[oldId];
        next[name] = { type: "dialog", highlightTerm };
        return next;
      });
      deps.setActiveTabId(name);
      const def = await loadDialogIntoTab(deps, name, title, highlightTerm);
      if (!def) {
        removeTab(deps, name);
        showToast(`Could not open "${title || name}"`, "warning");
      }
      return;
    }
  }

  // Menu knows the target type — route directly (tables must not probe as dialogs first).
  if (targetKind === "Table") {
    if (!(await openTableTarget(deps, name, title, forceReload))) {
      showToast(`Could not open table "${title || name}"`, "warning");
    }
    return;
  }
  if (targetKind === "Dialog") {
    if (!(await openWithKindFallbacks(deps, name, title, highlightTerm, forceReload))) {
      showToast(`Could not open "${title || name}"`, "warning");
    }
    return;
  }

  const heuristic = heuristicTargetKind(name);
  if (heuristic === "table") {
    if (!(await openTableTarget(deps, name, title, forceReload))) {
      showToast(`Could not open table "${title || name}"`, "warning");
    }
    return;
  }
  if (heuristic === "curve") {
    if (!(await openCurveTarget(deps, name, title, forceReload))) {
      showToast(`Could not open curve "${title || name}"`, "warning");
    }
    return;
  }

  // Unknown kind (search, embedded panel link): lightweight table/curve probe before dialog.
  const embedded = await tryResolveEmbeddedKind(name);
  if (embedded === "table") {
    if (!(await openTableTarget(deps, name, title, forceReload))) {
      showToast(`Could not open table "${title || name}"`, "warning");
    }
    return;
  }
  if (embedded === "curve") {
    if (!(await openCurveTarget(deps, name, title, forceReload))) {
      showToast(`Could not open curve "${title || name}"`, "warning");
    }
    return;
  }

  if (!(await openWithKindFallbacks(deps, name, title, highlightTerm, forceReload))) {
    showToast(`Could not open "${title || name}"`, "warning");
  }
}
