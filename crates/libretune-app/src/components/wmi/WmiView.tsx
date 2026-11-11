import { useRef, useState, type KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useChannel } from '../../stores/realtimeStore';
import {
  WMI_ACTION_LABEL,
  WMI_COMMANDS,
  WMI_CONSTANTS,
  type WmiAction,
  type WmiTab,
} from './wmiConstants';
import { WmiCalibration } from './WmiCalibration';
import { WmiSetup } from './WmiSetup';
import { WmiStatus } from './WmiStatus';
import { WmiButton, WmiDot, WmiEmpty, WmiNotice } from './WmiLayout';
import { useWmiConfig, useWmiRun, useWmiTargetBand } from './useWmi';
import { formatDuration, isOn, wmiStateInfo, type WmiTone } from './wmiFormat';
import './Wmi.css';

const TABS: Array<{ id: WmiTab; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'setup', label: 'Setup' },
  { id: 'bench', label: 'Bench test' },
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
  const [tab, setTab] = useState<WmiTab>('status');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const { values, missing, meta, loading, error, refresh, commit } = useWmiConfig();
  const { run, lastCompleted, remaining, start, clear } = useWmiRun();
  const targetBand = useWmiTargetBand();

  const rpm = useChannel('rpm');
  const batteryPrimary = useChannel('battery');
  const batteryFallback = useChannel('batteryVoltage');
  const battery = batteryPrimary ?? batteryFallback;
  const engineRunning = rpm !== undefined && rpm > 100;

  const enabled = isOn(values[WMI_CONSTANTS.enabled]);
  const stateChannel = useChannel('wmiState');
  const pumpDuty = useChannel('wmiPumpDuty');
  const state = wmiStateInfo(isConnected ? stateChannel : undefined);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((item) => item.id === tab);
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % TABS.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + TABS.length) % TABS.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = TABS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

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
        setTab('bench');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(
        action === 'cancel'
          ? `Could not cancel the run: ${message}`
          : `Could not start ${WMI_ACTION_LABEL[action].toLowerCase()}: ${message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  if (!hasWmi) {
    return (
      <div className="wmi-view">
        <WmiEmpty title="WMI is not available in this definition">
          This ECU definition does not expose the WMI constants and channels. Load an INI with
          WMI support to use this view.
        </WmiEmpty>
      </div>
    );
  }

  const runProgress = run
    ? Math.max(0, Math.min(100, ((run.durationSec - remaining) / Math.max(1, run.durationSec)) * 100))
    : 0;

  const stateChip: { text: string; tone: WmiTone } = !isConnected
    ? { text: enabled ? 'Armed in tune' : 'Disabled in tune', tone: 'dim' }
    : state.key === 'unknown'
      ? { text: 'No state', tone: 'dim' }
      : { text: state.label, tone: state.tone };

  return (
    <div className="wmi-view">
      <header className="wmi-header">
        <div className="wmi-header__title">
          <h1>WMI</h1>
          <p>Water/methanol injection</p>
        </div>

        <nav className="wmi-tabs" role="tablist" aria-label="WMI sections">
          {TABS.map((item, index) => {
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`wmi-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`wmi-tabpanel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                className={`wmi-tab${selected ? ' is-active' : ''}`}
                onClick={() => setTab(item.id)}
                onKeyDown={handleTabKeyDown}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="wmi-header__status">
          <span className={`wmi-chip wmi-tone-${isConnected ? 'ok' : 'dim'}`}>
            <WmiDot tone={isConnected ? 'ok' : 'dim'} />
            {isConnected ? 'ECU online' : 'ECU offline'}
          </span>
          <span className="wmi-chip wmi-chip--mono" title="Ignition voltage">
            <span className="wmi-chip__key">BATT</span>
            {battery !== undefined && Number.isFinite(battery)
              ? `${battery.toFixed(1)} V`
              : '—'}
          </span>
          <span className={`wmi-chip wmi-tone-${stateChip.tone}`} title="WMI state">
            <WmiDot tone={stateChip.tone} />
            {stateChip.text}
          </span>
        </div>
      </header>

      {run ? (
        <div className="wmi-run-banner" role="status">
          <WmiDot tone="ok" />
          <strong className="wmi-run-banner__title">{WMI_ACTION_LABEL[run.action]}</strong>
          <span className="wmi-run-banner__time">{formatDuration(remaining)}</span>
          <span className="wmi-run-banner__track" aria-hidden="true">
            <i style={{ width: `${runProgress}%` }} />
          </span>
          {isConnected && pumpDuty !== undefined ? (
            <span className="wmi-run-banner__duty">{pumpDuty.toFixed(0)}% duty</span>
          ) : null}
          <span className="wmi-run-banner__spacer" />
          {tab !== 'bench' ? (
            <WmiButton onClick={() => setTab('bench')}>View run</WmiButton>
          ) : null}
          <WmiButton variant="danger" onClick={() => void runAction('cancel')} disabled={busy}>
            Cancel run
          </WmiButton>
        </div>
      ) : null}

      {actionError ? (
        <WmiNotice
          tone="crit"
          title="Command failed"
          onDismiss={() => setActionError(null)}
          className="wmi-notice--flush"
        >
          {actionError}
        </WmiNotice>
      ) : null}

      {error ? (
        <WmiNotice
          tone="crit"
          title="Could not read the WMI tune"
          action={
            <WmiButton onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Retrying…' : 'Retry'}
            </WmiButton>
          }
          className="wmi-notice--flush"
        >
          {error}
        </WmiNotice>
      ) : null}

      {loading ? (
        <div className="wmi-loading" aria-busy="true">
          <span className="wmi-loading__bar" />
          Reading WMI tune constants…
        </div>
      ) : (
        <main
          className="wmi-body"
          id={`wmi-tabpanel-${tab}`}
          role="tabpanel"
          aria-labelledby={`wmi-tab-${tab}`}
        >
          {tab === 'status' ? (
            <WmiStatus
              values={values}
              meta={meta}
              isConnected={isConnected}
              targetBand={targetBand.band}
              onGoTo={setTab}
            />
          ) : null}

          {tab === 'setup' ? (
            <WmiSetup
              values={values}
              missing={missing}
              meta={meta}
              onCommit={commit}
              onGoTo={setTab}
              openTarget={openTarget}
              targetBand={targetBand.band}
              onSaveTargetBand={targetBand.save}
              targetBandLoading={targetBand.loading}
              targetBandError={targetBand.error}
            />
          ) : null}

          {tab === 'bench' ? (
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
              onGoTo={setTab}
            />
          ) : null}
        </main>
      )}
    </div>
  );
}

export default WmiView;
