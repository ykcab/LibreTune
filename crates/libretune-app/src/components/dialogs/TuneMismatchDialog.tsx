import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Dialog, Button } from '../common';
import './TuneMismatchDialog.css';

export interface TuneMismatchInfo {
  ecu_pages: number[];
  project_pages: number[];
  diff_pages: number[];
}

interface TuneMismatchDialogProps {
  isOpen: boolean;
  mismatchInfo: TuneMismatchInfo | null;
  onClose: () => void;
  onUseProject: () => void;
  onUseECU: () => void;
}

interface TuneMismatchReadableEntry {
  name: string;
  label: string;
  kind: string;
  context?: string;
  project_value: string;
  ecu_value: string;
  units: string;
  changed_bytes: number;
}

interface TuneMismatchReadablePageDiff {
  page: number;
  total_entries: number;
  returned_entries: number;
  entries: TuneMismatchReadableEntry[];
}

export default function TuneMismatchDialog({
  isOpen,
  mismatchInfo,
  onClose,
  onUseProject,
  onUseECU,
}: TuneMismatchDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [pageDiff, setPageDiff] = useState<TuneMismatchReadablePageDiff | null>(null);
  const [isDiffLoading, setIsDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const sortedDiffPages = useMemo(
    () => [...(mismatchInfo?.diff_pages ?? [])].sort((a, b) => a - b),
    [mismatchInfo]
  );

  useEffect(() => {
    if (!isOpen) return;
    setSelectedPage(sortedDiffPages.length > 0 ? sortedDiffPages[0] : null);
  }, [isOpen, sortedDiffPages]);

  useEffect(() => {
    if (!isOpen || selectedPage === null) return;
    let cancelled = false;
    setIsDiffLoading(true);
    setDiffError(null);

    invoke<TuneMismatchReadablePageDiff>('get_tune_mismatch_page_readable_diff', {
      page: selectedPage,
      startIndex: 0,
      maxRows: 500,
    })
      .then((result) => {
        if (!cancelled) setPageDiff(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setPageDiff(null);
          setDiffError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setIsDiffLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedPage]);

  if (!isOpen || !mismatchInfo) return null;

  const handleUseProject = async () => {
    setIsLoading(true);
    try {
      await invoke('use_project_tune');
      onUseProject();
      onClose();
    } catch (err) {
      console.error('Failed to load project tune:', err);
      alert(`Failed to load project tune: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseECU = async () => {
    setIsLoading(true);
    try {
      await invoke('use_ecu_tune');
      onUseECU();
      onClose();
    } catch (err) {
      console.error('Failed to use ECU tune:', err);
      alert(`Failed to use ECU tune: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Tune Mismatch Detected"
      size="md"
      className="tune-mismatch-dialog"
      closeOnBackdrop={!isLoading}
      closeOnEscape={!isLoading}
    >
      <Dialog.Body>
        <div className="tune-mismatch-warning">
          <p>
            <strong>The tune on the ECU differs from the tune in your project.</strong>
          </p>
          <p>
            Detected external ECU changes are possible (for example, edits made in TunerStudio or
            another tool while LibreTune was not writing changes).
          </p>
          <p>
            The ECU has {mismatchInfo.ecu_pages.length} page(s) loaded, while your project has{' '}
            {mismatchInfo.project_pages.length} page(s).
            {mismatchInfo.diff_pages.length > 0 && (
              <> {mismatchInfo.diff_pages.length} page(s) have differences.</>
            )}
          </p>
        </div>

        <div className="tune-mismatch-diff">
          <div className="tune-mismatch-diff-header">
            <h3>Tune Diff (Project vs ECU)</h3>
            <p>Review changed settings before accepting which tune to keep.</p>
          </div>

          <div className="tune-mismatch-page-list">
            {sortedDiffPages.map((page) => (
              <button
                key={page}
                type="button"
                className={`tune-mismatch-page-chip ${selectedPage === page ? 'active' : ''}`}
                onClick={() => setSelectedPage(page)}
                disabled={isLoading}
              >
                Page {page}
              </button>
            ))}
          </div>

          <div className="tune-mismatch-diff-table-wrap">
            {isDiffLoading && <p className="tune-mismatch-diff-status">Loading diff...</p>}
            {!isDiffLoading && diffError && (
              <p className="tune-mismatch-diff-status error">{diffError}</p>
            )}
            {!isDiffLoading && !diffError && pageDiff && (
              <>
                <p className="tune-mismatch-diff-status">
                  Showing {pageDiff.returned_entries} of {pageDiff.total_entries} changed item(s)
                  on page {pageDiff.page}.
                </p>
                <table className="tune-mismatch-diff-table">
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th>Type</th>
                      <th>Project</th>
                      <th>ECU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageDiff.entries.map((row) => (
                      <tr key={row.name}>
                        <td className="tune-mismatch-setting-cell">
                          <div className="tune-mismatch-setting-label">{row.label}</div>
                          <div className="tune-mismatch-setting-name">{row.name}</div>
                          {row.context && (
                            <div className="tune-mismatch-setting-context">{row.context}</div>
                          )}
                        </td>
                        <td>{row.kind}</td>
                        <td>{row.units ? `${row.project_value} ${row.units}` : row.project_value}</td>
                        <td>{row.units ? `${row.ecu_value} ${row.units}` : row.ecu_value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>

        <div className="tune-mismatch-options">
          <div className="tune-option">
            <h3>Use Project Tune</h3>
            <p>
              Load the tune from your project file. This will overwrite the ECU tune with your
              saved project data.
            </p>
            <Button variant="primary" onClick={handleUseProject} disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Use Project Tune'}
            </Button>
          </div>

          <div className="tune-option">
            <h3>Use ECU Tune</h3>
            <p>
              Keep the tune currently on the ECU. Your project will be updated to match the ECU.
            </p>
            <Button variant="secondary" onClick={handleUseECU} disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Use ECU Tune'}
            </Button>
          </div>
        </div>
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="secondary" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
