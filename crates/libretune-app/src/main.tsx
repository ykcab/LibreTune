import React, { useState, useEffect, lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { LoadingProvider } from "./contexts/LoadingContext";
import { ToastProvider } from "./contexts/ToastContext";
import { UnitPreferencesProvider } from "./contexts/useUnitPreferences";
import ErrorBoundary from "./components/common/ErrorBoundary";
import "./styles";
// Initialize i18next (side-effect: configures the global i18n instance).
// Must be imported before any component that calls `useTranslation()`.
import "./i18n";

const App = lazy(() => import("./App"));
const PopOutWindow = lazy(() => import("./PopOutWindow"));

function showBootError(message: string, detail?: string) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <div style="margin:1rem;padding:1rem;font-family:system-ui,sans-serif;color:#ffb4b4;background:#1a1a1a;border:1px solid #663333;border-radius:8px;max-width:720px">
      <h2 style="margin:0 0 0.5rem;color:#ff6b6b">LibreTune failed to start</h2>
      <p style="margin:0 0 0.75rem;color:#e0e0e0">${message}</p>
      ${detail ? `<pre style="margin:0;padding:0.75rem;overflow:auto;font-size:12px;color:#ffaaaa;background:#111;border-radius:4px">${detail}</pre>` : ""}
    </div>`;
}

window.addEventListener("error", (event) => {
  const detail = event.error?.stack || event.message;
  console.error("[boot] uncaught error:", event.error ?? event.message);
  showBootError("A script error prevented the app from loading.", detail);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const detail = reason instanceof Error ? reason.stack : String(reason);
  console.error("[boot] unhandled rejection:", reason);
  showBootError("A module failed to load during startup.", detail);
});

/**
 * Root component that determines whether to render App or PopOutWindow
 * based on the URL hash. Uses useEffect to ensure the hash is available
 * after the DOM is ready (fixes timing issue in Tauri WebviewWindow).
 */
function isPopOutHash(): boolean {
  return window.location.hash.startsWith("#/popout");
}

function Root() {
  const [isPopOut, setIsPopOut] = useState(isPopOutHash);

  useEffect(() => {
    const checkHash = () => {
      setIsPopOut(isPopOutHash());
    };

    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, []);

  // Show what we're rendering
  console.log('[main.tsx] Rendering:', isPopOut ? 'PopOutWindow' : 'App');

  return isPopOut ? (
    <ErrorBoundary>
      <Suspense fallback={<div style={{ padding: 20, color: 'white' }}>Loading…</div>}>
        <PopOutWindow />
      </Suspense>
    </ErrorBoundary>
  ) : (
    <ErrorBoundary>
      <Suspense fallback={<div style={{ padding: 20, color: 'white' }}>Loading…</div>}>
        <App />
      </Suspense>
    </ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LoadingProvider>
      <ToastProvider>
        <UnitPreferencesProvider>
          <Root />
        </UnitPreferencesProvider>
      </ToastProvider>
    </LoadingProvider>
  </React.StrictMode>,
);
