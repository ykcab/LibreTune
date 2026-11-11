import { useEffect, useState } from 'react';
import { WMI_CONSTANTS, WMI_EDITOR_LINKS, type WmiTab } from './wmiConstants';
import { WmiButton, WmiNotice, WmiPanel } from './WmiLayout';
import { WmiField } from './WmiField';
import { WmiEgtGuard, WmiFaultResponse } from './WmiSafety';
import type { Constant } from '../dialogs/types';
import { formatNumber, isOn } from './wmiFormat';
import {
  mixtureCoolingRatio,
  mixtureDensityGPerCc,
  mixtureWaterMassFraction,
} from './wmiMath';
import type { WmiTargetBand } from './useWmi';

export interface WmiSetupProps {
  values: Record<string, number>;
  missing: Set<string>;
  meta: Record<string, Constant>;
  onCommit: (name: string, value: number) => Promise<void>;
  onGoTo: (tab: WmiTab) => void;
  openTarget?: (target: string) => void;
  targetBand: WmiTargetBand;
  onSaveTargetBand: (min: number, max: number) => Promise<void>;
  targetBandLoading?: boolean;
  targetBandError?: string | null;
}

function WmiTargetBandEditor({
  band,
  loading = false,
  loadError,
  onSave,
}: {
  band: WmiTargetBand;
  loading?: boolean;
  loadError?: string | null;
  onSave: (min: number, max: number) => Promise<void>;
}) {
  const [minText, setMinText] = useState(band.min.toFixed(2));
  const [maxText, setMaxText] = useState(band.max.toFixed(2));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMinText(band.min.toFixed(2));
    setMaxText(band.max.toFixed(2));
  }, [band.min, band.max]);

  const parsedMin = Number.parseFloat(minText);
  const parsedMax = Number.parseFloat(maxText);
  const valid = Number.isFinite(parsedMin)
    && Number.isFinite(parsedMax)
    && parsedMin >= 0
    && parsedMax > parsedMin
    && parsedMax <= 10;
  const dirty = Number.isFinite(parsedMin)
    && Number.isFinite(parsedMax)
    && (parsedMin !== band.min || parsedMax !== band.max);

  const save = async () => {
    if (!valid) {
      setError('Use 0 ≤ minimum < maximum ≤ 10.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await onSave(parsedMin, parsedMax);
      setMessage(`Saved target ${parsedMin.toFixed(2)}–${parsedMax.toFixed(2)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const previewMin = valid ? parsedMin : band.min;
  const previewMax = valid ? parsedMax : band.max;
  const scaleMax = Math.max(0.5, previewMax * 1.5);
  const left = (previewMin / scaleMax) * 100;
  const width = ((previewMax - previewMin) / scaleMax) * 100;

  return (
    <div className="wmi-band-form">
      <div className="wmi-band-form__inputs">
        <div className="wmi-band-form__field">
          <label htmlFor="wmi-target-min">Minimum W/F</label>
          <input
            id="wmi-target-min"
            className="wmi-input"
            type="text"
            inputMode="decimal"
            value={minText}
            disabled={loading || saving}
            onChange={(event) => {
              if (/^\d*\.?\d*$/.test(event.target.value)) {
                setMinText(event.target.value);
                setMessage(null);
                setError(null);
              }
            }}
          />
        </div>
        <div className="wmi-band-form__field">
          <label htmlFor="wmi-target-max">Maximum W/F</label>
          <input
            id="wmi-target-max"
            className="wmi-input"
            type="text"
            inputMode="decimal"
            value={maxText}
            disabled={loading || saving}
            onChange={(event) => {
              if (/^\d*\.?\d*$/.test(event.target.value)) {
                setMaxText(event.target.value);
                setMessage(null);
                setError(null);
              }
            }}
          />
        </div>
        <WmiButton
          variant="primary"
          onClick={() => void save()}
          disabled={loading || saving || !valid || !dirty}
        >
          {saving ? 'Saving…' : 'Save target'}
        </WmiButton>
      </div>

      <div className="wmi-band-preview" aria-hidden="true">
        <div className="wmi-band-preview__track">
          <span
            className="wmi-band-preview__zone"
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        </div>
        <div className="wmi-band-preview__axis">
          <span>0.00</span>
          <span>target {previewMin.toFixed(2)}–{previewMax.toFixed(2)}</span>
          <span>{scaleMax.toFixed(2)}</span>
        </div>
      </div>

      <p className="wmi-panel__note">
        This is a LibreTune project setting. It is not written to the ECU; the firmware only
        reports the live W/F ratio.
      </p>
      {loadError ? <p className="wmi-row__error" role="alert">{loadError}</p> : null}
      {message ? <p className="wmi-panel__note wmi-panel__note--ok" role="status">{message}</p> : null}
      {error ? <p className="wmi-row__error" role="alert">{error}</p> : null}
    </div>
  );
}

export function WmiSetup({
  values,
  missing,
  meta,
  onCommit,
  onGoTo,
  openTarget,
  targetBand,
  onSaveTargetBand,
  targetBandLoading = false,
  targetBandError = null,
}: WmiSetupProps) {
  const available = (name: string) => !missing.has(name) && values[name] !== undefined;

  const outputNames = [
    WMI_CONSTANTS.outputPin,
    WMI_CONSTANTS.outputPinMode,
    WMI_CONSTANTS.pwmFrequency,
  ];
  const inputNames = [
    WMI_CONSTANTS.fluidPin,
    WMI_CONSTANTS.fluidPinMode,
    WMI_CONSTANTS.enablePin,
    WMI_CONSTANTS.enablePinMode,
    WMI_CONSTANTS.flowPin,
    WMI_CONSTANTS.flowHzPerLmin,
    WMI_CONSTANTS.flowMinGps,
  ];
  const activationNames = [
    WMI_CONSTANTS.minMap,
    WMI_CONSTANTS.minRpm,
    WMI_CONSTANTS.minTps,
    WMI_CONSTANTS.minClt,
    WMI_CONSTANTS.activationDelayMs,
    WMI_CONSTANTS.fluidDebounceMs,
    WMI_CONSTANTS.dutyIfError,
  ];
  const fluidNames = [WMI_CONSTANTS.methanolPct, WMI_CONSTANTS.nozzleCcMin];
  const faultNames = [
    WMI_CONSTANTS.fallbackMaps,
    WMI_CONSTANTS.fallbackVe1,
    WMI_CONSTANTS.fallbackVe2,
    WMI_CONSTANTS.fallbackIgn1,
    WMI_CONSTANTS.fallbackIgn2,
    WMI_CONSTANTS.fallbackOlBoost1,
    WMI_CONSTANTS.fallbackClBoost1,
    WMI_CONSTANTS.fallbackAfr1,
    WMI_CONSTANTS.safetyRetard,
    WMI_CONSTANTS.faultTimingRetard,
    WMI_CONSTANTS.fuelCut,
  ];
  const egtNames = [
    WMI_CONSTANTS.egtFault,
    WMI_CONSTANTS.egtThreshold,
    WMI_CONSTANTS.egtBaseline,
  ];

  const hasOutput = outputNames.some(available);
  const hasInputs = inputNames.some(available);
  const hasActivation = activationNames.some(available);
  const hasFluid = fluidNames.some(available);
  const hasFaults = faultNames.some(available);
  const hasEgt = egtNames.some(available);

  const enabled = isOn(values[WMI_CONSTANTS.enabled]);
  const pumpConfigured = (values[WMI_CONSTANTS.outputPin] ?? 0) > 0;
  const fluidPin = values[WMI_CONSTANTS.fluidPin] ?? 0;
  const enablePin = values[WMI_CONSTANTS.enablePin] ?? 0;
  const flowPin = values[WMI_CONSTANTS.flowPin] ?? 0;
  const nozzle = values[WMI_CONSTANTS.nozzleCcMin];
  const nozzleCalibrated = nozzle !== undefined && nozzle > 0 && nozzle <= 2000;
  const methanolPct = values[WMI_CONSTANTS.methanolPct];

  const missingCount = (names: string[]) => names.filter((name) => missing.has(name)).length;
  const missingNote = (names: string[]) => {
    const count = missingCount(names);
    if (count === 0) return null;
    return (
      <p className="wmi-panel__note wmi-panel__note--dim">
        {count} optional setting{count === 1 ? '' : 's'} not exposed by this ECU definition.
      </p>
    );
  };

  const thresholdParts: string[] = [];
  if (available(WMI_CONSTANTS.minMap)) {
    const units = meta[WMI_CONSTANTS.minMap]?.units ?? '';
    thresholdParts.push(`MAP ≥ ${formatNumber(values[WMI_CONSTANTS.minMap], 0, units ? ` ${units}` : '')}`);
  }
  if (available(WMI_CONSTANTS.minRpm)) {
    const units = meta[WMI_CONSTANTS.minRpm]?.units ?? '';
    thresholdParts.push(`RPM ≥ ${formatNumber(values[WMI_CONSTANTS.minRpm], 0, units ? ` ${units}` : '')}`);
  }
  if (available(WMI_CONSTANTS.minTps)) {
    const units = meta[WMI_CONSTANTS.minTps]?.units ?? '';
    thresholdParts.push(`TPS ≥ ${formatNumber(values[WMI_CONSTANTS.minTps], 0, units ? ` ${units}` : '')}`);
  }
  if (available(WMI_CONSTANTS.minClt)) {
    const units = meta[WMI_CONSTANTS.minClt]?.units ?? '';
    thresholdParts.push(`coolant ≥ ${formatNumber(values[WMI_CONSTANTS.minClt], 0, units ? ` ${units}` : '')}`);
  }

  const navItems = [
    { id: 'wmi-sec-master', label: 'Master', show: true },
    { id: 'wmi-sec-hardware', label: 'Hardware', show: hasOutput || hasInputs },
    { id: 'wmi-sec-activation', label: 'Activation', show: hasActivation },
    { id: 'wmi-sec-fluid', label: 'Fluid & nozzle', show: hasFluid },
    { id: 'wmi-sec-target', label: 'Target band', show: true },
    { id: 'wmi-sec-faults', label: 'Fault response', show: hasFaults },
    { id: 'wmi-sec-egt', label: 'EGT guard', show: hasEgt },
    { id: 'wmi-sec-tables', label: 'Tables & curves', show: true },
  ].filter((item) => item.show);

  const scrollTo = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const field = (
    name: string,
    label: string,
    hint?: string,
    variant: 'number' | 'select' | 'toggle' = 'number',
    disabled = false,
  ) => (
    <WmiField
      name={name}
      label={label}
      hint={hint}
      values={values}
      missing={missing}
      meta={meta[name]}
      onCommit={onCommit}
      variant={variant}
      disabled={disabled}
    />
  );

  return (
    <div className="wmi-config">
      <nav className="wmi-config__nav" aria-label="WMI settings sections">
        <span className="wmi-config__nav-title">Sections</span>
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className="wmi-config__nav-item"
            onClick={() => scrollTo(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="wmi-config__content">
        <WmiPanel
          id="wmi-sec-master"
          title="Master"
          meta={enabled ? 'Enabled' : 'Disabled'}
          actions={
            <WmiButton onClick={() => onGoTo('status')}>View live status</WmiButton>
          }
        >
          {field(
            WMI_CONSTANTS.enabled,
            'Water/methanol injection',
            'Master enable. When off, the pump output is released and no corrections are applied.',
            'toggle',
          )}
          <p className="wmi-panel__note">
            {enabled
              ? 'WMI is armed in this tune. Activation thresholds and fault response apply.'
              : 'WMI is off. The settings below remain editable and take effect when it is enabled.'}
          </p>
          {enabled && !pumpConfigured ? (
            <WmiNotice tone="warn" title="No pump output assigned">
              WMI is enabled, but no output pin is configured. The controller cannot drive the
              external pump driver.
            </WmiNotice>
          ) : null}
        </WmiPanel>

        {hasOutput || hasInputs ? (
          <WmiPanel
            id="wmi-sec-hardware"
            title="Hardware"
            meta="ECU I/O"
          >
            {hasOutput ? (
              <div className="wmi-group">
                <h3 className="wmi-group__title">Pump output</h3>
                <p className="wmi-group__note">
                  The ECU drives a signal to an external PWM driver. It does not source pump
                  current.
                </p>
                <div className="wmi-rows">
                  {field(
                    WMI_CONSTANTS.outputPin,
                    'Pump output pin',
                    'Signal to the external pump driver.',
                  )}
                  {field(WMI_CONSTANTS.outputPinMode, 'Output pin mode')}
                  {field(
                    WMI_CONSTANTS.pwmFrequency,
                    'PWM frequency',
                    '0 = on/off control. Otherwise the switching frequency the driver expects.',
                  )}
                </div>
              </div>
            ) : null}

            {hasInputs ? (
              <div className="wmi-group">
                <h3 className="wmi-group__title">Inputs</h3>
                <p className="wmi-group__note">
                  All inputs are optional. A guard appears only when its input is configured.
                </p>
                <div className="wmi-rows">
                  {field(
                    WMI_CONSTANTS.fluidPin,
                    'Fluid level input',
                    'Logic high = fluid present. None = no level guard.',
                  )}
                  {fluidPin > 0 ? field(WMI_CONSTANTS.fluidPinMode, 'Fluid level pin mode') : null}
                  {field(
                    WMI_CONSTANTS.enablePin,
                    'Enable input',
                    'Optional external arm switch. None = activation thresholds only.',
                  )}
                  {enablePin > 0 ? field(WMI_CONSTANTS.enablePinMode, 'Enable pin mode') : null}
                  {field(
                    WMI_CONSTANTS.flowPin,
                    'Flow meter input',
                    'Hall-effect meter such as the YF-B1. None = no measured flow.',
                  )}
                  {flowPin > 0
                    ? field(
                        WMI_CONSTANTS.flowHzPerLmin,
                        'Flow meter scale',
                        '0 = use the YF-B1 default of 11 Hz per L/min.',
                      )
                    : null}
                  {flowPin > 0
                    ? field(
                        WMI_CONSTANTS.flowMinGps,
                        'Minimum flow while spraying',
                        '0 = do not fault a silent meter.',
                      )
                    : null}
                </div>
              </div>
            ) : null}
            {missingNote([...outputNames, ...inputNames])}
          </WmiPanel>
        ) : null}

        {hasActivation ? (
          <WmiPanel id="wmi-sec-activation" title="Activation" meta="Thresholds">
            {thresholdParts.length > 0 ? (
              <p className="wmi-config-summary">
                Starts when {thresholdParts.join(', ')}.
              </p>
            ) : null}
            <p className="wmi-group__note">
              Every threshold must be met before the pump starts. A value of 0 usually disables
              that minimum.
            </p>
            <div className="wmi-rows">
              {field(WMI_CONSTANTS.minMap, 'Minimum MAP', 'MAP required before the pump starts.')}
              {field(WMI_CONSTANTS.minRpm, 'Minimum RPM')}
              {field(WMI_CONSTANTS.minTps, 'Minimum throttle')}
              {field(WMI_CONSTANTS.minClt, 'Minimum coolant temperature', 'Oil-dilution guard.')}
              {field(
                WMI_CONSTANTS.activationDelayMs,
                'Activation delay',
                'Wait after the pump starts before corrections apply.',
              )}
              {field(
                WMI_CONSTANTS.fluidDebounceMs,
                'Fluid fault debounce',
                'Ignore level-switch dropouts shorter than this.',
              )}
              {field(
                WMI_CONSTANTS.dutyIfError,
                'Duty if error',
                'Pump duty when a required sensor faults. 0 = stop the pump.',
              )}
            </div>
            {missingNote(activationNames)}
          </WmiPanel>
        ) : null}

        {hasFluid ? (
          <WmiPanel
            id="wmi-sec-fluid"
            title="Fluid & nozzle"
            meta={nozzleCalibrated ? 'Calibrated' : 'Not calibrated'}
            actions={
              <WmiButton onClick={() => onGoTo('bench')}>
                {nozzleCalibrated ? 'Recalibrate' : 'Calibrate'}
              </WmiButton>
            }
          >
            <div className="wmi-rows">
              {field(
                WMI_CONSTANTS.methanolPct,
                'Methanol by volume',
                'Percent by volume. 50 = a common 50/50 mix.',
              )}
              {field(
                WMI_CONSTANTS.nozzleCcMin,
                'Nozzle flow at 100% duty',
                'cc collected in 60 s at 100% duty. 0 = modeled flow and W/F off.',
              )}
            </div>
            {methanolPct !== undefined ? (
              <div className="wmi-mix">
                <div className="wmi-mix__item">
                  <span>Water by mass</span>
                  <strong>{(mixtureWaterMassFraction(methanolPct) * 100).toFixed(1)}%</strong>
                </div>
                <div className="wmi-mix__item">
                  <span>Mixture density</span>
                  <strong>{mixtureDensityGPerCc(methanolPct).toFixed(3)} g/cc</strong>
                </div>
                <div className="wmi-mix__item">
                  <span>Cooling vs water</span>
                  <strong>{(mixtureCoolingRatio(methanolPct) * 100).toFixed(0)}%</strong>
                </div>
              </div>
            ) : null}
            <p className="wmi-panel__note">
              Nozzle flow is a jug-test result, not the rated catalogue number.
              {!nozzleCalibrated ? ' Modeled flow and W/F stay unavailable until a value is saved.' : ''}
            </p>
            {missingNote(fluidNames)}
          </WmiPanel>
        ) : null}

        <WmiPanel id="wmi-sec-target" title="Target band" meta="Project setting">
          <WmiTargetBandEditor
            band={targetBand}
            loading={targetBandLoading}
            loadError={targetBandError}
            onSave={onSaveTargetBand}
          />
        </WmiPanel>

        {hasFaults ? (
          <WmiPanel id="wmi-sec-faults" title="Fault response" meta="On fault">
            <WmiFaultResponse
              values={values}
              missing={missing}
              meta={meta}
              onCommit={onCommit}
            />
            {missingNote(faultNames)}
          </WmiPanel>
        ) : null}

        {hasEgt ? (
          <WmiPanel id="wmi-sec-egt" title="EGT guard" meta={isOn(values[WMI_CONSTANTS.egtFault]) ? 'On' : 'Off'}>
            <WmiEgtGuard
              values={values}
              missing={missing}
              meta={meta}
              onCommit={onCommit}
            />
            {missingNote(egtNames)}
          </WmiPanel>
        ) : null}

        <WmiPanel id="wmi-sec-tables" title="Tables & curves" meta="Native editors">
          <p className="wmi-group__note">
            These open in their native table and curve editors. The ECU applies them while WMI
            is active.
          </p>
          <div className="wmi-links">
            {WMI_EDITOR_LINKS.map((link) => (
              <button
                key={link.target}
                type="button"
                className="wmi-link"
                onClick={() => openTarget?.(link.target)}
                disabled={!openTarget}
                title={openTarget
                  ? `Open ${link.label}`
                  : 'Open this view in the main window to edit tables.'}
              >
                <span className="wmi-link__text">
                  <strong>{link.label}</strong>
                  <em>{link.detail}</em>
                </span>
                <span className="wmi-link__arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          {!openTarget ? (
            <p className="wmi-panel__note">
              Table editing is unavailable in this window. Open WMI from the main window to
              edit the tables.
            </p>
          ) : null}
        </WmiPanel>
      </div>
    </div>
  );
}
