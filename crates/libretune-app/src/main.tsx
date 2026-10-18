import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { installWebviewConsoleCapture } from "./webviewConsoleCapture";
import App from "./App";
import PopOutWindow from "./PopOutWindow";
import { LoadingProvider } from "./contexts/LoadingContext";
import { ToastProvider } from "./contexts/ToastContext";
import { UnitPreferencesProvider } from "./contexts/useUnitPreferences";
// Initialize i18next (side-effect: configures the global i18n instance).
// Must be imported before any component that calls `useTranslation()`.
import "./i18n";

// Mirror webview console errors/warnings and uncaught errors into the Rust log
// so frontend failures are visible in session logs (see webviewConsoleCapture).
installWebviewConsoleCapture();

/**
 * Root component that determines whether to render App or PopOutWindow
 * based on the URL hash.
 *
 * The hash is read synchronously for the first render — a pop-out window is
 * told which tab it hosts before the page loads, so there is nothing to wait
 * for. The post-mount re-check is kept as insurance for the timing edge the
 * effect originally existed for; a `hashchange` still flips the branch.
 */
function Root() {
  const [isPopOut, setIsPopOut] = useState<boolean>(() =>
    window.location.hash.startsWith('#/popout'),
  );

  useEffect(() => {
    const checkHash = () => setIsPopOut(window.location.hash.startsWith('#/popout'));

    // Re-check once the DOM is ready, in case the hash was still settling.
    checkHash();

    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  return isPopOut ? <PopOutWindow /> : <App />;
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
