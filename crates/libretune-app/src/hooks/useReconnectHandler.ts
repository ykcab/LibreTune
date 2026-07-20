import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionStatus } from '../types/app';
import type { ConnectOptions } from './useAutoConnect';
import {
  type ReconnectRequestDetail,
  sleep,
} from '../utils/connectionWorkflow';

export interface UseReconnectHandlerDeps {
  connecting: boolean;
  syncing: boolean;
  status: ConnectionStatus;
  projectPort: string | null;
  lastSerialPort: string | null;
  connect: (options?: ConnectOptions) => Promise<void>;
  refreshPorts: () => Promise<string[]>;
  showToast: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void;
}

/**
 * Handles `reconnect:request` window events with optional delay and retries.
 * Used after controller commands, firmware updates, and other ECU reboot flows.
 */
export function useReconnectHandler(deps: UseReconnectHandlerDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const busyRef = useRef(false);

  useEffect(() => {
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<ReconnectRequestDetail>).detail ?? {
        source: 'unknown',
      };
      const {
        connecting,
        syncing,
        status,
        projectPort,
        lastSerialPort,
        connect,
        refreshPorts,
        showToast,
      } = depsRef.current;

      if (busyRef.current || connecting || syncing) {
        return;
      }
      if (status.state === 'Connected') {
        return;
      }
      busyRef.current = true;

      const source = detail.source ?? 'unknown';
      const isFirmware = source.includes('firmware');
      const isEcuDisconnect = source.includes('ecu-disconnect');

      try {
        const settings = await invoke<{
          auto_reconnect_after_controller_command?: boolean;
          auto_reconnect_after_firmware?: boolean;
        }>('get_settings');

        if (
          source.includes('controller-command') &&
          settings.auto_reconnect_after_controller_command === false
        ) {
          return;
        }
        if (
          isFirmware &&
          settings.auto_reconnect_after_firmware === false
        ) {
          return;
        }
      } catch (e) {
        console.warn('Could not read reconnect settings:', e);
      }

      const delayMs = detail.delayMs ?? (isFirmware ? 8000 : isEcuDisconnect ? 600 : 2000);
      const maxRetries = detail.retries ?? (isFirmware ? 10 : isEcuDisconnect ? 30 : 4);
      const retryIntervalMs = isFirmware ? 2500 : isEcuDisconnect ? 1000 : 2500;
      const targetPort =
        detail.port ?? projectPort ?? lastSerialPort ?? undefined;

      if (delayMs > 0) {
        await sleep(delayMs);
      }

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (depsRef.current.status.state === 'Connected') {
          return;
        }

        const ports = await refreshPorts();
        const port =
          targetPort && ports.includes(targetPort)
            ? targetPort
            : ports.length === 1
              ? ports[0]
              : undefined;

        if (!port) {
          await sleep(retryIntervalMs);
          continue;
        }

        try {
          await connect({
            strictPort: !!targetPort,
            silent: true,
            port,
          });
          const latest = await invoke<ConnectionStatus>('get_connection_status');
          if (latest.state === 'Connected') {
            if (attempt > 0 || isFirmware) {
              showToast(`Reconnected on ${port}`, 'success');
            }
            return;
          }
        } catch (e) {
          console.debug('Reconnect attempt failed:', e);
        }

        await sleep(retryIntervalMs);
      }

      showToast(
        'Automatic reconnect failed — open Connection and connect when the ECU is ready.',
        'warning',
      );
    };

    const wrapped = (event: Event) => {
      void handler(event).finally(() => {
        busyRef.current = false;
      });
    };

    window.addEventListener('reconnect:request', wrapped);
    return () => window.removeEventListener('reconnect:request', wrapped);
  }, []);
}
