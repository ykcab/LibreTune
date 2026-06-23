/**
 * Lazy-loaded tab views — keeps the initial bundle small.
 * Heavy or infrequently used editors are loaded on first tab open.
 */
import { lazy, useEffect, useState } from 'react';

export const LazyTsDashboard = lazy(() => import('./dashboards/TsDashboard'));
export const LazyAutoTune = lazy(() =>
  import('./tuner-ui/AutoTune').then((m) => ({ default: m.AutoTune })),
);
export const LazyDataLogView = lazy(() =>
  import('./tuner-ui/DataLogView').then((m) => ({ default: m.DataLogView })),
);
export const LazyDialogRenderer = lazy(() => import('./dialogs/DialogRenderer'));
export const LazyCurveEditor = lazy(() => import('./curves/CurveEditor'));
export const LazyToothLoggerView = lazy(() =>
  import('./diagnostics').then((m) => ({ default: m.ToothLoggerView })),
);
export const LazyCompositeLoggerView = lazy(() =>
  import('./diagnostics').then((m) => ({ default: m.CompositeLoggerView })),
);
export const LazyOutputChannelStatus = lazy(() =>
  import('./diagnostics').then((m) => ({ default: m.OutputChannelStatus })),
);
export const LazyEcuConsole = lazy(() =>
  import('./console/EcuConsole').then((m) => ({ default: m.EcuConsole })),
);
export const LazyLuaConsole = lazy(() =>
  import('./console/LuaConsole').then((m) => ({ default: m.LuaConsole })),
);
export const LazySettingsView = lazy(() =>
  import('./SettingsView').then((m) => ({ default: m.SettingsView })),
);

export function TabLoadingFallback() {
  return <div className="tab-loading">Loading…</div>;
}

export function PendingDialogTab({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [label]);

  if (!slow) {
    return <TabLoadingFallback />;
  }

  return (
    <div className="tab-loading tab-loading--slow">
      <p>Still loading {label}…</p>
      <p className="tab-loading-hint">The app may be busy loading other settings in the background.</p>
      <button type="button" className="tab-loading-retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
