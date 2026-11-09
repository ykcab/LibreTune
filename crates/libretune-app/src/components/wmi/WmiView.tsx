import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useChannel } from '../../stores/realtimeStore';
import { WMI_COMMANDS, type WmiAction, type WmiTab } from './wmiConstants';
import { WmiCalibration } from './WmiCalibration';
import { WmiLive } from './WmiLive';
import { WmiSafety } from './WmiSafety';
import { WmiSetup } from './WmiSetup';
import { useWmiConfig, useWmiRun, useWmiTargetBand } from './useWmi';
import { wmiStateInfo } from './wmiFormat';
import './Wmi.css';

const TABS: Array<{ id: WmiTab; label: string }> = [
  { id: 'live', label: 'Dashboard' },
  { id: 'calibration', label: 'Calibration' },
  { id: 'activation', label: 'Activation' },
  { id: 'safety', label: 'Safety' },
  { id: 'hardware', label: 'Hardware' },
];

export interface WmiViewProps {
  isConnected: boolean;
  hasWmi?: boolean;
  hasCalibration?: boolean;
  openTarget?: (target: string) => void;
}

export function WmiView({
  isConnected,
  hasWmi = true,
  hasCalibration = false,
  openTarget,
}: WmiViewProps) {
  const [tab, setTab] = useState<WmiTab>('live');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { values, missing, loading, error, commit } = useWmiConfig();
  const { run, lastCompleted, remaining, start, clear } = useWmiRun();
  const targetBand = useWmiTargetBand();
  const rpm = useChannel('rpm');
  const battery = useChannel('battery') ?? useChannel('batteryVoltage');
  const engineRunning = rpm !== undefined && rpm > 100;
  const state = wmiStateInfo(useChannel('wmiState'));
  const headerPill = tab === 'calibration'
    ? (isConnected ? 'CONNECTED' : 'OFFLINE')
    : state.key === 'priming' || state.key === 'active'
      ? 'ACTIVE'
      : state.key === 'standby'
        ? 'STANDBY'
        : state.shortLabel;

  const runAction = async (action: WmiAction) => {
    setActionError(null);
    setBusy(true);
    try {
      await invoke('execute_controller_command', {
        commandName: WMI_COMMANDS[action],
      });
      if (action === 'cancel') {
        clear();
      } else {
        start(action);
        if (action === 'calibrate') setTab('calibration');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(
        action === 'cancel'
          ? `Could not cancel the WMI run: ${message}`
          : `Could not start ${action}: ${message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  if (!hasWmi) {
    return (
      <div className="wmi-view">
        <div className="wmi-empty">
          <h2>Water/methanol injection is not available</h2>
          <p>
            This ECU definition does not expose the WMI constants and live channels. Load an
            epicEFI INI with WMI support to use this view.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="wmi-view">
      <header className="wmi-header">
        <div className="wmi-header__brand">
          <div className="wmi-logo" aria-hidden="true">W</div>
          <div className="wmi-header__copy">
            <h1>{tab === 'calibration' ? 'WMI Calibration' : 'WMI'}</h1>
            <p>{tab === 'calibration' ? 'Nozzle & flow setup' : 'Water/Methanol Injection'}</p>
          </div>
        </div>
        <nav className="wmi-tabs" aria-label="WMI sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`wmi-tab${tab === item.id ? ' is-active' : ''}`}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="wmi-header__status">
          <span className={`wmi-state-pill wmi-tone-${tab === 'calibration' ? (isConnected ? 'ok' : 'dim') : state.tone}`}>
            <i />{headerPill}
          </span>
          <span className="wmi-ignition">Ign {battery !== undefined ? `${battery.toFixed(1)} V` : '—'}</span>
          <span className="wmi-ecu">ECU</span>
        </div>
      </header>

      {actionError ? (
        <div className="wmi-banner wmi-banner--error">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="wmi-banner wmi-banner--error">
          <span>Could not read the WMI tune: {error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="wmi-loading" aria-busy="true">
          Reading WMI configuration…
        </div>
      ) : (
        <main className="wmi-body">
          {tab === 'live' ? (
            <WmiLive
              values={values}
              isConnected={isConnected}
              engineRunning={engineRunning}
              hasCalibration={hasCalibration}
              run={run}
              remaining={remaining}
              busy={busy}
              targetBand={targetBand.band}
              onStart={(action) => void runAction(action)}
              onCancel={() => void runAction('cancel')}
              onGoTo={setTab}
              onCommit={commit}
            />
          ) : null}

          {tab === 'calibration' ? (
            <WmiCalibration
              values={values}
              isConnected={isConnected}
              engineRunning={engineRunning}
              hasCalibration={hasCalibration}
              run={run}
              lastCompleted={lastCompleted}
              remaining={remaining}
              busy={busy}
              onStart={(action) => void runAction(action)}
              onCancel={() => void runAction('cancel')}
              onCommit={commit}
            />
          ) : null}

          {tab === 'activation' ? (
            <WmiSetup
              section="activation"
              values={values}
              missing={missing}
              onCommit={commit}
              onGoTo={setTab}
              openTarget={openTarget}
              targetBand={targetBand.band}
              onSaveTargetBand={targetBand.save}
              targetBandLoading={targetBand.loading}
              targetBandError={targetBand.error}
            />
          ) : null}

          {tab === 'hardware' ? (
            <WmiSetup
              section="hardware"
              values={values}
              missing={missing}
              onCommit={commit}
              onGoTo={setTab}
              openTarget={openTarget}
              targetBand={targetBand.band}
              onSaveTargetBand={targetBand.save}
              targetBandLoading={targetBand.loading}
              targetBandError={targetBand.error}
            />
          ) : null}

          {tab === 'safety' ? (
            <WmiSafety values={values} missing={missing} onCommit={commit} />
          ) : null}
        </main>
      )}
    </div>
  );
}

export default WmiView;
