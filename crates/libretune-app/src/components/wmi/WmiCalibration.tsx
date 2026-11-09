import { useMemo, useState } from 'react';
import { WMI_CONSTANTS, type WmiAction } from './wmiConstants';
import { WmiButton, WmiCallout, WmiSection, WmiTile } from './WmiLayout';
import { formatNumber, isOn } from './wmiFormat';
import {
  ccMinFromCollectedCc,
  mixtureDensityGPerCc,
  mixtureWaterMassFraction,
  modeledMixtureFlowGps,
  modeledWaterFlowGps,
} from './wmiMath';
import type { WmiRun } from './useWmi';

const CHECKS = [
  {
    id: 'engine-off',
    label: 'Engine is off',
    detail: 'The pump test is a hardware action, not a running-engine feature.',
  },
  {
    id: 'supply',
    label: 'Pump supply is connected',
    detail: '12 V through the external PWM driver; the ECU only drives the signal.',
  },
  {
    id: 'container',
    label: 'Nozzle is in a measuring container',
    detail: 'The 60 s run sprays the full nozzle flow.',
  },
  {
    id: 'primed',
    label: 'Line is primed and leak-free',
    detail: 'Prime first if the pump-to-nozzle line is empty.',
  },
] as const;

export interface WmiCalibrationProps {
  values: Record<string, number>;
  isConnected: boolean;
  engineRunning: boolean;
  hasCalibration: boolean;
  run: WmiRun | null;
  lastCompleted: WmiRun | null;
  remaining: number;
  busy: boolean;
  onStart: (action: WmiAction) => void;
  onCancel: () => void;
  onCommit: (name: string, value: number) => Promise<void>;
}

export function WmiCalibration({
  values,
  isConnected,
  engineRunning,
  hasCalibration,
  run,
  lastCompleted,
  remaining,
  busy,
  onStart,
  onCancel,
  onCommit,
}: WmiCalibrationProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [measuredCc, setMeasuredCc] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const enabled = isOn(values[WMI_CONSTANTS.enabled]);
  const pumpConfigured = (values[WMI_CONSTANTS.outputPin] ?? 0) > 0;
  const currentNozzle = values[WMI_CONSTANTS.nozzleCcMin] ?? 0;
  const methanolPct = values[WMI_CONSTANTS.methanolPct] ?? 50;
  const allChecked = CHECKS.every((check) => checked[check.id]);
  const calibrationDone = lastCompleted?.action === 'calibrate';

  const parsedMeasured = Number.parseFloat(measuredCc);
  const previewNozzle = Number.isFinite(parsedMeasured) && parsedMeasured > 0
    ? parsedMeasured
    : currentNozzle;

  const preview = useMemo(() => {
    const density = mixtureDensityGPerCc(methanolPct);
    const waterFraction = mixtureWaterMassFraction(methanolPct);
    return {
      density,
      waterFraction,
      mixture100: modeledMixtureFlowGps(previewNozzle, 100, methanolPct),
      water100: modeledWaterFlowGps(previewNozzle, 100, methanolPct),
      mixture50: modeledMixtureFlowGps(previewNozzle, 50, methanolPct),
      water50: modeledWaterFlowGps(previewNozzle, 50, methanolPct),
    };
  }, [methanolPct, previewNozzle]);

  const canStart = enabled
    && pumpConfigured
    && isConnected
    && hasCalibration
    && !engineRunning
    && allChecked
    && !run
    && !busy;

  const save = async () => {
    const ccMin = ccMinFromCollectedCc(parsedMeasured);
    if (!(ccMin > 0) || ccMin > 2000) {
      setSaveError('Enter the collected volume in cc (greater than 0, up to 2000 cc/min).');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSavedMessage(null);
    try {
      await onCommit(WMI_CONSTANTS.nozzleCcMin, ccMin);
      setSavedMessage(`Saved ${ccMin.toFixed(0)} cc/min as the nozzle calibration.`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wmi-page wmi-page--calibration">
      <WmiCallout tone="warn">
        <strong>60 s at 100% duty.</strong>
        <span>
          This runs the pump and sprays fluid. Keep the engine off, route the nozzle into a
          measuring container, and stay with the vehicle while the run is active.
        </span>
      </WmiCallout>

      {!hasCalibration ? (
        <WmiCallout tone="warn">
          This ECU definition has no 60 s calibration command. Update the firmware/INI, or use
          Test and Prime from the Live tab.
        </WmiCallout>
      ) : null}

      {!enabled || !pumpConfigured ? (
        <WmiCallout tone="warn">
          WMI must be enabled with a pump output pin before calibration.
        </WmiCallout>
      ) : null}

      <div className="wmi-stepper" aria-label="Calibration progress">
        {[
          { label: 'Hardware', state: 'done' },
          { label: 'Fluid', state: 'done' },
          { label: 'Jug test', state: 'active' },
          { label: 'Verify', state: 'todo' },
        ].map((step, index) => (
          <div key={step.label} className={`wmi-step wmi-step--${step.state}`}>
            <span className="wmi-step__dot">{step.state === 'done' ? '✓' : index + 1}</span>
            <span className="wmi-step__label">{step.label}</span>
            {index < 3 ? <span className="wmi-step__line" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>

      <WmiSection
        title="Before you run"
        description="Every box must be checked. The ECU still enforces ignition voltage and its own bench guards."
      >
        <div className="wmi-checklist">
          {CHECKS.map((check) => (
            <label key={check.id} className="wmi-check">
              <input
                type="checkbox"
                checked={!!checked[check.id]}
                onChange={(event) => {
                  setChecked((prev) => ({ ...prev, [check.id]: event.target.checked }));
                }}
              />
              <span>
                <strong>{check.label}</strong>
                <em>{check.detail}</em>
              </span>
            </label>
          ))}
        </div>
      </WmiSection>

      {run ? (
        <WmiSection
          title={run.action === 'calibrate' ? 'Calibration run' : run.action === 'prime' ? 'Priming line' : 'Pump test'}
          description="The ECU is driving the pump now."
        >
          <div className="wmi-run wmi-run--large">
            <div>
              <strong>{remaining.toFixed(1)} s</strong>
              <span>
                {run.action === 'calibrate'
                  ? '100% duty · collect the full output'
                  : run.action === 'prime'
                    ? '100% duty · filling the line'
                    : '50% duty · pump test'}
              </span>
            </div>
            <div className="wmi-run__bar" aria-hidden="true">
              <i style={{ width: `${Math.max(0, Math.min(100, (remaining / Math.max(1, run.durationSec)) * 100))}%` }} />
            </div>
            <WmiButton variant="danger" onClick={onCancel} disabled={busy}>
              Cancel run
            </WmiButton>
          </div>
        </WmiSection>
      ) : (
        <WmiSection
          title="Run"
          description="Prime first if the line is dry. The calibration run is 60 s at 100%."
        >
          <div className="wmi-actions">
            <WmiButton onClick={() => onStart('prime')} disabled={!canStart}>
              Prime line · 5 s / 100%
            </WmiButton>
            <WmiButton variant="primary" onClick={() => onStart('calibrate')} disabled={!canStart}>
              Start 60 s calibration
            </WmiButton>
          </div>
          {engineRunning ? (
            <p className="wmi-note">Engine speed is above idle; stop the engine to continue.</p>
          ) : null}
        </WmiSection>
      )}

      <WmiSection
        title="Measure the nozzle"
        description="STEP 3 OF 4 · Run the pump into a measuring jug for 60 seconds at 100% duty. At 60 s, cc collected equals cc/min."
      >
        {calibrationDone ? (
          <WmiCallout tone="ok">
            Calibration run finished. Measure the container and enter the result below.
          </WmiCallout>
        ) : null}
        <div className="wmi-jug">
          <label className="wmi-jug__input">
            <span>Collected volume</span>
            <div className="wmi-input-wrap">
              <input
                className="wmi-input"
                type="text"
                inputMode="decimal"
                value={measuredCc}
                placeholder={currentNozzle > 0 ? String(currentNozzle) : 'e.g. 250'}
                onChange={(event) => {
                  if (/^-?\d*\.?\d*$/.test(event.target.value)) {
                    setMeasuredCc(event.target.value);
                    setSavedMessage(null);
                    setSaveError(null);
                  }
                }}
              />
              <span className="wmi-input__unit">cc/min</span>
            </div>
            <span className="wmi-jug__status">
              {previewNozzle > 0 && previewNozzle <= 2000
                ? `In range · 0–2000 cc/min · expected ${previewNozzle.toFixed(0)} cc in 60 s`
                : 'Enter the jug result to preview the modeled flow.'}
            </span>
          </label>
          <WmiButton variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save nozzle calibration'}
          </WmiButton>
        </div>
        {savedMessage ? <p className="wmi-note wmi-note--ok">{savedMessage}</p> : null}
        {saveError ? <p className="wmi-note wmi-note--error">{saveError}</p> : null}
      </WmiSection>

      <WmiSection
        title="Live preview"
        description={`Methanol ${formatNumber(methanolPct, 0, '%')} by volume · water fraction ${(preview.waterFraction * 100).toFixed(1)}% by mass`}
      >
        <div className="wmi-grid wmi-grid--four">
          <WmiTile
            label="Mixture density"
            value={`${preview.density.toFixed(3)} g/cc`}
            detail="Water + methanol"
            tone="info"
          />
          <WmiTile
            label="Water fraction"
            value={`${(preview.waterFraction * 100).toFixed(1)}%`}
            detail="Mass, not volume"
            tone="info"
          />
          <WmiTile
            label="Mixture at 100%"
            value={formatNumber(preview.mixture100, 2, ' g/s')}
            detail={`Water ${formatNumber(preview.water100, 2, ' g/s')}`}
            tone="ok"
          />
          <WmiTile
            label="Mixture at 50%"
            value={formatNumber(preview.mixture50, 2, ' g/s')}
            detail={`Water ${formatNumber(preview.water50, 2, ' g/s')}`}
            tone="info"
          />
        </div>
        <p className="wmi-note">
          Current saved nozzle: {currentNozzle > 0 ? `${currentNozzle.toFixed(0)} cc/min` : 'not calibrated'}.
          W/F uses water mass only; at 50/50 by volume, water is about 55.8% of mixture mass.
        </p>
      </WmiSection>
    </div>
  );
}
