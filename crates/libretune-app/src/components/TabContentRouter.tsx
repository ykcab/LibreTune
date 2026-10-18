import { invoke } from "@tauri-apps/api/core";
import { Suspense, lazy } from "react";
// Types only — erased at build time, so importing them from the barrel does not
// pull the module graph into the entry chunk.
import type { TableData as TunerTableData, Tab } from "./tuner-ui";
import type { DialogDefinition as RendererDialogDef } from "./dialogs/DialogRenderer";
import type { CurveData } from "./curves/CurveEditor";
import type { PinConfig } from "./hardware/PortEditor";
import type {
  ConnectionStatus,
  CurrentProject,
  IniCapabilities,
  ProjectInfo,
  TabContent,
  PortEditorConfig,
} from "../types/app";
import WelcomeView from "./WelcomeView";

/**
 * Every tab view is loaded on demand.
 *
 * The whole app used to ship as one 2.09 MiB chunk, so opening LibreTune parsed
 * three.js, the react-three bindings and the INI dialog renderer before the
 * first frame — features that live behind a click, and in the 3D table's case
 * behind a click most users never make. Each view is now its own chunk, fetched
 * the first time its tab is opened; the shell, the menus and the welcome screen
 * paint without any of them.
 */
const TableEditor = lazy(() =>
  import("./tuner-ui/TableEditor").then((m) => ({ default: m.TableEditor })),
);
const AutoTune = lazy(() =>
  import("./tuner-ui/AutoTune").then((m) => ({ default: m.AutoTune })),
);
const DataLogView = lazy(() =>
  import("./tuner-ui/DataLogView").then((m) => ({ default: m.DataLogView })),
);
const VirtualDynoView = lazy(() =>
  import("./tuner-ui/VirtualDynoView").then((m) => ({
    default: m.VirtualDynoView,
  })),
);
const DatalogViewer = lazy(() =>
  import("./tuner-ui/DatalogViewer").then((m) => ({
    default: m.DatalogViewer,
  })),
);
const TsDashboard = lazy(() => import("./dashboards/TsDashboard"));
const ToothLoggerView = lazy(() =>
  import("./diagnostics/ToothLoggerView").then((m) => ({
    default: m.ToothLoggerView,
  })),
);
const CompositeLoggerView = lazy(() =>
  import("./diagnostics/CompositeLoggerView").then((m) => ({
    default: m.CompositeLoggerView,
  })),
);
const OutputChannelStatus = lazy(() =>
  import("./diagnostics/OutputChannelStatus").then((m) => ({
    default: m.OutputChannelStatus,
  })),
);
const KnockSpectrogramView = lazy(() =>
  import("./diagnostics/KnockSpectrogramView").then((m) => ({
    default: m.KnockSpectrogramView,
  })),
);
const EcuConsole = lazy(() =>
  import("./console/EcuConsole").then((m) => ({ default: m.EcuConsole })),
);
const LuaConsole = lazy(() =>
  import("./console/LuaConsole").then((m) => ({ default: m.LuaConsole })),
);
const DialogRenderer = lazy(() => import("./dialogs/DialogRenderer"));
const CurveEditor = lazy(() => import("./curves/CurveEditor"));
const PortEditor = lazy(() => import("./hardware/PortEditor"));
const SettingsView = lazy(() =>
  import("./SettingsView").then((m) => ({ default: m.SettingsView })),
);

/**
 * Shown while a tab's chunk is in flight — a skeleton of the tab area rather
 * than a spinner, so the layout does not jump when the real view arrives.
 */
function TabSuspense() {
  return (
    <div className="tab-suspense" aria-busy="true" aria-label="Loading view">
      <div className="tab-suspense__bar tab-suspense__bar--short" />
      <div className="tab-suspense__bar" />
      <div className="tab-suspense__bar tab-suspense__bar--tiny" />
    </div>
  );
}

export interface TabContentRouterProps {
  // Project / connection state
  currentProject: CurrentProject | null;
  availableProjects: ProjectInfo[];
  status: ConnectionStatus;
  ecuType: string;
  iniCapabilities: IniCapabilities | null;

  // Tab state
  activeTabId: string | null;
  tabs: Tab[];
  tabContents: Record<string, TabContent>;
  setTabContents: (next: Record<string, TabContent>) => void;

  // Welcome view actions
  openProject: (path: string) => void | Promise<void>;
  setConnectEcuWizardOpen: (open: boolean) => void;
  setImportProjectOpen: (open: boolean) => void;
  handleDeleteProject: (name: string) => void | Promise<void>;

  // Editor / dialog actions
  setBurnDialogOpen: (open: boolean) => void;
  handleTabClose: (id: string) => void;
  openTarget: (target: string, label?: string) => void;
  fetchConstants: () => Promise<Record<string, number>>;
  fetchMenuTree: (context?: Record<string, number>) => Promise<void>;
  setConstantValues: React.Dispatch<
    React.SetStateAction<Record<string, number>>
  >;
  constantValues: Record<string, number>;

  // Port editor
  portEditorAssignments: Record<string, PinConfig[]>;
  setPortEditorAssignments: React.Dispatch<
    React.SetStateAction<Record<string, PinConfig[]>>
  >;

  // Toast
  showToast: (
    msg: string,
    level?: "info" | "success" | "error" | "warning",
  ) => void;
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
    iniCapabilities,
    activeTabId,
    tabs,
    tabContents,
    setTabContents,
    openProject,
    setConnectEcuWizardOpen,
    setImportProjectOpen,
    handleDeleteProject,
    setBurnDialogOpen,
    handleTabClose,
    openTarget,
    fetchConstants,
    fetchMenuTree,
    setConstantValues,
    constantValues,
    portEditorAssignments,
    setPortEditorAssignments,
    showToast,
  } = props;

  // If no project is open, show the welcome view
  if (!currentProject) {
    return (
      <WelcomeView
        projects={availableProjects}
        onOpenProject={(path) => openProject(path)}
        onNewProject={() => setConnectEcuWizardOpen(true)}
        onImportTsProject={() => setImportProjectOpen(true)}
        onDeleteProject={handleDeleteProject}
      />
    );
  }

  if (!activeTabId) return null;
  const content = tabContents[activeTabId];
  if (!content) return null;

  // One Suspense boundary for every tab view: the views are lazy, and the
  // boundary sits here so switching tabs swaps a skeleton for the real view
  // without unmounting the chrome around it.
  const renderView = (): React.ReactNode => {
    switch (content.type) {
      case "dashboard":
        return <TsDashboard isConnected={status.state === "Connected"} />;
      case "table":
        return (
          <TableEditor
            data={content.data as TunerTableData}
            onChange={(newData) => {
              if (activeTabId) {
                setTabContents({
                  ...tabContents,
                  [activeTabId]: { type: "table", data: newData },
                });
              }
            }}
            onBurn={() => setBurnDialogOpen(true)}
          />
        );
      case "curve":
        return (
          <CurveEditor
            data={content.data as CurveData}
            embedded={false}
            simpleGaugeInfo={content.gauge}
            onValuesChange={async (values) => {
              if (activeTabId) {
                const curveData = content.data as CurveData;
                const updatedData = {
                  ...curveData,
                  x_bins: values.xBins,
                  y_bins: values.yBins,
                };
                setTabContents({
                  ...tabContents,
                  [activeTabId]: {
                    type: "curve",
                    data: updatedData,
                    gauge: content.gauge,
                  },
                });
                try {
                  await invoke("update_curve_data", {
                    curveName: curveData.name,
                    xValues: values.xBins,
                    yValues: values.yBins,
                  });
                } catch (err) {
                  console.error("Failed to save curve data:", err);
                  showToast("Failed to save curve changes", "error");
                }
              }
            }}
            onBack={() => activeTabId && handleTabClose(activeTabId)}
          />
        );
      case "dialog": {
        const activeTab = tabs.find((t) => t.id === activeTabId);
        return (
          <DialogRenderer
            definition={content.data as RendererDialogDef}
            onBack={() => activeTabId && handleTabClose(activeTabId)}
            openTable={(tableName) => openTarget(tableName)}
            context={constantValues}
            displayTitle={activeTab?.title}
            highlightTerm={content.highlightTerm}
            onOptimisticUpdate={(name, value) => {
              // Immediately update the context so sibling fields re-evaluate their conditions
              setConstantValues((prev) => ({ ...prev, [name]: value }));
            }}
            onUpdate={async () => {
              const values = await fetchConstants();
              await fetchMenuTree(values);
              setConstantValues(values);
            }}
          />
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
                setPortEditorAssignments((prev) => ({
                  ...prev,
                  [portEditorMeta.name]: config,
                }));
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
        return <SettingsView />;
      case "autotune":
        return (
          <AutoTune
            tableName={(content.data as string) || ""}
            onClose={() => handleTabClose("autotune")}
            isConnected={status.state === "Connected"}
          />
        );
      case "datalog":
        return <DataLogView />;
      case "virtual-dyno":
        return <VirtualDynoView />;
      case "datalog-viewer":
        return (
          <DatalogViewer
            tableName={
              typeof content.data === "string" ? content.data : undefined
            }
            isConnected={status.state === "Connected"}
          />
        );
      case "tooth-logger":
        return (
          <ToothLoggerView onClose={() => handleTabClose("tooth-logger")} />
        );
      case "composite-logger":
        return (
          <CompositeLoggerView
            onClose={() => handleTabClose("composite-logger")}
          />
        );
      case "knock-spectrogram":
        return (
          <KnockSpectrogramView
            onClose={() => handleTabClose("knock-spectrogram")}
            isConnected={status.state === "Connected"}
          />
        );
      case "och-status":
        return <OutputChannelStatus />;
      case "console":
        return (
          <EcuConsole
            ecuType={ecuType}
            isConnected={status.state === "Connected"}
            dfuCommandName={iniCapabilities?.dfu_command_name ?? null}
          />
        );
      case "lua-console":
        return (
          <LuaConsole
            isConnected={status.state === "Connected"}
            luaScriptConstant={iniCapabilities?.lua_script_constant ?? null}
          />
        );
      default:
        return null;
    }
  };

  return <Suspense fallback={<TabSuspense />}>{renderView()}</Suspense>;
}
