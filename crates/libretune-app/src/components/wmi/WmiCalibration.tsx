import { useId, useMemo, useState, type ReactNode } from 'react';
import { useChannels } from '../../stores/realtimeStore';
import {
  WMI_ACTION_LABEL,
  WMI_CONSTANTS,
  type WmiAction,
  type WmiTab,
} from './wmiConstants';
import { WmiButton, WmiDot, WmiKvRow, WmiNotice, WmiPanel } from './WmiLayout';
import { formatDuration, formatNumber, isOn, wmiStateInfo } from './wmiFormat';
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
    detail: 'Bench runs drive the pump regardless of engine state.',
  },
  {
    id: 'supply',
    label: 'Pump supply is live',
    detail: '12 V through the external driver. The ECU only drives the signal.',
  },
  {
    id: 'container',
    label: 'Nozzle is in a measuring container',
    detail: 'Every run sprays fluid out of the nozzle.',
  },
  {
    id: 'primed',
    label: 'Line is primed and leak-free',
    detail: 'Prime first if the pump-to-nozzle line is empty.',
  },
] as const;

/**
 * Run basis: what a collected volume has to be scaled by to become cc/min.
 * A 60 s run at 100% is the reference; shorter or part-duty runs are scaled
 * but measure less of the pump's steady state.
 */
const BASIS_OPTIONS = [
  {
    id: 'calibrate',
    label: 'Calibration · 60 s at 100%',
    short: '60 s at 100%',
    factor: 1,
    detail: 'Reference measurement.',
  },
  {
    id: 'test',
    label: 'Pump test · 5 s at 50%',
    short: '5 s at 50%',
    factor: 24,
    detail: 'Scaled up from a short, part-duty run.',
  },
  {
    id: 'prime',
    label: 'Prime · 5 s at 100%',
    short: '5 s at 100%',
    factor: 12,
    detail: 'Scaled up from a short run.',
  },
  {
    id: 'manual',
    label: 'Other · assume 60 s at 100%',
    short: 'manual',
    factor: 1,
    detail: 'Enter a jug result measured some other way.',
  },
] as const;

type BasisId = (typeof BASIS_OPTIONS)[number]['id'];

type StepState = 'done' | 'current' | 'todo' | 'blocked';

const STEP_STATE_LABEL: Record<StepState, string> = {
  done: 'Done',
  current: 'Now',
  todo: 'Next',
  blocked: 'Blocked',
};

function BenchStep({
  number,
  title,
  state,
  meta,
  children,
}: {
  number: string;
  title: string;
  state: StepState;
  meta?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className={`wmi-step wmi-step--${state}`} aria-labelledby={titleId}>
      <div className="wmi-step__rail" aria-hidden="true">
        <span className="wmi-step__dot" />
      </div>
      <div className="wmi-step__body">
        <header className="wmi-step__head">
          <span className="wmi-step__number">{number}</span>
          <h2 id={titleId} className="wmi-step__title">{title}</h2>
          <span className={`wmi-step__state wmi-tone-${state === 'done' ? 'ok' : state === 'blocked' ? 'warn' : state === 'current' ? 'info' : 'dim'}`}>
            {STEP_STATE_LABEL[state]}
          </span>
          {meta ? <span className="wmi-step__meta">{meta}</span> : null}
        </header>
        <div className="wmi-step__content">{children}</div>
      </div>
    </section>
  );
}

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
  onGoTo: (tab: WmiTab) => void;
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
  onGoTo,
}: WmiCalibrationProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [collectedText, setCollectedText] = useState('');
  const [basisOverride, setBasisOverride] = useState<BasisId | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const live = useChannels(['wmiPumpDuty', 'wmiState']);

  const enabled = isOn(values[WMI_CONSTANTS.enabled]);
  const pumpPin = values[WMI_CONSTANTS.outputPin] ?? 0;
  const pumpConfigured = pumpPin > 0;
  const currentNozzle = values[WMI_CONSTANTS.nozzleCcMin] ?? 0;
  const nozzleCalibrated = currentNozzle > 0 && currentNozzle <= 2000;
  const methanolPct = values[WMI_CONSTANTS.methanolPct];
  const mixPercent = methanolPct ?? 50;

  const allChecked = CHECKS.every((check) => checked[check.id]);
  const checkedCount = CHECKS.filter((check) => checked[check.id]).length;

  const blockers: Array<{ id: string; text: string; setup?: boolean }> = [];
  if (!isConnected) {
    blockers.push({ id: 'offline', text: 'ECU offline. Connect before running the pump.' });
  }
  if (!enabled) {
    blockers.push({
      id: 'disabled',
      text: 'WMI is disabled in this tune, so the ECU will ignore the pump command.',
      setup: true,
    });
  }
  if (enabled && !pumpConfigured) {
    blockers.push({
      id: 'no-pin',
      text: 'No pump output pin is assigned, so there is nothing to drive.',
      setup: true,
    });
  }
  if (engineRunning) {
    blockers.push({ id: 'engine', text: 'Engine speed is above idle. Stop the engine first.' });
  }
  const blocked = blockers.length > 0;

  const ready = !blocked && allChecked && !run && !busy;
  const canCalibrate = ready && hasCalibration;

  const lastRun = lastCompleted;
  const completedCalibration = lastRun?.action === 'calibrate';

  const suggestedBasis: BasisId = lastRun?.action === 'test'
    ? 'test'
    : lastRun?.action === 'prime'
      ? 'prime'
      : 'calibrate';
  const basis = basisOverride ?? suggestedBasis;
  const basisOption = BASIS_OPTIONS.find((option) => option.id === basis) ?? BASIS_OPTIONS[0];

  const parsedCollected = Number.parseFloat(collectedText);
  const collectedCc = Number.isFinite(parsedCollected) && parsedCollected > 0
    ? parsedCollected
    : undefined;
  const nozzleFromJug = collectedCc !== undefined
    ? ccMinFromCollectedCc(collectedCc) * basisOption.factor
    : 0;
  const nozzleValid = nozzleFromJug > 0 && nozzleFromJug <= 2000;
  const nozzlePreview = nozzleValid ? nozzleFromJug : currentNozzle;

  const preview = useMemo(() => {
    const density = mixtureDensityGPerCc(mixPercent);
    const waterFraction = mixtureWaterMassFraction(mixPercent);
    return {
      density,
      waterFraction,
      mixture100: modeledMixtureFlowGps(nozzlePreview, 100, mixPercent),
      water100: modeledWaterFlowGps(nozzlePreview, 100, mixPercent),
    };
  }, [mixPercent, nozzlePreview]);

  const save = async () => {
    if (!nozzleValid) {
      setSaveError('Enter the collected volume in cc. The result must fall between 1 and 2000 cc/min.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSavedMessage(null);
    try {
      const rounded = Number(nozzleFromJug.toFixed(1));
      await onCommit(WMI_CONSTANTS.nozzleCcMin, rounded);
      setSavedMessage(`Saved ${rounded.toFixed(1)} cc/min as the nozzle calibration.`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const stepState = (index: 1 | 2 | 3): StepState => {
    if (blocked) return 'blocked';
    if (index === 1) return allChecked ? 'done' : 'current';
    if (index === 2) {
      if (!allChecked) return 'todo';
      if (run) return 'current';
      return lastRun ? 'done' : 'current';
    }
    if (lastRun || nozzleCalibrated) return nozzleCalibrated ? 'done' : 'current';
    return allChecked ? 'current' : 'todo';
  };

  const progress = run
    ? Math.max(0, Math.min(100, ((run.durationSec - remaining) / Math.max(1, run.durationSec)) * 100))
    : 0;
  const elapsed = run ? run.durationSec - remaining : 0;
  const ecuDuty = isConnected ? live.wmiPumpDuty : undefined;
  const liveState = wmiStateInfo(isConnected ? live.wmiState : undefined);
  const dutySilent = run !== null
    && isConnected
    && elapsed > 1
    && (ecuDuty === undefined || ecuDuty <= 0.5);

  const runHint = run?.action === 'calibrate'
    ? 'Keep the nozzle in the container for the full run.'
    : run?.action === 'prime'
      ? 'Filling the pump-to-nozzle line.'
      : 'Pump spinning at half duty.';

  return (
    <div className="wmi-bench">
      <div className="wmi-bench__main">
        {blocked ? (
          <WmiNotice
            tone="warn"
            title="The bench cannot run yet"
            action={blockers.some((blocker) => blocker.setup)
              ? <WmiButton onClick={() => onGoTo('setup')}>Open setup</WmiButton>
              : undefined}
          >
            <ul className="wmi-notice__list">
              {blockers.map((blocker) => (
                <li key={blocker.id}>{blocker.text}</li>
              ))}
            </ul>
          </WmiNotice>
        ) : null}

        <BenchStep
          number="01"
          title="Prepare"
          state={stepState(1)}
          meta={`${checkedCount}/${CHECKS.length} checked`}
        >
          <p className="wmi-step__lead">
            Every box must be confirmed. The ECU still enforces its own bench guards, such as
            supply voltage, no matter what is checked here.
          </p>
          <div className="wmi-checklist">
            {CHECKS.map((check) => (
              <label key={check.id} className="wmi-check">
                <input
                  type="checkbox"
                  checked={!!checked[check.id]}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setChecked((prev) => ({ ...prev, [check.id]: next }));
                  }}
                />
                <span className="wmi-check__text">
                  <strong>{check.label}</strong>
                  <em>{check.detail}</em>
                </span>
              </label>
            ))}
          </div>
        </BenchStep>

        <BenchStep
          number="02"
          title="Run"
          state={stepState(2)}
          meta={lastRun
            ? `Last: ${WMI_ACTION_LABEL[lastRun.action].toLowerCase()} · ${formatDuration(lastRun.durationSec)}`
            : undefined}
        >
          {run ? (
            <div className="wmi-run">
              <div className="wmi-run__head">
                <strong className="wmi-run__time">{formatDuration(remaining)}</strong>
                <span className="wmi-run__label">
                  {run.action === 'calibrate'
                    ? 'Nozzle calibration · 100% duty'
                    : run.action === 'prime'
                      ? 'Priming line · 100% duty'
                      : 'Pump test · 50% duty'}
                </span>
                <WmiButton variant="danger" onClick={onCancel} disabled={busy}>
                  Cancel
                </WmiButton>
              </div>
              <div className="wmi-run__bar" aria-hidden="true">
                <i style={{ width: `${progress}%` }} />
              </div>
              <p className="wmi-panel__note">{runHint}</p>

              <div className="wmi-readouts wmi-readouts--two">
                <div className="wmi-readout">
                  <span className="wmi-readout__label">ECU duty</span>
                  <strong className="wmi-readout__value">
                    {isConnected && ecuDuty !== undefined ? `${ecuDuty.toFixed(0)}%` : '—'}
                  </strong>
                  <span className="wmi-readout__detail">
                    {isConnected ? 'Reported by the ECU' : 'Offline'}
                  </span>
                </div>
                <div className="wmi-readout">
                  <span className="wmi-readout__label">Pump state</span>
                  <strong className={`wmi-readout__value wmi-tone-${liveState.tone}`}>
                    {isConnected ? liveState.label : '—'}
                  </strong>
                  <span className="wmi-readout__detail">
                    {isConnected ? liveState.description : 'Connect to read the state'}
                  </span>
                </div>
              </div>

              {dutySilent ? (
                <WmiNotice tone="warn" title="The ECU is not driving the output">
                  The run is counting down, but <code>wmiPumpDuty</code> is still zero. Check the
                  pump output pin, the master enable, and any ECU bench guard such as supply
                  voltage. Cancel the run if nothing happens.
                </WmiNotice>
              ) : null}
            </div>
          ) : (
            <>
              <p className="wmi-step__lead">
                Prime a dry line first. Use a calibration run when you need a reference
                measurement; the shorter runs are enough to prove the hardware works.
              </p>
              <div className="wmi-actions">
                <div className="wmi-action">
                  <div className="wmi-action__text">
                    <strong>Nozzle calibration</strong>
                    <span>60 s at 100% duty. The reference jug test.</span>
                    {!hasCalibration ? (
                      <em className="wmi-action__flag">
                        This ECU definition has no 60 s calibration command.
                      </em>
                    ) : (
                      <em>Collect the full output, then measure it in step 3.</em>
                    )}
                  </div>
                  <WmiButton
                    variant="primary"
                    onClick={() => onStart('calibrate')}
                    disabled={!canCalibrate}
                  >
                    Start 60 s run
                  </WmiButton>
                </div>

                <div className="wmi-action">
                  <div className="wmi-action__text">
                    <strong>Pump test</strong>
                    <span>5 s at 50% duty. Proves the driver and pump spin up.</span>
                    <em>No calibrate command needed.</em>
                  </div>
                  <WmiButton onClick={() => onStart('test')} disabled={!ready}>
                    Run 5 s test
                  </WmiButton>
                </div>

                <div className="wmi-action">
                  <div className="wmi-action__text">
                    <strong>Prime line</strong>
                    <span>5 s at 100% duty. Fills an empty pump-to-nozzle line.</span>
                    <em>Fluid reaches the nozzle, so keep it in the container.</em>
                  </div>
                  <WmiButton onClick={() => onStart('prime')} disabled={!ready}>
                    Prime 5 s
                  </WmiButton>
                </div>
              </div>
              {!allChecked && !blocked ? (
                <p className="wmi-panel__note">
                  Confirm all {CHECKS.length} checks in step 1 to enable the run buttons.
                </p>
              ) : null}
            </>
          )}
        </BenchStep>

        <BenchStep
          number="03"
          title="Measure"
          state={stepState(3)}
          meta={nozzleCalibrated ? 'Saved' : 'Not calibrated'}
        >
          {completedCalibration ? (
            <WmiNotice tone="ok" title="Calibration run finished">
              Measure what the container collected and enter it below.
            </WmiNotice>
          ) : null}

          <div className="wmi-measure">
            <div className="wmi-measure__field">
              <label htmlFor="wmi-collected">Collected volume</label>
              <div className="wmi-measure__input">
                <input
                  id="wmi-collected"
                  className="wmi-input"
                  type="text"
                  inputMode="decimal"
                  value={collectedText}
                  placeholder={nozzleCalibrated ? currentNozzle.toFixed(0) : 'e.g. 250'}
                  onChange={(event) => {
                    if (/^\d*\.?\d*$/.test(event.target.value)) {
                      setCollectedText(event.target.value);
                      setSavedMessage(null);
                      setSaveError(null);
                    }
                  }}
                />
                <span>cc</span>
              </div>
            </div>

            <div className="wmi-measure__field">
              <label htmlFor="wmi-basis">Run basis</label>
              <select
                id="wmi-basis"
                className="wmi-input wmi-input--select"
                value={basis}
                onChange={(event) => {
                  setBasisOverride(event.target.value as BasisId);
                  setSavedMessage(null);
                  setSaveError(null);
                }}
              >
                {BASIS_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>

            <WmiButton
              variant="primary"
              onClick={() => void save()}
              disabled={saving || !nozzleValid}
            >
              {saving ? 'Saving…' : 'Save calibration'}
            </WmiButton>
          </div>

          <p className="wmi-panel__note">
            {basisOption.factor === 1
              ? 'A 60 s run at 100% duty makes cc collected equal to cc/min.'
              : `Collected volume is scaled by ${basisOption.factor}× to a 60 s, 100% duty equivalent. ${basisOption.detail}`}
            {nozzleFromJug > 2000
              ? ' That result is above the 2000 cc/min limit — check the basis and the volume.'
              : ''}
          </p>

          <div className="wmi-readouts">
            <div className="wmi-readout">
              <span className="wmi-readout__label">Nozzle flow</span>
              <strong className={`wmi-readout__value${nozzleValid ? '' : ' wmi-tone-dim'}`}>
                {nozzleFromJug > 0 ? formatNumber(nozzleFromJug, 0, ' cc/min') : '—'}
              </strong>
              <span className="wmi-readout__detail">
                {nozzleFromJug > 2000 ? 'Outside the accepted range' : basisOption.short}
              </span>
            </div>
            <div className="wmi-readout">
              <span className="wmi-readout__label">Mixture density</span>
              <strong className="wmi-readout__value">{preview.density.toFixed(3)}</strong>
              <span className="wmi-readout__detail">g/cc at {mixPercent.toFixed(0)}% methanol</span>
            </div>
            <div className="wmi-readout">
              <span className="wmi-readout__label">Mixture at 100%</span>
              <strong className="wmi-readout__value">
                {nozzlePreview > 0 ? formatNumber(preview.mixture100, 2) : '—'}
              </strong>
              <span className="wmi-readout__detail">g/s total</span>
            </div>
            <div className="wmi-readout">
              <span className="wmi-readout__label">Water at 100%</span>
              <strong className="wmi-readout__value">
                {nozzlePreview > 0 ? formatNumber(preview.water100, 2) : '—'}
              </strong>
              <span className="wmi-readout__detail">
                g/s · {(preview.waterFraction * 100).toFixed(1)}% of mass
              </span>
            </div>
          </div>

          {savedMessage ? <p className="wmi-note wmi-note--ok" role="status">{savedMessage}</p> : null}
          {saveError ? <p className="wmi-note wmi-note--error" role="alert">{saveError}</p> : null}
        </BenchStep>
      </div>

      <aside className="wmi-bench__rail" aria-label="Bench conditions and calibration">
        <WmiPanel title="Conditions" meta={blocked ? 'Blocked' : 'Ready'}>
          <div className="wmi-kv wmi-kv--compact">
            <WmiKvRow
              label="ECU link"
              value={isConnected ? 'Online' : 'Offline'}
              detail={isConnected ? 'Commands are accepted' : 'Connect to run the pump'}
              tone={isConnected ? 'ok' : 'crit'}
            />
            <WmiKvRow
              label="Engine"
              value={engineRunning ? 'Running' : 'Stopped'}
              detail={engineRunning ? 'Stop it before a bench run' : 'Bench runs are safe to arm'}
              tone={engineRunning ? 'warn' : 'ok'}
            />
            <WmiKvRow
              label="WMI master"
              value={enabled ? 'Enabled' : 'Disabled'}
              detail={enabled ? 'Tune allows WMI' : 'The ECU ignores pump commands'}
              tone={enabled ? 'ok' : 'warn'}
            />
            <WmiKvRow
              label="Pump output"
              value={pumpConfigured ? `Pin ${pumpPin.toFixed(0)}` : 'Not assigned'}
              detail={pumpConfigured ? 'Signal to the external driver' : 'Assign it in setup'}
              tone={pumpConfigured ? 'ok' : 'warn'}
            />
            <WmiKvRow
              label="Calibrate command"
              value={hasCalibration ? 'Available' : 'Not in INI'}
              detail={hasCalibration ? '60 s at 100% duty' : 'Prime and test still work'}
              tone={hasCalibration ? 'ok' : 'dim'}
            />
          </div>
        </WmiPanel>

        <WmiPanel
          title="Current calibration"
          meta={nozzleCalibrated ? 'Saved' : 'None'}
          actions={
            <WmiButton onClick={() => onGoTo('status')}>Live status</WmiButton>
          }
        >
          <div className="wmi-kv wmi-kv--compact">
            <WmiKvRow
              label="Nozzle flow"
              value={nozzleCalibrated ? `${currentNozzle.toFixed(0)} cc/min` : '—'}
              detail={nozzleCalibrated ? 'At 100% duty' : 'Modeled flow stays off'}
              tone={nozzleCalibrated ? 'ok' : 'warn'}
            />
            <WmiKvRow
              label="Methanol"
              value={methanolPct !== undefined ? `${methanolPct.toFixed(0)}% by volume` : '—'}
              detail={methanolPct !== undefined ? 'Set in Fluid & nozzle' : 'Not exposed by this INI'}
              tone={methanolPct !== undefined ? 'info' : 'dim'}
            />
            <WmiKvRow
              label="Water share"
              value={methanolPct !== undefined ? `${(preview.waterFraction * 100).toFixed(1)}%` : '—'}
              detail="Of mixture mass, used for W/F"
              tone={methanolPct !== undefined ? 'info' : 'dim'}
            />
          </div>
          <p className="wmi-panel__note">
            Nozzle flow is a jug-test result, not the rated catalogue number.
          </p>
        </WmiPanel>

        <WmiPanel title="Bench rules">
          <ul className="wmi-rules">
            <li><WmiDot tone="warn" />Engine off for every run.</li>
            <li><WmiDot tone="warn" />Nozzle stays in the container, even for a prime.</li>
            <li><WmiDot tone="dim" />A run can be cancelled from any WMI tab.</li>
            <li><WmiDot tone="dim" />The ECU can still refuse a run; its duty readout is the truth.</li>
            <li><WmiDot tone="dim" />Short, part-duty runs are scaled, so they are less accurate.</li>
          </ul>
        </WmiPanel>
      </aside>
    </div>
  );
}

export default WmiCalibration;
