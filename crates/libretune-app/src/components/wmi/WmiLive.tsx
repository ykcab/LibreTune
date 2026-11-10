import { useChannels } from '../../stores/realtimeStore';
import { WMI_CONSTANTS, type WmiAction, type WmiTab } from './wmiConstants';
import { WmiFlowGraph, WmiSparkline } from './WmiFlowGraph';
import {
  WmiButton,
  WmiCallout,
  WmiTile,
} from './WmiLayout';
import {
  formatDuty,
  formatNumber,
  formatWf,
  isOn,
  wmiStateInfo,
  type WmiTone,
} from './wmiFormat';
import type { WmiRun, WmiTargetBand } from './useWmi';

export interface WmiLiveProps {
  values: Record<string, number>;
  isConnected: boolean;
  engineRunning: boolean;
  hasCalibration: boolean;
  run: WmiRun | null;
  remaining: number;
  busy: boolean;
  targetBand: WmiTargetBand;
  onStart: (action: WmiAction) => void;
  onCancel: () => void;
  onGoTo: (tab: WmiTab) => void;
  onCommit: (name: string, value: number) => Promise<void>;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function WmiHealthRow({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: WmiTone;
}) {
  return (
    <div className="wmi-health-row">
      <span className={`wmi-health-dot wmi-tone-${tone}`} />
      <span className="wmi-health-main">
        <strong>{label}</strong>
        <em>{detail}</em>
      </span>
      <span className={`wmi-health-value wmi-tone-${tone}`}>{value}</span>
    </div>
  );
}

export function WmiLive({
  values,
  isConnected,
  engineRunning,
  hasCalibration,
  run,
  remaining,
  busy,
  targetBand,
  onStart,
  onCancel,
  onGoTo,
  onCommit,
}: WmiLiveProps) {
  const live = useChannels([
    'wmiState',
    'wmiPumpDuty',
    'wmiFluidOk',
    'wmiActive',
    'wmiTimingAdder',
    'wmiFuelAdder',
    'wmiCoolingRatio',
    'wmiEgtHeadroom',
    'wmiEgtDelta',
    'wmiEgtFault',
    'wmiFallbackMapsActive',
    'wmiEstimatedFlowGps',
    'wmiModeledFlowGps',
    'wmiWfRatio',
    'wmiFlowFault',
    'egt',
    'egt1',
  ]);

  const enabled = isOn(values[WMI_CONSTANTS.enabled]);
  const state = wmiStateInfo(live.wmiState);
  const pumpDuty = live.wmiPumpDuty;
  const pumping = live.wmiState !== undefined && live.wmiState >= 2 && live.wmiState <= 3;
  const correctionsActive = isOn(live.wmiActive);

  const flowMonitored = (values[WMI_CONSTANTS.flowPin] ?? 0) > 0;
  const flowFault = isOn(live.wmiFlowFault);
  const flowTone: WmiTone = !flowMonitored ? 'dim' : flowFault ? 'crit' : 'ok';
  const flowValue = !flowMonitored ? 'not monitored' : flowFault ? 'Fault' : 'OK';
  const flowDetail = flowMonitored
    ? `${formatNumber(live.wmiEstimatedFlowGps, 1, ' g/s')} measured`
    : 'no hall sensor';

  const fluidOk = live.wmiFluidOk;
  const fluidTone: WmiTone = fluidOk === undefined ? 'dim' : fluidOk >= 0.5 ? 'ok' : 'crit';
  const fluidValue = fluidOk === undefined ? '—' : fluidOk >= 0.5 ? 'tank ok' : 'Fault';
  const fluidDetail = fluidOk === undefined
    ? 'sensor guard'
    : fluidOk >= 0.5 ? 'sensor guard' : 'sensor guard tripped';

  const egtEnabled = isOn(values[WMI_CONSTANTS.egtFault]);
  const egtFault = isOn(live.wmiEgtFault);
  const egtTemp = live.egt ?? live.egt1;
  const egtTone: WmiTone = !egtEnabled ? 'dim' : egtFault ? 'crit' : 'ok';
  const egtValue = egtTemp !== undefined
    ? `${egtTemp.toFixed(0)}°C`
    : !egtEnabled ? 'not installed' : egtFault ? 'Fault' : 'below fault';
  const egtDetail = egtEnabled
    ? `${formatNumber(live.wmiEgtHeadroom, 0, ' °C')} headroom`
    : 'enable in Safety';

  const safeguardActive = isOn(live.wmiFallbackMapsActive);
  const nozzle = values[WMI_CONSTANTS.nozzleCcMin] ?? 0;
  const methanolPct = values[WMI_CONSTANTS.methanolPct] ?? 50;
  const pwmFrequency = values[WMI_CONSTANTS.pwmFrequency] ?? 0;
  const outputPin = values[WMI_CONSTANTS.outputPin] ?? 0;
  const nozzleCalibrated = nozzle > 0 && nozzle <= 2000;

  const wfValue = pumping && nozzleCalibrated ? live.wmiWfRatio : undefined;
  const modeledFlow = pumping && nozzleCalibrated ? live.wmiModeledFlowGps : undefined;

  const bandMin = Math.max(0, targetBand.min);
  const bandMax = Math.max(bandMin + 0.01, targetBand.max);
  const bandScaleMax = Math.max(0.5, bandMax * 1.5, (wfValue ?? 0) * 1.15);
  const bandLeft = (bandMin / bandScaleMax) * 100;
  const bandWidth = ((bandMax - bandMin) / bandScaleMax) * 100;
  const wfMarker = wfValue !== undefined && wfValue > 0
    ? Math.max(0, Math.min(100, (wfValue / bandScaleMax) * 100))
    : null;

  const actionsDisabled = !enabled || !isConnected || engineRunning || busy || run !== null;
  const dutyPct = Math.max(0, Math.min(100, pumpDuty ?? 0));
  const heroDetail = run
    ? `${run.action === 'calibrate' ? 'Calibrating' : run.action === 'prime' ? 'Priming' : 'Testing'} · ${formatDuty(pumpDuty)} duty · ${formatDuration(remaining)}`
    : pumping
      ? `Spraying · ${formatDuty(pumpDuty)} duty`
      : state.description;

  return (
    <div className="wmi-page wmi-page--dashboard">
      <div className="wmi-live-layout">
        <div className="wmi-live-main">
          <section className={`wmi-hero wmi-tone-${state.tone}`}>
            <div className="wmi-hero__copy">
              <span className="wmi-hero__eyebrow">PUMP STATE</span>
              <h2>{state.label.toUpperCase()}</h2>
              <p>{heroDetail}</p>
              <div className="wmi-meter" aria-hidden="true">
                <i style={{ width: `${dutyPct}%` }} />
              </div>
              <div className="wmi-hero__scale">
                <span>0%</span>
                <span>100%</span>
              </div>
              <div className="wmi-hero__meta">
                <span>{pwmFrequency > 0 ? `PWM ${pwmFrequency.toFixed(0)} Hz` : 'PWM off/on'}</span>
                <span>{outputPin > 0 ? `Pump output ${outputPin.toFixed(0)}` : 'Pump output not assigned'}</span>
              </div>
            </div>
            <div className="wmi-duty-readout" aria-label={`Pump duty ${formatDuty(pumpDuty)}`}>
              <span>COMMAND</span>
              <strong>{formatDuty(pumpDuty)}</strong>
              <small>pump duty</small>
            </div>
          </section>

          {!enabled ? (
            <WmiCallout tone="warn">
              <span>WMI is disabled in this tune. Enable it in Hardware before running the pump.</span>
              <WmiButton onClick={() => onGoTo('setup')}>Open Hardware</WmiButton>
            </WmiCallout>
          ) : null}

          {engineRunning ? (
            <WmiCallout tone="warn">
              Engine speed is above idle. Prime, test and calibration are disabled while the
              engine is running.
            </WmiCallout>
          ) : null}

          <div className="wmi-grid wmi-grid--three wmi-stat-grid">
            <WmiTile
              label="Modeled flow"
              value={formatNumber(modeledFlow, 2, ' g/s')}
              detail={nozzleCalibrated ? formatNumber(nozzle, 0, ' cc/min') : 'Nozzle not calibrated'}
              tone={nozzleCalibrated ? 'info' : 'dim'}
            >
              <WmiSparkline channel="wmiModeledFlowGps" />
            </WmiTile>
            <WmiTile
              label="Water/fuel"
              value={formatWf(wfValue)}
              detail={`target ${formatNumber(bandMin, 2)}–${formatNumber(bandMax, 2)}`}
              tone={wfValue === undefined ? 'dim' : 'warn'}
            >
              <WmiSparkline channel="wmiWfRatio" color="#fbbf24" />
            </WmiTile>
            <WmiTile
              label="Hall flow"
              value={flowMonitored ? formatNumber(live.wmiEstimatedFlowGps, 1, ' g/s') : '—'}
              detail={flowMonitored ? 'Hall meter' : 'no sensor'}
              tone={flowTone}
            />
            <WmiTile
              label="Cooling ratio"
              value={formatNumber(live.wmiCoolingRatio, 0, '%')}
              detail={`${formatNumber(methanolPct, 0, '%')} methanol · IAT-scaled`}
              tone="info"
            />
          </div>

          <section className={`wmi-band-card${wfValue === undefined ? ' is-inactive' : ''}`}>
            <div className="wmi-band__head">
              <span>W/F TARGET BAND</span>
              <strong>{formatWf(wfValue)}</strong>
              <em>
                {formatNumber(methanolPct, 0, '%')} · {formatNumber(nozzle, 0, ' cc/min')}
              </em>
            </div>
            <div
              className="wmi-band__track"
              role="img"
              aria-label={`W/F target band ${bandMin.toFixed(2)} to ${bandMax.toFixed(2)}`}
            >
              <span
                className="wmi-band__zone"
                style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
              />
              {wfMarker !== null ? (
                <span className="wmi-band__marker" style={{ left: `${wfMarker}%` }} />
              ) : null}
            </div>
            <div className="wmi-band__axis">
              <span>0.00</span>
              <span>target {formatNumber(bandMin, 2)}–{formatNumber(bandMax, 2)}</span>
              <span>{bandScaleMax.toFixed(2)}</span>
            </div>
            <p className="wmi-note">
              Target 0.40–0.70 at WOT. Below ~0.4 the pumping penalty outweighs the knock
              benefit; above ~0.8–1.0 power often drops. Tune to the knock limit after every
              duty change, not at fixed spark.
            </p>
          </section>

          <WmiFlowGraph />
        </div>

        <aside className="wmi-live-side">
          <section className="wmi-panel">
            <div className="wmi-panel__head">
              <span>HEALTH</span>
              <em>{flowMonitored ? 'Flow meter installed' : '1 sensor not installed'}</em>
            </div>
            <WmiHealthRow label="Flow" value={flowValue} detail={flowDetail} tone={flowTone} />
            <WmiHealthRow label="Fluid level" value={fluidValue} detail={fluidDetail} tone={fluidTone} />
            <WmiHealthRow label="EGT" value={egtValue} detail={egtDetail} tone={egtTone} />
            <WmiHealthRow
              label="Safeguard maps"
              value={safeguardActive ? 'Active' : 'Normal'}
              detail={safeguardActive ? 'fallback engaged' : 'auto-switch on fault'}
              tone={safeguardActive ? 'warn' : 'ok'}
            />
            <div className="wmi-panel__foot">
              {flowMonitored ? 'Flow fault guard armed' : 'Flow fault disabled: no hall sensor'}
            </div>
          </section>

          <section className="wmi-panel">
            <div className="wmi-panel__head">
              <span>QUICK ACTIONS</span>
            </div>
            {run ? (
              <div className="wmi-run wmi-run--panel">
                <div>
                  <strong>{run.action === 'calibrate' ? 'Calibrating' : run.action === 'prime' ? 'Priming' : 'Testing'}</strong>
                  <span>{formatDuration(remaining)} remaining</span>
                </div>
                <div className="wmi-run__bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(0, Math.min(100, (remaining / Math.max(1, run.durationSec)) * 100))}%` }} />
                </div>
                <WmiButton variant="danger" onClick={onCancel} disabled={busy}>
                  Cancel
                </WmiButton>
              </div>
            ) : (
              <div className="wmi-quick-actions">
                <WmiButton variant="primary" onClick={() => onGoTo('calibration')} disabled={!hasCalibration}>
                  <span className="wmi-action-main">Calibrate nozzle</span>
                  <span className="wmi-action-sub">Guided 60 s jug test</span>
                </WmiButton>
                <div className="wmi-quick-actions__secondary">
                  <WmiButton onClick={() => onStart('prime')} disabled={actionsDisabled}>
                    <span className="wmi-action-main">Prime line</span>
                    <span className="wmi-action-sub">5 s · 100%</span>
                  </WmiButton>
                  <WmiButton onClick={() => onStart('test')} disabled={actionsDisabled}>
                    <span className="wmi-action-main">Test 50%</span>
                    <span className="wmi-action-sub">5 s · 50%</span>
                  </WmiButton>
                </div>
                <WmiButton
                  variant="danger"
                  onClick={() => void onCommit(WMI_CONSTANTS.enabled, enabled ? 0 : 1)}
                >
                  <span className="wmi-action-main">{enabled ? 'Disable WMI' : 'Enable WMI'}</span>
                  <span className="wmi-action-sub">Ignition voltage required. Fluid will spray.</span>
                </WmiButton>
              </div>
            )}
            <p className="wmi-panel__note">
              {correctionsActive
                ? `Fuel adder ${formatNumber(live.wmiFuelAdder, 0, '%')} · timing ${formatNumber(live.wmiTimingAdder, 1, '°')}`
                : 'Corrections withheld until WMI is active.'}
            </p>
          </section>

          <section className="wmi-panel">
            <div className="wmi-panel__head">
              <span>SETUP</span>
              <button type="button" className="wmi-panel__link" onClick={() => onGoTo('setup')}>
                Edit
              </button>
            </div>
            <div className="wmi-setup-summary">
              <div><span>Nozzle</span><strong>{formatNumber(nozzle, 0, ' cc/min')}</strong></div>
              <div><span>Methanol</span><strong>{formatNumber(methanolPct, 0, '% by volume')}</strong></div>
              <div><span>PWM</span><strong>{pwmFrequency > 0 ? formatNumber(pwmFrequency, 0, ' Hz') : 'off/on'}</strong></div>
            </div>
          </section>
        </aside>
      </div>

      {!isConnected ? (
        <WmiCallout tone="info">
          Connect to the ECU to see live WMI state. The tune fields remain editable offline.
        </WmiCallout>
      ) : null}
    </div>
  );
}
