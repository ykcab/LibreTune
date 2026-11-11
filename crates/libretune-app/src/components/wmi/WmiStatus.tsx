import { useChannels } from '../../stores/realtimeStore';
import { WMI_CONSTANTS } from './wmiConstants';
import { WmiHistory } from './WmiHistory';
import { WmiSchematic } from './WmiSchematic';
import { WmiButton, WmiDot, WmiKvRow, WmiNotice, WmiPanel } from './WmiLayout';
import {
  formatNumber,
  formatSigned,
  isOn,
  wmiStateInfo,
  type WmiStateInfo,
  type WmiTone,
} from './wmiFormat';
import { mixtureWaterMassFraction } from './wmiMath';
import type { WmiTargetBand } from './useWmi';
import type { WmiTab } from './wmiConstants';
import type { Constant } from '../dialogs/types';

type LiveValues = ReturnType<typeof useChannels>;

function unitLabel(meta: Constant | undefined): string {
  const units = meta?.units ?? '';
  return units.startsWith('{') ? '' : units;
}

function withUnit(value: number, digits: number, units: string): string {
  return units ? `${value.toFixed(digits)} ${units}` : value.toFixed(digits);
}

function activationConditions(values: Record<string, number>) {
  return [
    { label: 'MAP', constant: WMI_CONSTANTS.minMap, read: (live: LiveValues) => live.map },
    { label: 'RPM', constant: WMI_CONSTANTS.minRpm, read: (live: LiveValues) => live.rpm },
    { label: 'TPS', constant: WMI_CONSTANTS.minTps, read: (live: LiveValues) => live.tps },
    {
      label: 'Coolant',
      constant: WMI_CONSTANTS.minClt,
      read: (live: LiveValues) => live.coolant ?? live.clt,
    },
  ].filter((condition) => values[condition.constant] !== undefined);
}

function WmiActivation({
  values,
  meta,
  live,
  state,
  faulted,
  isConnected,
}: {
  values: Record<string, number>;
  meta: Record<string, Constant>;
  live: LiveValues;
  state: WmiStateInfo;
  faulted: boolean;
  isConnected: boolean;
}) {
  const conditions = activationConditions(values);
  if (conditions.length === 0) return null;

  const rows = conditions.map((condition) => {
    const threshold = values[condition.constant];
    const current = isConnected ? condition.read(live) : undefined;
    const met = current !== undefined && Number.isFinite(current)
      ? current >= threshold
      : undefined;
    const units = unitLabel(meta[condition.constant]);
    return { ...condition, threshold, current, met, units };
  });

  const known = rows.filter((row) => row.current !== undefined && Number.isFinite(row.current));
  const met = known.filter((row) => row.met);
  const allMet = known.length === rows.length && met.length === rows.length;
  const metaLabel = !isConnected
    ? 'Offline'
    : allMet
      ? 'All met'
      : `${met.length}/${rows.length} met`;

  const delay = values[WMI_CONSTANTS.activationDelayMs];
  const enablePin = values[WMI_CONSTANTS.enablePin] ?? 0;

  return (
    <WmiPanel title="Activation" meta={metaLabel} className="wmi-panel--activation">
      <div className="wmi-activation">
        {rows.map((row) => {
          const tone: WmiTone = row.met === undefined ? 'dim' : row.met ? 'ok' : 'warn';
          return (
            <div key={row.constant} className={`wmi-cond wmi-tone-${tone}`}>
              <div className="wmi-cond__head">
                <WmiDot tone={tone} />
                <span className="wmi-cond__label">{row.label}</span>
              </div>
              <strong className="wmi-cond__value">
                {row.current !== undefined && Number.isFinite(row.current)
                  ? withUnit(row.current, Math.abs(row.current) < 10 ? 1 : 0, row.units)
                  : '—'}
              </strong>
              <span className="wmi-cond__threshold">
                ≥ {withUnit(row.threshold, Math.abs(row.threshold) < 10 ? 1 : 0, row.units)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="wmi-panel__note">
        {!isConnected
          ? 'Connect to the ECU to compare live values with the thresholds.'
          : faulted
            ? 'A guard has tripped; corrections stay off until it clears, even with every threshold met.'
            : state.key === 'priming'
              ? `Pump is running; corrections begin${delay !== undefined ? ` after ${delay.toFixed(0)} ms` : ' after the activation delay'}.`
              : allMet
                ? 'All conditions are met; corrections follow the activation delay.'
                : `The pump starts when every condition is met.${delay !== undefined ? ` Corrections begin ${delay.toFixed(0)} ms after the pump starts.` : ''}`}
        {enablePin > 0 ? ' The external enable input must also be on.' : ''}
      </p>
    </WmiPanel>
  );
}

export interface WmiStatusProps {
  values: Record<string, number>;
  meta: Record<string, Constant>;
  isConnected: boolean;
  targetBand: WmiTargetBand;
  onGoTo: (tab: WmiTab) => void;
}

export function WmiStatus({
  values,
  meta,
  isConnected,
  targetBand,
  onGoTo,
}: WmiStatusProps) {
  const live = useChannels([
    'wmiState',
    'wmiPumpDuty',
    'wmiFluidOk',
    'wmiActive',
    'wmiFuelAdder',
    'wmiTimingAdder',
    'wmiEgtFault',
    'wmiEgtHeadroom',
    'wmiFallbackMapsActive',
    'wmiEstimatedFlowGps',
    'wmiFlowFault',
    'egt',
    'egt1',
    'map',
    'rpm',
    'tps',
    'coolant',
    'clt',
  ]);

  const enabled = isOn(values[WMI_CONSTANTS.enabled]);
  const state = wmiStateInfo(isConnected ? live.wmiState : undefined);
  const correctionsActive = isConnected && isOn(live.wmiActive);

  const fluidConfigured = (values[WMI_CONSTANTS.fluidPin] ?? 0) > 0;
  const fluidOk = isConnected ? live.wmiFluidOk : undefined;
  const fluidTone: WmiTone = !fluidConfigured
    ? 'dim'
    : fluidOk === undefined
      ? 'dim'
      : fluidOk >= 0.5 ? 'ok' : 'crit';
  const fluidValue = !fluidConfigured
    ? 'Not fitted'
    : fluidOk === undefined
      ? 'No data'
      : fluidOk >= 0.5 ? 'OK' : 'Fault';
  const fluidDetail = !fluidConfigured
    ? 'No fluid level input'
    : fluidOk === undefined
      ? 'Connect to read the switch'
      : fluidOk >= 0.5 ? 'Level switch closed' : 'Level switch tripped';

  const flowConfigured = (values[WMI_CONSTANTS.flowPin] ?? 0) > 0;
  const flowFault = isConnected && isOn(live.wmiFlowFault);
  const measuredFlow = isConnected ? live.wmiEstimatedFlowGps : undefined;
  const flowMin = values[WMI_CONSTANTS.flowMinGps];
  const flowTone: WmiTone = !flowConfigured
    ? 'dim'
    : !isConnected || live.wmiFlowFault === undefined
      ? 'dim'
      : flowFault ? 'crit' : 'ok';
  const flowValue = !flowConfigured
    ? 'Not fitted'
    : !isConnected || live.wmiFlowFault === undefined
      ? 'No data'
      : flowFault ? 'Fault' : 'OK';
  const flowDetail = !flowConfigured
    ? 'No flow meter configured'
    : measuredFlow !== undefined
      ? `${formatNumber(measuredFlow, 2, ' g/s')}${flowMin !== undefined && flowMin > 0 ? ` · min ${formatNumber(flowMin, 2, ' g/s')}` : ''}`
      : 'Connect to read the flow meter';

  const egtConfigured = isOn(values[WMI_CONSTANTS.egtFault]);
  const egtFault = isConnected && isOn(live.wmiEgtFault);
  const egtTemp = live.egt ?? live.egt1;
  const egtTone: WmiTone = !egtConfigured
    ? 'dim'
    : !isConnected || live.wmiEgtFault === undefined
      ? 'dim'
      : egtFault ? 'crit' : 'ok';
  const egtValue = !egtConfigured
    ? 'Not configured'
    : !isConnected || live.wmiEgtFault === undefined
      ? 'No data'
      : egtFault ? 'Fault' : 'OK';
  const egtDetail = !egtConfigured
    ? 'Enable the EGT guard in Setup'
    : !isConnected || live.wmiEgtFault === undefined
      ? 'Connect to read EGT1'
      : egtTemp !== undefined
        ? `${formatNumber(egtTemp, 0, ' °C')}${live.wmiEgtHeadroom !== undefined ? ` · ${formatNumber(live.wmiEgtHeadroom, 0, ' °C')} headroom` : ''}`
        : 'No EGT1 channel published';

  const fallbackConfigured = isOn(values[WMI_CONSTANTS.fallbackMaps]);
  const fallbackActive = isConnected && isOn(live.wmiFallbackMapsActive);
  const fallbackTone: WmiTone = !fallbackConfigured || !isConnected
    ? 'dim'
    : fallbackActive ? 'warn' : 'ok';
  const fallbackValue = !fallbackConfigured
    ? 'Not configured'
    : !isConnected
      ? 'No data'
      : fallbackActive ? 'Active' : 'Ready';
  const fallbackDetail = !fallbackConfigured
    ? 'No fallback maps selected'
    : !isConnected
      ? 'Connect to read the guard'
      : fallbackActive ? 'No-WMI maps are engaged' : 'Switches maps on fault';

  const faults = [
    fluidConfigured && fluidOk !== undefined && fluidOk < 0.5 ? 'fluid level' : null,
    flowConfigured && flowFault ? 'flow' : null,
    egtConfigured && egtFault ? 'EGT' : null,
  ].filter((fault): fault is string => fault !== null);
  const faulted = enabled && (state.key === 'fault' || faults.length > 0);

  const correctionsTone: WmiTone = correctionsActive ? 'ok' : 'dim';
  const fuelAdder = formatSigned(live.wmiFuelAdder, 0, '%');
  const timingAdder = formatSigned(live.wmiTimingAdder, 1, '°');

  const nozzle = values[WMI_CONSTANTS.nozzleCcMin];
  const nozzleCalibrated = nozzle !== undefined && nozzle > 0 && nozzle <= 2000;
  const methanolPct = values[WMI_CONSTANTS.methanolPct];
  const waterFraction = methanolPct !== undefined
    ? mixtureWaterMassFraction(methanolPct)
    : undefined;

  const pumping = enabled && (state.key === 'priming' || state.key === 'active');
  const rawWf = isConnected ? live.wmiWfRatio : undefined;
  const wfValue = rawWf !== undefined && Number.isFinite(rawWf) && rawWf > 0
    ? rawWf
    : undefined;

  const showActivation = enabled;

  return (
    <div className="wmi-status">
      <div className="wmi-status__main">
        {!enabled ? (
          <WmiNotice
            tone="info"
            title="WMI is disabled"
            action={<WmiButton onClick={() => onGoTo('setup')}>Open setup</WmiButton>}
          >
            The pump output is released and no WMI corrections are applied. Tune settings
            remain editable.
          </WmiNotice>
        ) : null}

        {faulted ? (
          <WmiNotice
            tone="crit"
            title={faults.length > 0 ? `WMI fault: ${faults.join(', ')}` : 'WMI fault'}
          >
            {fallbackActive ? 'Fallback maps are active. ' : ''}
            Corrections are withheld until the fault clears. Check the guard panel
            {faults.length === 0 ? ' and the ECU warning log' : ''}.
          </WmiNotice>
        ) : null}

        <WmiPanel
          title="Fluid path"
          className="wmi-panel--schematic"
          meta={
            <span className="wmi-live-meta">
              <WmiDot
                tone={!isConnected ? 'dim' : faulted ? 'crit' : pumping ? 'ok' : enabled ? 'info' : 'dim'}
              />
              {!isConnected
                ? 'Offline'
                : faulted
                  ? 'Fault'
                  : pumping
                    ? 'Spraying'
                    : enabled ? 'Armed' : 'Disabled'}
            </span>
          }
        >
          <WmiSchematic
            enabled={enabled}
            running={pumping}
            fault={faulted}
            isConnected={isConnected}
            duty={isConnected ? live.wmiPumpDuty : undefined}
            pwmFrequency={values[WMI_CONSTANTS.pwmFrequency]}
            fluidFitted={fluidConfigured}
            fluidOk={isConnected ? live.wmiFluidOk : undefined}
            flowMonitored={flowConfigured}
            measuredFlow={measuredFlow}
            nozzleCc={nozzleCalibrated && nozzle !== undefined ? nozzle : 0}
            wf={wfValue}
          />
        </WmiPanel>

        {showActivation ? (
          <WmiActivation
            values={values}
            meta={meta}
            live={live}
            state={state}
            faulted={faulted}
            isConnected={isConnected}
          />
        ) : null}

        <WmiHistory
          targetBand={targetBand}
          isConnected={isConnected}
          flowMonitored={flowConfigured}
        />
      </div>

      <aside className="wmi-status__rail" aria-label="WMI guards and corrections">
        <WmiPanel title="Guards" meta="ECU guards">
          <div className="wmi-kv">
            <WmiKvRow label="Fluid level" value={fluidValue} detail={fluidDetail} tone={fluidTone} />
            <WmiKvRow label="Flow" value={flowValue} detail={flowDetail} tone={flowTone} />
            <WmiKvRow label="EGT" value={egtValue} detail={egtDetail} tone={egtTone} />
            <WmiKvRow
              label="Safeguard maps"
              value={fallbackValue}
              detail={fallbackDetail}
              tone={fallbackTone}
            />
          </div>
        </WmiPanel>

        <WmiPanel
          title="Corrections"
          meta={correctionsActive ? 'Live' : 'Withheld'}
        >
          <div className="wmi-kv wmi-kv--compact">
            <WmiKvRow
              label="Fuel"
              value={correctionsActive ? fuelAdder : '—'}
              detail={correctionsActive ? 'Enrichment' : 'Applies while spraying'}
              tone={correctionsTone}
            />
            <WmiKvRow
              label="Ignition"
              value={correctionsActive ? timingAdder : '—'}
              detail={correctionsActive ? 'Advance' : 'Applies while spraying'}
              tone={correctionsTone}
            />
          </div>
          <p className="wmi-panel__note">
            {correctionsActive
              ? 'Applied by the ECU while the pump is running.'
              : state.key === 'priming'
                ? 'Pump is running; corrections follow the activation delay.'
                : 'Corrections are withheld until WMI is active.'}
          </p>
        </WmiPanel>

        <WmiPanel
          title="Calibration"
          meta={nozzleCalibrated ? 'Saved' : 'Not calibrated'}
          actions={
            <WmiButton variant="secondary" onClick={() => onGoTo('bench')}>
              Bench test
            </WmiButton>
          }
        >
          <div className="wmi-kv wmi-kv--compact">
            <WmiKvRow
              label="Nozzle"
              value={nozzleCalibrated && nozzle !== undefined ? `${nozzle.toFixed(0)} cc/min` : '—'}
              detail={nozzleCalibrated ? 'Jug-test result' : 'Nozzle flow not saved'}
              tone={nozzleCalibrated ? 'ok' : 'warn'}
            />
            <WmiKvRow
              label="Mixture"
              value={methanolPct !== undefined ? `${methanolPct.toFixed(0)}% methanol` : '—'}
              detail={
                waterFraction !== undefined
                  ? `${(waterFraction * 100).toFixed(1)}% water by mass`
                  : 'Methanol % not exposed'
              }
              tone={methanolPct !== undefined ? 'info' : 'dim'}
            />
            <WmiKvRow
              label="Target W/F"
              value={`${targetBand.min.toFixed(2)}–${targetBand.max.toFixed(2)}`}
              detail="LibreTune project setting"
              tone="info"
            />
          </div>
          <p className="wmi-panel__note">
            W/F uses water mass only. The ECU reports the live ratio; the target is not
            written to the tune.
          </p>
        </WmiPanel>
      </aside>
    </div>
  );
}
