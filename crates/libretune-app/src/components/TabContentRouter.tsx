import { Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import ErrorBoundary from "./common/ErrorBoundary";
import {
  TableEditor,
  type TableData as TunerTableData,
} from "./tuner-ui";
import { type CurveData } from "./curves/CurveEditor";
import PortEditor, { type PinConfig } from "./hardware/PortEditor";
import WelcomeView from "./WelcomeView";
import type {
  ConnectionStatus,
  CurrentProject,
  ProjectInfo,
  TabContent,
  PortEditorConfig,
} from "../types/app";
import type { Tab } from "./tuner-ui";
import { usePersistTableChange } from "../hooks/usePersistTableChange";
import {
  LazyTsDashboard,
  LazyAutoTune,
  LazyDataLogView,
  LazyDialogRenderer,
  LazyCurveEditor,
  LazyToothLoggerView,
  LazyCompositeLoggerView,
  LazyOutputChannelStatus,
  LazyEcuConsole,
  LazyLuaConsole,
  LazySettingsView,
  TabLoadingFallback,
  PendingDialogTab,
} from "./TabContentLazy";
import { type DialogDefinition as RendererDialogDef } from "./dialogs/DialogRenderer";
import { useConstantValuesStore } from "../stores/constantValuesStore";
import { isValidTableData } from "../utils/validateTableData";

export interface TabContentRouterProps {
  // Project / connection state
  currentProject: CurrentProject | null;
  availableProjects: ProjectInfo[];
  status: ConnectionStatus;
  ecuType: string;

  // Tab state
  activeTabId: string | null;
  tabs: Tab[];
  tabContents: Record<string, TabContent>;
  setTabContents: React.Dispatch<React.SetStateAction<Record<string, TabContent>>>;

  // Welcome view actions
  openProject: (path: string) => void | Promise<void>;
  setNewProjectDialogOpen: (open: boolean) => void;
  setConnectionDialogOpen: (open: boolean) => void;
  setImportProjectOpen: (open: boolean) => void;
  handleDeleteProject: (name: string) => void | Promise<void>;

  // Editor / dialog actions
  setBurnDialogOpen: (open: boolean) => void;
  handleTabClose: (id: string) => void;
  openTarget: (
    target: string,
    label?: string,
    highlightTerm?: string,
    forceReload?: boolean,
    targetKind?: "Table" | "Dialog",
  ) => void;
  scheduleMenuRefresh: (context?: Record<string, number>) => void;

  // Port editor
  portEditorAssignments: Record<string, PinConfig[]>;
  setPortEditorAssignments: React.Dispatch<React.SetStateAction<Record<string, PinConfig[]>>>;

  // Toast
  showToast: (msg: string, level?: "info" | "success" | "error" | "warning") => void;
}

/**
 * Routes the active tab's content to the appropriate editor/view component.
 * Extracted from App.tsx to reduce the god-component footprint.
 */
export function TabContentRouter(props: TabContentRouterProps) {
  const {
    currentProject,
    availableProjects,
    status,
    ecuType,
    activeTabId,
    tabs,
    tabContents,
    setTabContents,
    openProject,
    setNewProjectDialogOpen,
    setConnectionDialogOpen,
    setImportProjectOpen,
    handleDeleteProject,
    setBurnDialogOpen,
    handleTabClose,
    openTarget,
    scheduleMenuRefresh,
    portEditorAssignments,
    setPortEditorAssignments,
    showToast,
  } = props;

  const constantValues = useConstantValuesStore((s) => s.values);

  const persistTableChange = usePersistTableChange(
    (newData) => {
      if (!activeTabId) return;
      setTabContents((prev) => ({
        ...prev,
        [activeTabId]: { type: "table", data: newData },
      }));
    },
    (msg) => showToast(msg, "error"),
  );

  // If no project is open, show the welcome view
  if (!currentProject) {
    return (
      <WelcomeView
        projects={availableProjects}
        onOpenProject={(path) => openProject(path)}
        onNewProject={() => setNewProjectDialogOpen(true)}
        onConnect={() => setConnectionDialogOpen(true)}
        onImportTsProject={() => setImportProjectOpen(true)}
        onDeleteProject={handleDeleteProject}
      />
    );
  }

  if (!activeTabId) return null;
  const content = tabContents[activeTabId];
  if (!content) return null;

  switch (content.type) {
    case "dashboard":
      return (
        <Suspense fallback={<TabLoadingFallback />}>
          <LazyTsDashboard isConnected={status.state === "Connected"} />
        </Suspense>
      );
    case "table": {
      const tableData = content.data as TunerTableData | undefined;
      if (!tableData) {
        const activeTab = tabs.find((t) => t.id === activeTabId);
        return (
          <PendingDialogTab
            label={activeTab?.title || activeTabId}
            onRetry={() => openTarget(activeTabId, activeTab?.title, undefined, true, "Table")}
          />
        );
      }
      if (!isValidTableData(tableData)) {
        const activeTab = tabs.find((t) => t.id === activeTabId);
        return (
          <div className="tab-loading tab-loading--slow">
            <p>Table &ldquo;{activeTab?.title || activeTabId}&rdquo; has invalid or empty data.</p>
            <p className="tab-loading-hint">
              This can happen before ECU sync completes, or if the tune file is missing table values.
            </p>
            <button
              type="button"
              className="tab-loading-retry"
              onClick={() => openTarget(activeTabId, activeTab?.title, undefined, true, "Table")}
            >
              Retry
            </button>
          </div>
        );
      }
      return (
        <TableEditor
          data={tableData}
          onChange={persistTableChange}
          onBurn={() => setBurnDialogOpen(true)}
        />
      );
    }
    case "curve":
      return (
        <Suspense fallback={<TabLoadingFallback />}>
          <LazyCurveEditor
            data={content.data as CurveData}
            embedded={false}
            simpleGaugeInfo={content.gauge}
            onValuesChange={async (yBins) => {
              if (activeTabId) {
                const curveData = content.data as CurveData;
                const updatedData = { ...curveData, y_bins: yBins };
                setTabContents((prev) => ({
                  ...prev,
                  [activeTabId]: { type: "curve", data: updatedData, gauge: content.gauge },
                }));
                try {
                  await invoke("update_curve_data", {
                    curveName: curveData.name,
                    yValues: yBins,
                  });
                } catch (err) {
                  console.error("Failed to save curve data:", err);
                  showToast("Failed to save curve changes", "error");
                }
              }
            }}
            onBack={() => activeTabId && handleTabClose(activeTabId)}
          />
        </Suspense>
      );
    case "dialog": {
      const activeTab = tabs.find((t) => t.id === activeTabId);
      const dialogDef = content.data as RendererDialogDef | undefined;
      if (!dialogDef) {
        const tabLabel = activeTab?.title || activeTabId;
        return (
          <PendingDialogTab
            label={tabLabel}
            onRetry={() => openTarget(activeTabId, activeTab?.title, content.highlightTerm, true, "Dialog")}
          />
        );
      }
      return (
        <ErrorBoundary key={activeTabId}>
          <Suspense fallback={<TabLoadingFallback />}>
            <LazyDialogRenderer
              definition={dialogDef}
              onBack={() => activeTabId && handleTabClose(activeTabId)}
              openTable={(tableName) => openTarget(tableName, undefined, undefined, false, "Table")}
              context={constantValues}
              displayTitle={activeTab?.title}
              highlightTerm={content.highlightTerm}
              onOptimisticUpdate={(name, value) => {
                useConstantValuesStore.getState().patch(name, value);
              }}
              onUpdate={() => {
                scheduleMenuRefresh();
              }}
            />
          </Suspense>
        </ErrorBoundary>
      );
    }
    case "portEditor": {
      const portEditorMeta = content.data as PortEditorConfig | undefined;
      if (!portEditorMeta) return null;
      return (
        <PortEditor
          ecuType={ecuType}
          title={portEditorMeta.label || "Port Editor"}
          initialConfig={portEditorAssignments[portEditorMeta.name] || []}
          onSave={async (config) => {
            try {
              await invoke("save_port_editor_assignments", {
                name: portEditorMeta.name,
                assignments: config,
              });
              setPortEditorAssignments((prev) => ({ ...prev, [portEditorMeta.name]: config }));
              showToast("Port assignments saved", "success");
            } catch (err) {
              console.error("Failed to save port editor assignments:", err);
              showToast("Failed to save port assignments", "error");
            }
          }}
          onCancel={() => activeTabId && handleTabClose(activeTabId)}
        />
      );
    }
    case "settings":
      return (
        <Suspense fallback={<TabLoadingFallback />}>
          <LazySettingsView />
        </Suspense>
      );
    case "autotune":
      return (
        <Suspense fallback={<TabLoadingFallback />}>
          <LazyAutoTune
            tableName={(content.data as string) || ""}
            onClose={() => handleTabClose("autotune")}
          />
        </Suspense>
      );
    case "datalog":
      return (
        <Suspense fallback={<TabLoadingFallback />}>
          <LazyDataLogView />
        </Suspense>
      );
    case "tooth-logger":
      return (
        <Suspense fallback={<TabLoadingFallback />}>
          <LazyToothLoggerView onClose={() => handleTabClose("tooth-logger")} />
        </Suspense>
      );
    case "composite-logger":
      return (
        <Suspense fallback={<TabLoadingFallback />}>
          <LazyCompositeLoggerView onClose={() => handleTabClose("composite-logger")} />
        </Suspense>
      );
    case "och-status":
      return (
        <Suspense fallback={<TabLoadingFallback />}>
          <LazyOutputChannelStatus />
        </Suspense>
      );
    case "console":
      return (
        <Suspense fallback={<TabLoadingFallback />}>
          <LazyEcuConsole ecuType={ecuType} isConnected={status.state === "Connected"} />
        </Suspense>
      );
    case "lua-console":
      return (
        <Suspense fallback={<TabLoadingFallback />}>
          <LazyLuaConsole />
        </Suspense>
      );
    default:
      return null;
  }
}
