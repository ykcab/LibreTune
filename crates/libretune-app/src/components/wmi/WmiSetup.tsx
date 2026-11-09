import { useEffect, useState } from 'react';
import { useChannels } from '../../stores/realtimeStore';
import { WMI_CONSTANTS, WMI_EDITOR_LINKS, type WmiTab } from './wmiConstants';
import { WmiButton, WmiCallout, WmiSection, WmiTile } from './WmiLayout';
import { WmiField } from './WmiField';
import { formatNumber, isOn } from './wmiFormat';
import type { WmiTargetBand } from './useWmi';

export type WmiSetupSection = 'activation' | 'hardware';

export interface WmiSetupProps {
  section: WmiSetupSection;
  values: Record<string, number>;
  missing: Set<string>;
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
  const [minText, setMinText] = useState(String(band.min));
  const [maxText, setMaxText] = useState(String(band.max));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMinText(String(band.min));
    setMaxText(String(band.max));
  }, [band.min, band.max]);

  const parsedMin = Number.parseFloat(minText);
  const parsedMax = Number.parseFloat(maxText);
  const valid = Number.isFinite(parsedMin)
    && Number.isFinite(parsedMax)
    && parsedMin >= 0
    && parsedMax > parsedMin
    && parsedMax <= 10;

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
      setMessage(`Saved target band ${parsedMin.toFixed(2)}–${parsedMax.toFixed(2)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wmi-band-editor">
      <div className="wmi-band-editor__inputs">
        <label>
          <span>Minimum W/F</span>
          <input
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
        </label>
        <label>
          <span>Maximum W/F</span>
          <input
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
        </label>
        <WmiButton variant="primary" onClick={() => void save()} disabled={loading || saving || !valid}>
          {saving ? 'Saving…' : 'Save band'}
        </WmiButton>
      </div>
      <p className="wmi-note">
        This is a LibreTune project setting. It is not written to the ECU; the firmware only
        reports the live W/F ratio.
      </p>
      {loadError ? <p className="wmi-note wmi-note--error">{loadError}</p> : null}
      {message ? <p className="wmi-note wmi-note--ok">{message}</p> : null}
      {error ? <p className="wmi-note wmi-note--error">{error}</p> : null}
    </div>
  );
}

export function WmiSetup({
  section,
  values,
  missing,
  onCommit,
  onGoTo,
  openTarget,
  targetBand,
  onSaveTargetBand,
  targetBandLoading = false,
  targetBandError = null,
}: WmiSetupProps) {
  const live = useChannels([
    'wmiActive',
    'wmiFuelAdder',
    'wmiTimingAdder',
    'wmiCoolingRatio',
  ]);
  const enabled = isOn(values[WMI_CONSTANTS.enabled]);
  const correctionsActive = isOn(live.wmiActive);
  const showHardware = section === 'hardware';
  const showActivation = section === 'activation';
  const fluidPin = values[WMI_CONSTANTS.fluidPin] ?? 0;
  const enablePin = values[WMI_CONSTANTS.enablePin] ?? 0;
  const flowPin = values[WMI_CONSTANTS.flowPin] ?? 0;
  const nozzle = values[WMI_CONSTANTS.nozzleCcMin] ?? 0;

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
      onCommit={onCommit}
      variant={variant}
      disabled={disabled || !enabled}
    />
  );

  return (
    <div className="wmi-page">
      {showHardware ? (
        <>
          <WmiSection
            title="Master"
            description="The ECU remains the authority. These fields edit the tune, not a separate controller."
          >
            <div className="wmi-field-grid wmi-field-grid--one">
              <WmiField
                name={WMI_CONSTANTS.enabled}
                label="Enable water/methanol injection"
                hint="When off, the pump output is released and no WMI corrections are applied."
                values={values}
                missing={missing}
                onCommit={onCommit}
                variant="toggle"
              />
            </div>
          </WmiSection>

          {!enabled ? (
            <WmiCallout tone="info">
              Enable WMI above to expose the hardware, threshold and fluid settings.
            </WmiCallout>
          ) : null}

          <WmiSection
            title="W/F target band"
            description="A calibration target for the water-mass / fuel-mass ratio. Stored in the LibreTune project."
          >
            <WmiTargetBandEditor
              band={targetBand}
              loading={targetBandLoading}
              loadError={targetBandError}
              onSave={onSaveTargetBand}
            />
          </WmiSection>

          <WmiSection
            title="Hardware"
            description="The ECU drives a signal to an external PWM driver. It does not source pump current."
          >
            <div className="wmi-field-grid">
              {field(WMI_CONSTANTS.outputPin, 'Pump output pin', 'Signal to the external PWM driver.')}
              {field(WMI_CONSTANTS.outputPinMode, 'Output mode')}
              {field(
                WMI_CONSTANTS.pwmFrequency,
                'PWM frequency',
                '0 = on/off mode. Set the frequency the external driver expects.',
              )}
              {field(WMI_CONSTANTS.fluidPin, 'Fluid level pin', 'Logic HIGH = fluid OK; LOW = fault.')}
              {fluidPin > 0 ? field(WMI_CONSTANTS.fluidPinMode, 'Fluid level pin mode') : null}
              {field(WMI_CONSTANTS.enablePin, 'Enable pin', 'Optional extra gate. NONE = thresholds alone.')}
              {enablePin > 0 ? field(WMI_CONSTANTS.enablePinMode, 'Enable pin mode') : null}
              {field(WMI_CONSTANTS.flowPin, 'Flow meter pin', 'YF-B1 hall signal. NONE = no flow reading.')}
              {flowPin > 0
                ? field(
                    WMI_CONSTANTS.flowHzPerLmin,
                    'Flow meter Hz per L/min',
                    '0 = 11 for the YF-B1 (f = 11 × Q).',
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
          </WmiSection>

          <WmiSection
            title="Fluid and nozzle"
            description="Nozzle flow is a jug-test result, not a rated catalogue number."
            actions={
              <WmiButton onClick={() => onGoTo('calibration')}>
                {nozzle > 0 ? 'Recalibrate' : 'Calibrate'}
              </WmiButton>
            }
          >
            <div className="wmi-field-grid">
              {field(
                WMI_CONSTANTS.methanolPct,
                'Methanol % by volume',
                '50 = common 50/50 mix. Scales cooling and IAT correction.',
              )}
              {field(
                WMI_CONSTANTS.nozzleCcMin,
                'Nozzle flow at 100% duty',
                'cc collected in 60 s at 100% duty. 0 = modeled flow and W/F off.',
              )}
            </div>
            <p className="wmi-note">
              {nozzle > 0
                ? `Saved nozzle: ${nozzle.toFixed(0)} cc/min. W/F uses the water mass fraction only.`
                : 'No nozzle calibration yet. Modeled flow and W/F stay unavailable until you run the wizard.'}
            </p>
          </WmiSection>
        </>
      ) : null}

      {showActivation ? (
        <>
          {!enabled ? (
            <WmiCallout tone="info">
              <span>Enable WMI in Hardware to expose activation thresholds.</span>
              <WmiButton onClick={() => onGoTo('hardware')}>Open Hardware</WmiButton>
            </WmiCallout>
          ) : null}

          <WmiSection
            title="Live corrections"
            description="Applied by the firmware while WMI is active; this view only displays them."
          >
            <div className="wmi-grid wmi-grid--three">
              <WmiTile
                label="Fuel adder"
                value={correctionsActive ? formatNumber(live.wmiFuelAdder, 0, '%') : '—'}
                detail={correctionsActive ? 'Live enrichment' : 'Corrections withheld'}
                tone={correctionsActive ? 'ok' : 'dim'}
              />
              <WmiTile
                label="Timing adder"
                value={correctionsActive ? formatNumber(live.wmiTimingAdder, 1, '°') : '—'}
                detail={correctionsActive ? 'Live advance' : 'Corrections withheld'}
                tone={correctionsActive ? 'ok' : 'dim'}
              />
              <WmiTile
                label="Cooling ratio"
                value={formatNumber(live.wmiCoolingRatio, 0, '%')}
                detail="Mixture vs pure water"
                tone="info"
              />
            </div>
          </WmiSection>

          <WmiSection
            title="Activation thresholds"
            description="WMI starts only when every threshold is met."
          >
            <div className="wmi-field-grid">
              {field(WMI_CONSTANTS.minMap, 'Minimum MAP')}
              {field(WMI_CONSTANTS.minRpm, 'Minimum RPM')}
              {field(WMI_CONSTANTS.minTps, 'Minimum TPS')}
              {field(WMI_CONSTANTS.minClt, 'Minimum coolant temperature')}
              {field(WMI_CONSTANTS.activationDelayMs, 'Activation delay', 'Pump-to-nozzle lag before corrections.')}
              {field(WMI_CONSTANTS.fluidDebounceMs, 'Fluid fault debounce')}
              {field(
                WMI_CONSTANTS.dutyIfError,
                'Duty if error',
                '0 = pump off on any required-sensor fault.',
              )}
            </div>
          </WmiSection>

          <WmiSection
            title="Corrections and duty"
            description="These open in their native table or curve editor."
          >
            <div className="wmi-link-list">
              {WMI_EDITOR_LINKS.map((link) => (
                <button
                  key={link.target}
                  type="button"
                  className="wmi-link"
                  onClick={() => openTarget?.(link.target)}
                  disabled={!openTarget}
                >
                  <span>
                    <strong>{link.label}</strong>
                    <em>{link.detail}</em>
                  </span>
                  <span className="wmi-link__arrow">↗</span>
                </button>
              ))}
            </div>
          </WmiSection>
        </>
      ) : null}
    </div>
  );
}
