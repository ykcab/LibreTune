import { useEffect, useRef } from "react";
import { subscribeTauri } from "../utils/subscribeTauri";
import type { SignatureMismatchInfo } from "../components/dialogs/SignatureMismatchDialog";
import type { TuneMismatchInfo } from "../components/dialogs/TuneMismatchDialog";

export interface BackendEventListenerDeps {
  setSignatureMismatchInfo: (info: SignatureMismatchInfo) => void;
  setSignatureMismatchOpen: (open: boolean) => void;
  setMigrationReportOpen: (open: boolean) => void;
  setTuneMismatchInfo: (info: TuneMismatchInfo) => void;
  setTuneMismatchOpen: (open: boolean) => void;
  checkStatus: () => void | Promise<void>;
}

/**
 * Registers simple backend event listeners that have minimal/no dependencies on
 * mutable component state. Each listener is registered once on mount and
 * unregistered on unmount.
 */
export function useBackendEventListeners(deps: BackendEventListenerDeps): void {
  const {
    setSignatureMismatchInfo,
    setSignatureMismatchOpen,
    setMigrationReportOpen,
    setTuneMismatchInfo,
    setTuneMismatchOpen,
    checkStatus,
  } = deps;

  // `checkStatus` is a plain (non-memoized) function on the App side that is
  // recreated every render. Hold the latest one in a ref (mirroring
  // useAutoConnect.ts) so the definition:loaded listener effect below doesn't
  // need it in its deps and isn't torn down/re-registered on every render.
  const checkStatusRef = useRef(checkStatus);
  checkStatusRef.current = checkStatus;

  useEffect(() => {
    return subscribeTauri<SignatureMismatchInfo>("signature:mismatch", (event) => {
      if (event.payload.match_type !== "mismatch") return;
      setSignatureMismatchInfo(event.payload);
      setSignatureMismatchOpen(true);
    });
  }, [setSignatureMismatchInfo, setSignatureMismatchOpen]);

  useEffect(() => {
    return subscribeTauri("tune:migration_needed", () => {
      setMigrationReportOpen(true);
    });
  }, [setMigrationReportOpen]);

  useEffect(() => {
    return subscribeTauri("definition:loaded", () => {
      checkStatusRef.current();
    });
  }, []);

  useEffect(() => {
    return subscribeTauri<TuneMismatchInfo>("tune:mismatch", (event) => {
      setTuneMismatchInfo(event.payload);
      setTuneMismatchOpen(true);
    });
  }, [setTuneMismatchInfo, setTuneMismatchOpen]);
}
