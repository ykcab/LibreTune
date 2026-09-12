import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RotateCw } from 'lucide-react';
import { Dialog, Button } from '../../common';
import '../Dialogs.css';

interface LocalTcpEcu {
  host: string;
  port: number;
  label: string;
}

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
}

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
  autoConnectEnabled?: boolean;
  rememberedPort?: string | null;
  connectionPhase?: string;
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
  autoConnectEnabled,
  rememberedPort,
  connectionPhase,
}: ConnectionDialogProps) {
  const [localTcp, setLocalTcp] = useState<LocalTcpEcu[]>([]);
  const prevConnectedRef = useRef<boolean>(connected);

  const refreshLocalTcp = () => {
    void (async () => {
      try {
        const found = await invoke<LocalTcpEcu[]>('list_local_tcp_ecus');
        setLocalTcp(Array.isArray(found) ? found : []);
      } catch {
        setLocalTcp([]);
      }
    })();
  };

  useEffect(() => {
    if (!isOpen) return;
    refreshLocalTcp();
  }, [isOpen]);

  // Auto-close only after a successful connect while the dialog is open.
  // Leave it open on failure so the user can retry / adjust settings.
  useEffect(() => {
    if (!isOpen) {
      prevConnectedRef.current = connected;
      return;
    }
    if (connected && !prevConnectedRef.current) {
      onClose();
    }
    prevConnectedRef.current = connected;
  }, [connected, isOpen, onClose]);

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
                  <span>TCP / WiFi / ts_shim</span>
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
                  <button
                    onClick={() => {
                      onRefreshPorts();
                      refreshLocalTcp();
                    }}
                    disabled={connected}
                  >
                    <RotateCw size={14} /> Refresh
                  </button>
                </div>
                {ports.length === 0 && (
                  <p className="field-help">
                    No free serial ports. If ts_shim owns the COM port, use TCP on 127.0.0.1:29001.
                  </p>
                )}
                {localTcp.length > 0 && !connected && (
                  <div className="field-help" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                    {localTcp.map((ecu) => (
                      <Button
                        key={`${ecu.host}:${ecu.port}`}
                        variant="secondary"
                        onClick={() => {
                          onConnectionTypeChange?.('Tcp');
                          onTcpHostChange?.(ecu.host);
                          onTcpPortChange?.(ecu.port);
                        }}
                      >
                        Use {ecu.label} ({ecu.host}:{ecu.port})
                      </Button>
                    ))}
                  </div>
                )}
                {rememberedPort && (
                  <p className="field-help">
                    Last successful port: <code>{rememberedPort}</code>
                    {autoConnectEnabled && !connected
                      ? ' — auto-connect is enabled in Settings'
                      : ''}
                  </p>
                )}
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
              {localTcp.length > 0 && !connected && (
                <div className="field-help" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {localTcp.map((ecu) => (
                    <Button
                      key={`${ecu.host}:${ecu.port}`}
                      variant="secondary"
                      onClick={() => {
                        onTcpHostChange?.(ecu.host);
                        onTcpPortChange?.(ecu.port);
                      }}
                    >
                      Use {ecu.label} ({ecu.host}:{ecu.port})
                    </Button>
                  ))}
                </div>
              )}
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
            {statusMessage
              ? statusMessage
              : connected
                ? 'Connected'
                : connecting
                  ? 'Connecting...'
                  : connectionPhase === 'auto-connect-waiting'
                    ? `Waiting for ${rememberedPort ?? 'ECU'}…`
                    : connectionPhase === 'auto-connect'
                      ? `Auto-connecting${rememberedPort ? ` to ${rememberedPort}` : ''}…`
                      : 'Disconnected'}
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
            disabled={
              connecting ||
              (connectionType === 'Serial' ? !selectedPort : !tcpHost || !tcpPort)
            }
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </Button>
        )}
      </Dialog.Footer>
    </Dialog>
  );
}
