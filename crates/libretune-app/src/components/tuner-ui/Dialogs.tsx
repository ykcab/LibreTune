import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, Check, FileText, Flame, Wrench, RotateCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Dialog, Button } from '../common';
import './Dialogs.css';

// =============================================================================
// Dialog Types
// =============================================================================

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TuneInfo {
  path: string | null;
  signature: string;
  modified: boolean;
  has_tune: boolean;
}

interface BuildInfo {
  version: string;
  build_id: string;
}

// =============================================================================
// Save Dialog
// =============================================================================

interface SaveDialogProps extends DialogProps {
  onSaved?: (path: string) => void;
  autoBurnOnClose?: boolean;
}

export function SaveDialog({ isOpen, onClose, onSaved, autoBurnOnClose }: SaveDialogProps) {
  const [tuneInfo, setTuneInfo] = useState<TuneInfo | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showBurnConfirm, setShowBurnConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      invoke<TuneInfo>('get_tune_info')
        .then(setTuneInfo)
        .catch((e) => setError(String(e)));
    }
  }, [isOpen]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      const path = await invoke<string>('save_tune', { path: null });
      onSaved?.(path);

      // Auto-burn on close with confirmation
      if (autoBurnOnClose) {
        setShowBurnConfirm(true);
      } else {
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSaving(false);
    }
  }, [onClose, onSaved, autoBurnOnClose]);

  // Handle burn after save with confirmation
  const handleBurnConfirm = useCallback(async () => {
    setShowBurnConfirm(false);
    try {
      await invoke('burn_to_ecu');
      onClose();
    } catch (e) {
      setError(String(e));
    }
  }, [onClose]);

  const handleBurnCancel = useCallback(() => {
    setShowBurnConfirm(false);
    onClose();
  }, [onClose]);

  const handleSaveAs = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      const selected = await save({
        title: 'Save Tune As',
        filters: [
          { name: 'MSQ Tune File', extensions: ['msq'] },
          { name: 'JSON Tune File', extensions: ['json'] },
        ],
        defaultPath: tuneInfo?.path || undefined,
      });
      
      if (selected) {
        const path = await invoke<string>('save_tune_as', { path: selected });
        onSaved?.(path);
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSaving(false);
    }
  }, [onClose, onSaved, tuneInfo]);

  if (!isOpen && !showBurnConfirm) return null;

  return (
    <>
      <Dialog
        open={isOpen}
        onClose={onClose}
        title="Save Tune"
        size="md"
        closeOnBackdrop={!isSaving}
      >
        <Dialog.Body>
          {error && <div className="dialog-error">{error}</div>}

          <div className="dialog-info">
            <p><strong>ECU:</strong> {tuneInfo?.signature || 'Unknown'}</p>
            {tuneInfo?.path && (
              <p><strong>Current File:</strong> {tuneInfo.path.split('/').pop()}</p>
            )}
            {tuneInfo?.modified && (
              <p className="dialog-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} /> Tune has unsaved changes
              </p>
            )}
          </div>

          <div className="dialog-help">
            <p>Save your tune to a file for backup or transfer.</p>
            <p><strong>MSQ format</strong> is compatible with other ECU tuning software.</p>
          </div>
        </Dialog.Body>

        <Dialog.Footer>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button variant="secondary" onClick={handleSaveAs} disabled={isSaving}>Save As...</Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={isSaving || !tuneInfo?.path}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </Dialog.Footer>
      </Dialog>

      {showBurnConfirm && (
        <Dialog
          open
          onClose={handleBurnCancel}
          title="Burn Tune to ECU?"
          size="sm"
        >
          <Dialog.Body>
            <p>Tune saved successfully. Would you like to burn it to the ECU now?</p>
            <p className="dialog-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} /> This will write to ECU memory and may take several seconds.
            </p>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="secondary" onClick={handleBurnCancel}>Cancel</Button>
            <Button variant="primary" onClick={handleBurnConfirm}>Burn to ECU</Button>
          </Dialog.Footer>
        </Dialog>
      )}
    </>
  );
}

// =============================================================================
// Load Dialog
// =============================================================================

interface LoadDialogProps extends DialogProps {
  onLoaded?: (tuneInfo: TuneInfo) => void;
}

export function LoadDialog({ isOpen, onClose, onLoaded }: LoadDialogProps) {
  const [tuneFiles, setTuneFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      invoke<string[]>('list_tune_files')
        .then(setTuneFiles)
        .catch((e) => setError(String(e)));
    }
  }, [isOpen]);

  const handleLoad = useCallback(async (path: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const info = await invoke<TuneInfo>('load_tune', { path });
      onLoaded?.(info);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [onClose, onLoaded]);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({
        title: 'Open Tune File',
        multiple: false,
        filters: [
          { name: 'Tune Files', extensions: ['msq', 'json'] },
          { name: 'MSQ Tune File', extensions: ['msq'] },
          { name: 'JSON Tune File', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      
      if (selected && typeof selected === 'string') {
        await handleLoad(selected);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [handleLoad]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Load Tune"
      size="lg"
      closeOnBackdrop={!isLoading}
    >
      <Dialog.Body>
        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-file-list">
          <div className="dialog-file-header">
            <span>Recent Tune Files</span>
            <Button variant="secondary" onClick={handleBrowse}>Browse...</Button>
          </div>

          {tuneFiles.length === 0 ? (
            <div className="dialog-empty">No tune files found in projects folder</div>
          ) : (
            <div className="dialog-files">
              {tuneFiles.map((file) => (
                <div
                  key={file}
                  className={`dialog-file-item ${selectedFile === file ? 'selected' : ''}`}
                  onClick={() => setSelectedFile(file)}
                  onDoubleClick={() => handleLoad(file)}
                >
                  <span className="dialog-file-icon"><FileText size={14} /></span>
                  <div className="dialog-file-info">
                    <span className="dialog-file-name">{file.split('/').pop()}</span>
                    <span className="dialog-file-path">{file}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="secondary" onClick={onClose} disabled={isLoading}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => selectedFile && handleLoad(selectedFile)}
          disabled={isLoading || !selectedFile}
        >
          {isLoading ? 'Loading...' : 'Load'}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}

// =============================================================================
// Burn Dialog
// =============================================================================

interface BurnDialogProps extends DialogProps {
  connected: boolean;
  onBurned?: () => void;
}

export function BurnDialog({ isOpen, onClose, connected, onBurned }: BurnDialogProps) {
  const [isBurning, setIsBurning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleBurn = useCallback(async () => {
    setIsBurning(true);
    setError(null);
    setSuccess(false);
    
    try {
      await invoke('burn_to_ecu');
      setSuccess(true);
      onBurned?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setIsBurning(false);
    }
  }, [onClose, onBurned]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Burn to ECU"
      size="md"
      closeOnBackdrop={!isBurning}
    >
      <Dialog.Body>
        {error && <div className="dialog-error">{error}</div>}
        {success && <div className="dialog-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={14} /> Burn completed successfully!</div>}

        {!connected ? (
          <div className="dialog-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} /> Not connected to ECU. Please connect first.
          </div>
        ) : (
          <div className="dialog-info">
            <p>This will write all changes from ECU RAM to flash memory.</p>
            <p><strong>Warning:</strong> This operation cannot be undone.</p>
            <p>Make sure your tune is tested before burning.</p>
          </div>
        )}
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="secondary" onClick={onClose} disabled={isBurning}>Cancel</Button>
        <Button
          variant="danger"
          onClick={handleBurn}
          disabled={isBurning || !connected}
        >
          {isBurning ? 'Burning...' : <><Flame size={14} /> Burn to ECU</>}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}

// =============================================================================
// New Tune Dialog
// =============================================================================

interface NewTuneDialogProps extends DialogProps {
  onCreated?: () => void;
}

export function NewTuneDialog({ isOpen, onClose, onCreated }: NewTuneDialogProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    try {
      await invoke('new_tune');
      onCreated?.();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setIsCreating(false);
    }
  }, [onClose, onCreated]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="New Tune"
      size="sm"
      closeOnBackdrop={!isCreating}
    >
      <Dialog.Body>
        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-info">
          <p>Create a new tune file for the currently loaded ECU definition.</p>
          <p>Any unsaved changes to the current tune will be lost.</p>
        </div>
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="secondary" onClick={onClose} disabled={isCreating}>Cancel</Button>
        <Button variant="primary" onClick={handleCreate} disabled={isCreating}>
          {isCreating ? 'Creating...' : 'Create New Tune'}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}

// =============================================================================
// Settings Dialog
// =============================================================================

// SettingsDialog has been extracted to ./dialogs/SettingsDialog.tsx
export { SettingsDialog } from './dialogs/SettingsDialog';

// =============================================================================
// About Dialog
// =============================================================================

export function AboutDialog({ isOpen, onClose }: DialogProps) {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    invoke<BuildInfo>('get_build_info')
      .then(setBuildInfo)
      .catch(() => setBuildInfo(null));
  }, [isOpen]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="About LibreTune"
      size="sm"
    >
      <Dialog.Body className="dialog-about">
        <div className="dialog-about-logo"><Wrench size={48} /></div>
        <h3>LibreTune</h3>
        <p className="dialog-version">
          Version {buildInfo?.version ?? 'unknown'}
        </p>
        <p className="dialog-build">
          Build {buildInfo?.build_id ?? 'unknown'}
        </p>

        <p>Open-source ECU tuning software compatible with standard INI definition files.</p>

        <div className="dialog-about-links">
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); openUrl('https://github.com/RallyPat/LibreTune'); }}
          >
            GitHub
          </a>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); openUrl('https://github.com/RallyPat/LibreTune/tree/main/docs'); }}
          >
            Documentation
          </a>
        </div>

        <p className="dialog-license">
          Licensed under GPL-2.0
        </p>
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </Dialog.Footer>
    </Dialog>
  );
}

// =============================================================================
// Connection Dialog
// =============================================================================

interface ConnectionDialogProps extends DialogProps {
  ports: string[];
  selectedPort: string;
  baudRate: number;
  timeoutMs: number;
  // Connection type and TCP settings
  connectionType?: 'Serial' | 'Tcp';
  onConnectionTypeChange?: (type: 'Serial' | 'Tcp') => void;
  tcpHost?: string;
  onTcpHostChange?: (host: string) => void;
  tcpPort?: number;
  onTcpPortChange?: (port: number) => void;
  
  connected: boolean;
  connecting: boolean;
  onPortChange: (port: string) => void;
  onBaudChange: (baud: number) => void;
  onTimeoutChange: (timeoutMs: number) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefreshPorts: () => void;
  statusMessage?: string;
  iniDefaults?: {
    default_baud_rate: number;
    timeout_ms: number;
    inter_write_delay: number;
    delay_after_port_open: number;
    message_envelope_format?: string | null;
    page_activation_delay: number;
  };
  onApplyIniDefaults?: () => void;
  runtimePacketMode?: 'Auto'|'ForceBurst'|'ForceOCH'|'Disabled';
  onRuntimePacketModeChange?: (mode: 'Auto'|'ForceBurst'|'ForceOCH'|'Disabled') => void;
}

export function ConnectionDialog({ 
  isOpen, 
  onClose,
  ports,
  selectedPort,
  baudRate,
  timeoutMs,
  connectionType = 'Serial', // Default to Serial if not provided
  onConnectionTypeChange,
  tcpHost = '127.0.0.1',
  onTcpHostChange,
  tcpPort = 29001,
  onTcpPortChange,
  connected,
  connecting,
  onPortChange,
  onBaudChange,
  onTimeoutChange,
  onConnect,
  onDisconnect,
  onRefreshPorts,
  statusMessage,
  iniDefaults,
  onApplyIniDefaults,
  runtimePacketMode,
  onRuntimePacketModeChange,
}: ConnectionDialogProps) {
  // Track previous connected state to detect connection transitions
  const prevConnectedRef = useRef<boolean>(false);

  // Auto-close dialog when connection succeeds
  useEffect(() => {
    // Check if we just transitioned from disconnected/connecting to connected
    if (connected && !prevConnectedRef.current && !connecting) {
      // Close the dialog after successful connection
      onClose();
    }
    // Update the previous state
    prevConnectedRef.current = connected;
  }, [connected, connecting, onClose]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="ECU Connection"
      size="md"
      closeOnBackdrop={!connecting}
    >
      <Dialog.Body>
          <div className="dialog-form-group">
            <label>Connection Mode</label>
            <div className="dialog-row radio-group" style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '10px' }}>
                <label className="radio-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: connected ? 'default' : 'pointer' }}>
                  <input
                    type="radio"
                    checked={connectionType === 'Serial'}
                    onChange={() => onConnectionTypeChange?.('Serial')}
                    disabled={connected}
                  />
                  <span>Serial / USB</span>
                </label>
                <label className="radio-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: connected ? 'default' : 'pointer' }}>
                  <input
                    type="radio"
                    checked={connectionType === 'Tcp'}
                    onChange={() => onConnectionTypeChange?.('Tcp')}
                    disabled={connected}
                  />
                  <span>TCP / WiFi (Sim)</span>
                </label>
            </div>
          </div>
          
          {connectionType === 'Serial' ? (
            <>
              <div className="dialog-form-group">
                <label>Serial Port</label>
                <div className="dialog-port-row">
                  <select 
                    value={selectedPort} 
                    onChange={(e) => onPortChange(e.target.value)}
                    disabled={connected}
                  >
                    {ports.length === 0 ? (
                      <option value="">No ports found</option>
                    ) : (
                      ports.map((port) => (
                        <option key={port} value={port}>{port}</option>
                      ))
                    )}
                  </select>
                  <button onClick={onRefreshPorts} disabled={connected}>
                    <RotateCw size={14} /> Refresh
                  </button>
                </div>
              </div>
              
              <div className="dialog-form-group">
                <label>Baud Rate</label>
                <select 
                  value={baudRate} 
                  onChange={(e) => onBaudChange(Number(e.target.value))}
                  disabled={connected}
                >
                  <option value={115200}>115200</option>
                  <option value={57600}>57600</option>
                  <option value={38400}>38400</option>
                  <option value={19200}>19200</option>
                  <option value={9600}>9600</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="dialog-form-group">
                <label>Host Address</label>
                <input
                  type="text"
                  className="dialog-input"
                  style={{ width: '100%', padding: '8px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px' }}
                  value={tcpHost}
                  onChange={(e) => onTcpHostChange?.(e.target.value)}
                  disabled={connected}
                  placeholder="localhost"
                />
              </div>
              <div className="dialog-form-group">
                <label>TCP Port</label>
                <input
                  type="number"
                  className="dialog-input"
                  style={{ width: '100%', padding: '8px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px' }}
                  value={tcpPort}
                  onChange={(e) => onTcpPortChange?.(Number(e.target.value))}
                  disabled={connected}
                  placeholder="29001"
                />
              </div>
            </>
          )}

          <div className="dialog-form-group">
            <label>Timeout</label>
            <select
              value={timeoutMs}
              onChange={(e) => onTimeoutChange(Number(e.target.value))}
              disabled={connected}
            >
              <option value={1000}>1000 ms</option>
              <option value={2000}>2000 ms</option>
              <option value={3000}>3000 ms</option>
              <option value={5000}>5000 ms</option>
            </select>
          </div>

          <div className="dialog-form-group">
            <label>Runtime Packet Mode</label>
            <select
              value={runtimePacketMode}
              onChange={(e) => onRuntimePacketModeChange && onRuntimePacketModeChange(e.target.value as any)}
              disabled={connected}
            >
              <option value={'Auto'}>Auto (recommended)</option>
              <option value={'ForceBurst'}>Force Burst</option>
              <option value={'ForceOCH'}>Force OCH</option>
              <option value={'Disabled'}>Disabled (use Burst)</option>
            </select>
            <div className="field-help">Per-connection override for runtime packet selection</div>
            <div className="field-help">OCH (On-Controller Block Read): use INI-defined block reads when supported by the ECU (configured via <code>ochGetCommand</code> / <code>ochBlockSize</code>).</div>
          </div>



          {/* INI defaults display */}
          {iniDefaults && (
            <div className="dialog-form-group ini-defaults">
              <label>INI Defaults</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div><strong>Baud:</strong> {iniDefaults.default_baud_rate}</div>
                <div><strong>Timeout:</strong> {iniDefaults.timeout_ms} ms</div>
                <div><strong>interWriteDelay:</strong> {iniDefaults.inter_write_delay} ms</div>
                <div><strong>Delay after port open:</strong> {iniDefaults.delay_after_port_open} ms</div>
                <button className="primary-btn" style={{ marginTop: '8px' }} onClick={() => onApplyIniDefaults && onApplyIniDefaults()} disabled={connected === true ? false : false}>
                  Apply INI defaults
                </button>
              </div>
            </div>
          )} 
          
          <div className="dialog-status">
            <span className={`status-indicator ${connected ? 'connected' : 'disconnected'}`} />
            {statusMessage ? statusMessage : (connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected')}
          </div>
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {connected ? (
          <Button variant="danger" onClick={onDisconnect}>
            Disconnect
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={onConnect}
            disabled={connecting || !selectedPort}
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </Button>
        )}
      </Dialog.Footer>
    </Dialog>
  );
}
