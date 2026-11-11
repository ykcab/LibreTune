import { useState } from 'react';
import { WMI_CONSTANTS } from './wmiConstants';
import { WmiField, WmiSwitch } from './WmiField';
import { WmiButton, WmiNotice } from './WmiLayout';
import { formatNumber, isOn } from './wmiFormat';
import type { Constant } from '../dialogs/types';

interface FaultProps {
  values: Record<string, number>;
  missing: Set<string>;
  meta: Record<string, Constant>;
  onCommit: (name: string, value: number) => Promise<void>;
}

const FALLBACK_SLOTS = [
  { name: WMI_CONSTANTS.fallbackVe1, label: 'VE 1' },
  { name: WMI_CONSTANTS.fallbackVe2, label: 'VE 2' },
  { name: WMI_CONSTANTS.fallbackIgn1, label: 'IGN 1' },
  { name: WMI_CONSTANTS.fallbackIgn2, label: 'IGN 2' },
  { name: WMI_CONSTANTS.fallbackOlBoost1, label: 'Boost OL 1' },
  { name: WMI_CONSTANTS.fallbackClBoost1, label: 'Boost CL 1' },
  { name: WMI_CONSTANTS.fallbackAfr1, label: 'AFR 1' },
] as const;

function available(values: Record<string, number>, missing: Set<string>, name: string): boolean {
  return !missing.has(name) && values[name] !== undefined;
}

function FaultFlag({
  name,
  label,
  checked,
  disabled,
  onToggle,
}: {
  name: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <label
      className={`wmi-flag${checked ? ' is-on' : ''}`}
      title={`${label} fallback slot`}
    >
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function WmiFaultResponse({ values, missing, meta, onCommit }: FaultProps) {
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmFuelCut, setConfirmFuelCut] = useState(false);

  const hasFallback = available(values, missing, WMI_CONSTANTS.fallbackMaps);
  const hasRetard = available(values, missing, WMI_CONSTANTS.safetyRetard);
  const hasFuelCut = available(values, missing, WMI_CONSTANTS.fuelCut);
  const hasRetardValue = available(values, missing, WMI_CONSTANTS.faultTimingRetard);

  const fallbackOn = isOn(values[WMI_CONSTANTS.fallbackMaps]);
  const retardOn = isOn(values[WMI_CONSTANTS.safetyRetard]);
  const fuelCutOn = isOn(values[WMI_CONSTANTS.fuelCut]);
  const retardValue = values[WMI_CONSTANTS.faultTimingRetard];

  const slots = FALLBACK_SLOTS.filter((slot) =>
    available(values, missing, slot.name),
  );
  const activeSlots = slots.filter((slot) => isOn(values[slot.name]));

  const commitFlag = async (name: string, next: boolean) => {
    setBusyName(name);
    setError(null);
    try {
      await onCommit(name, next ? 1 : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyName(null);
    }
  };

  const armFuelCut = async () => {
    setBusyName(WMI_CONSTANTS.fuelCut);
    setError(null);
    try {
      await onCommit(WMI_CONSTANTS.fuelCut, 1);
      setConfirmFuelCut(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyName(null);
    }
  };

  const summaryParts: string[] = [];
  if (fallbackOn) {
    summaryParts.push(
      activeSlots.length > 0
        ? `fallback maps (${activeSlots.map((slot) => slot.label).join(', ')})`
        : 'fallback maps',
    );
  }
  if (retardOn) {
    summaryParts.push(
      `${formatNumber(retardValue, 1, '°')} timing retard`,
    );
  }
  if (fuelCutOn) summaryParts.push('fuel cut');

  return (
    <div className="wmi-faults">
      <p className="wmi-faults__summary">
        {summaryParts.length > 0
          ? `On a WMI fault: ${summaryParts.join(' · ')}.`
          : 'Default response: the pump stops and WMI corrections are withheld.'}
      </p>

      {hasFallback ? (
        <>
          <WmiField
            name={WMI_CONSTANTS.fallbackMaps}
            label="Fallback maps on fault"
            hint="Forces the enabled table-switch slots to their no-WMI alternative."
            values={values}
            missing={missing}
            meta={meta[WMI_CONSTANTS.fallbackMaps]}
            onCommit={onCommit}
            variant="toggle"
          />
          {fallbackOn ? (
            <div className="wmi-fallback">
              <div className="wmi-fallback__head">
                <span>Fallback slots</span>
                <em>{activeSlots.length} selected</em>
              </div>
              {slots.length > 0 ? (
                <div className="wmi-flags" role="group" aria-label="Fallback map slots">
                  {slots.map((slot) => (
                    <FaultFlag
                      key={slot.name}
                      name={slot.name}
                      label={slot.label}
                      checked={isOn(values[slot.name])}
                      disabled={busyName !== null}
                      onToggle={(next) => void commitFlag(slot.name, next)}
                    />
                  ))}
                </div>
              ) : (
                <p className="wmi-panel__note">
                  This definition does not expose fallback slot switches.
                </p>
              )}
              <p className="wmi-panel__note">
                Select the table-switch slots that contain your no-WMI safe maps.
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      {hasRetard ? (
        <>
          <WmiField
            name={WMI_CONSTANTS.safetyRetard}
            label="Retard timing on fault"
            hint="Extra safety margin on top of the fallback maps."
            values={values}
            missing={missing}
            meta={meta[WMI_CONSTANTS.safetyRetard]}
            onCommit={onCommit}
            variant="toggle"
          />
          {hasRetardValue ? (
            <WmiField
              name={WMI_CONSTANTS.faultTimingRetard}
              label="Fault retard"
              hint="Positive values add retard. Applied while the fault is active."
              values={values}
              missing={missing}
              meta={meta[WMI_CONSTANTS.faultTimingRetard]}
              onCommit={onCommit}
              disabled={!retardOn}
            />
          ) : null}
        </>
      ) : null}

      {hasFuelCut ? (
        <div className={`wmi-fuelcut${fuelCutOn ? ' is-armed' : ''}`}>
          <div className="wmi-fuelcut__row">
            <span id="wmi-fuelcut-label" className="wmi-row__label">Cut fuel on fault</span>
            <WmiSwitch
              checked={fuelCutOn}
              labelledBy="wmi-fuelcut-label"
              busy={busyName === WMI_CONSTANTS.fuelCut}
              onChange={(next) => {
                if (!next) {
                  void commitFlag(WMI_CONSTANTS.fuelCut, false);
                } else {
                  setConfirmFuelCut(true);
                }
              }}
            />
          </div>
          <p className="wmi-row__hint">
            Last resort. Stops all injection when a WMI guard trips; fallback maps keep the
            engine running.
          </p>

          {confirmFuelCut && !fuelCutOn ? (
            <WmiNotice
              tone="crit"
              title="Arm fuel cut?"
              action={
                <>
                  <WmiButton
                    variant="danger"
                    disabled={busyName !== null}
                    onClick={() => void armFuelCut()}
                  >
                    Arm fuel cut
                  </WmiButton>
                  <WmiButton onClick={() => setConfirmFuelCut(false)}>Cancel</WmiButton>
                </>
              }
            >
              A WMI fault at active conditions will stop injection instead of only switching
              maps. Arm this only if the engine can tolerate an instant cut.
            </WmiNotice>
          ) : null}

          {fuelCutOn ? (
            <WmiNotice tone="crit" title="Fuel cut is armed">
              A WMI fault at active conditions will stop injection.
            </WmiNotice>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="wmi-row__error" role="alert">{error}</p> : null}
    </div>
  );
}

export function WmiEgtGuard({ values, missing, meta, onCommit }: FaultProps) {
  const enabled = isOn(values[WMI_CONSTANTS.egtFault]);
  const hasThreshold = available(values, missing, WMI_CONSTANTS.egtThreshold);
  const hasBaseline = available(values, missing, WMI_CONSTANTS.egtBaseline);

  return (
    <div className="wmi-egt">
      <WmiField
        name={WMI_CONSTANTS.egtFault}
        label="EGT guard"
        hint="Faults when EGT1 crosses the threshold while WMI is active."
        values={values}
        missing={missing}
        meta={meta[WMI_CONSTANTS.egtFault]}
        onCommit={onCommit}
        variant="toggle"
      />
      {hasThreshold ? (
        <WmiField
          name={WMI_CONSTANTS.egtThreshold}
          label="Fault threshold"
          hint="0 disables the threshold. The guard shares the fluid debounce timer."
          values={values}
          missing={missing}
          meta={meta[WMI_CONSTANTS.egtThreshold]}
          onCommit={onCommit}
          disabled={!enabled}
        />
      ) : null}
      {hasBaseline ? (
        <WmiField
          name={WMI_CONSTANTS.egtBaseline}
          label="Dyno baseline"
          hint="Expected EGT with WMI working. Used for the live headroom readout, not for the fault."
          values={values}
          missing={missing}
          meta={meta[WMI_CONSTANTS.egtBaseline]}
          onCommit={onCommit}
          disabled={!enabled}
        />
      ) : null}
    </div>
  );
}
