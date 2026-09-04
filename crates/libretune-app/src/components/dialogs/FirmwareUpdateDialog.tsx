import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { Cpu } from 'lucide-react';
import { Dialog, Button } from '../common';
import type { IniCapabilities } from '../../types/app';
import { requestReconnect } from '../../utils/connectionWorkflow';
import './FirmwareUpdateDialog.css';

interface FirmwareFlasherInfo {
  stm32_programmer_cli: string | null;
  dfu_util: string | null;
  bootcommander: string | null;
  objcopy: string | null;
}

interface FirmwareUpdateResult {
  success: boolean;
  log: string[];
  message: string;
  should_reconnect: boolean;
}

export interface FirmwareUpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isConnected: boolean;
  iniCapabilities: IniCapabilities | null;
}

type DialogMode = 'update' | 'recovery';

export function FirmwareUpdateDialog({
  isOpen,
  onClose,
  isConnected,
  iniCapabilities,
}: FirmwareUpdateDialogProps) {
  const [mode, setMode] = useState<DialogMode>('update');
  const [firmwarePath, setFirmwarePath] = useState<string | null>(null);
  const [bootloaderPath, setBootloaderPath] = useState<string | null>(null);
  const [fullErase, setFullErase] = useState(true);
  const [flasherInfo, setFlasherInfo] = useState<FirmwareFlasherInfo | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [shouldReconnect, setShouldReconnect] = useState(false);

  const dfuAvailable = !!iniCapabilities?.dfu_command_name;
  const hasDfuTool = !!(flasherInfo?.stm32_programmer_cli || flasherInfo?.dfu_util);
  const hasRecoveryTool = !!flasherInfo?.stm32_programmer_cli;

  useEffect(() => {
    if (!isOpen) return;
    setLog([]);
    setError(null);
    setResultMessage(null);
    setShouldReconnect(false);
    invoke<FirmwareFlasherInfo>('get_firmware_flasher_info')
      .then(setFlasherInfo)
      .catch((e) => setError(String(e)));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const unlisten = listen<{ line: string }>('firmware-update:log', (event) => {
      setLog((prev) => [...prev, event.payload.line]);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [isOpen]);

  const browseFirmware = useCallback(async () => {
    const selected = await open({
      title: 'Select Firmware File',
      multiple: false,
      filters: [
        { name: 'Firmware', extensions: ['bin', 'hex', 'dfu'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (selected && typeof selected === 'string') {
      setFirmwarePath(selected);
      setError(null);
    }
  }, []);

  const browseBootloader = useCallback(async () => {
    const selected = await open({
      title: 'Select OpenBLT Bootloader',
      multiple: false,
      filters: [
        { name: 'Bootloader Images', extensions: ['bin', 'hex'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (selected && typeof selected === 'string') {
      setBootloaderPath(selected);
      setError(null);
    }
  }, []);

  const browseRecoveryApp = useCallback(async () => {
    const selected = await open({
      title: 'Select Application Firmware',
      multiple: false,
      filters: [
        { name: 'Application Images', extensions: ['bin', 'hex'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (selected && typeof selected === 'string') {
      setFirmwarePath(selected);
      setError(null);
    }
  }, []);

  const canFlash =
    mode === 'recovery'
      ? !!bootloaderPath && !!firmwarePath && hasRecoveryTool
      : isConnected && !!firmwarePath && dfuAvailable && hasDfuTool;

  const handleUpdate = useCallback(async () => {
    if (!firmwarePath) return;
    setIsUpdating(true);
    setError(null);
    setResultMessage(null);
    setShouldReconnect(false);
    setLog([]);
    try {
      const result =
        mode === 'recovery'
          ? await invoke<FirmwareUpdateResult>('recover_ecu_firmware_dfu', {
              bootloaderPath,
              appFirmwarePath: firmwarePath,
              // Addresses are fixed in the backend (bootloader @ 0x08000000, app @ 0x08008000).
              appFlashAddress: null,
              fullErase,
            })
          : await invoke<FirmwareUpdateResult>('update_ecu_firmware', {
              firmwarePath,
              method: 'dfu',
              // DFU .bin address is fixed at 0x08000000 (same as epicEFI Flasher).
              binFlashAddress: null,
              acknowledgeRisk: true,
            });
      setLog(result.log);
      setResultMessage(result.message);
      setShouldReconnect(result.should_reconnect);
      if (!result.success) {
        setError(result.message);
      } else if (result.should_reconnect) {
        requestReconnect({
          source: 'firmware-update',
          delayMs: 8000,
          retries: 10,
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIsUpdating(false);
    }
  }, [firmwarePath, mode, bootloaderPath, fullErase]);

  const toolMissing =
    mode === 'recovery' ? !hasRecoveryTool : !hasDfuTool;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Update ECU Firmware"
      size="lg"
      closeOnBackdrop={!isUpdating}
      className="firmware-update-dialog"
    >
      <Dialog.Body>
        <div className="firmware-update-intro">
          <Cpu size={18} aria-hidden />
          <p>
            {mode === 'recovery'
              ? 'Board must already be in DFU mode (PROG + power cycle). No tuning connection needed.'
              : 'Flash firmware over DFU. Keep USB powered; power-cycle the ECU when finished.'}
          </p>
        </div>

        <div className="firmware-update-field">
          <label>Mode</label>
          <div className="firmware-update-methods">
            <label className="firmware-method-option">
              <input
                type="radio"
                name="fw-mode"
                value="update"
                checked={mode === 'update'}
                onChange={() => setMode('update')}
                disabled={isUpdating}
              />
              <span>
                <strong>Normal update</strong> — ECU connected
              </span>
            </label>
            <label className="firmware-method-option">
              <input
                type="radio"
                name="fw-mode"
                value="recovery"
                checked={mode === 'recovery'}
                onChange={() => setMode('recovery')}
                disabled={isUpdating}
              />
              <span>
                <strong>DFU recovery</strong> — re-flash OpenBLT + app
              </span>
            </label>
          </div>
        </div>

        {mode === 'recovery' ? (
          <>
            <div className="firmware-update-field">
              <label>OpenBLT bootloader</label>
              <div className="firmware-file-row">
                <code className="firmware-file-path">
                  {bootloaderPath ?? 'No file selected'}
                </code>
                <Button
                  variant="secondary"
                  onClick={() => void browseBootloader()}
                  disabled={isUpdating}
                >
                  Browse…
                </Button>
              </div>
            </div>

            <div className="firmware-update-field">
              <label>Application firmware</label>
              <div className="firmware-file-row">
                <code className="firmware-file-path">
                  {firmwarePath ?? 'No file selected'}
                </code>
                <Button
                  variant="secondary"
                  onClick={() => void browseRecoveryApp()}
                  disabled={isUpdating}
                >
                  Browse…
                </Button>
              </div>
            </div>

            <label className="firmware-checkbox-option">
              <input
                type="checkbox"
                checked={fullErase}
                onChange={(e) => setFullErase(e.target.checked)}
                disabled={isUpdating}
              />
              <span>Full chip erase before flash</span>
            </label>
          </>
        ) : (
          <>
            {!dfuAvailable && (
              <div className="firmware-update-warning">
                This ECU definition has no DFU command (<code>cmd_dfu</code>).
              </div>
            )}

            <div className="firmware-update-field">
              <label>Firmware file</label>
              <div className="firmware-file-row">
                <code className="firmware-file-path">
                  {firmwarePath ?? 'No file selected'}
                </code>
                <Button
                  variant="secondary"
                  onClick={() => void browseFirmware()}
                  disabled={isUpdating}
                >
                  Browse…
                </Button>
              </div>
            </div>

            {!isUpdating && !isConnected && (
              <div className="firmware-update-warning">
                Connect to the ECU before updating.
              </div>
            )}
          </>
        )}

        {isUpdating && (
          <div className="firmware-update-warning">
            DO NOT disconnect the ECU, firmware update in progress.
          </div>
        )}

        {toolMissing && (
          <div className="firmware-update-warning">
            Install STM32CubeProgrammer (or dfu-util for normal updates) and ensure it is on PATH.
          </div>
        )}

        {error && <div className="firmware-update-error">{error}</div>}
        {resultMessage && !error && (
          <div className="firmware-update-success">
            {resultMessage}
            {shouldReconnect && (
              <p className="firmware-reconnect-hint">
                Reconnecting automatically… If needed, use Reconnect below.
              </p>
            )}
          </div>
        )}

        {log.length > 0 && (
          <div className="firmware-update-log">
            {log.map((line, idx) => (
              <div key={`${idx}-${line}`} className="firmware-update-log-line">
                {line}
              </div>
            ))}
          </div>
        )}
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="secondary" onClick={onClose} disabled={isUpdating}>
          Close
        </Button>
        {shouldReconnect && !isUpdating && (
          <Button
            variant="secondary"
            onClick={() =>
              requestReconnect({
                source: 'firmware-update-manual',
                delayMs: 0,
                retries: 6,
              })
            }
          >
            Reconnect
          </Button>
        )}
        <Button
          variant="primary"
          onClick={() => void handleUpdate()}
          disabled={!canFlash || isUpdating}
        >
          {isUpdating
            ? mode === 'recovery'
              ? 'Recovering…'
              : 'Updating…'
            : mode === 'recovery'
              ? 'Recover ECU'
              : 'Update Firmware'}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
