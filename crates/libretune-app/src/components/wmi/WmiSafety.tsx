import { useChannels } from '../../stores/realtimeStore';
import { WMI_CONSTANTS } from './wmiConstants';
import { WmiCallout, WmiSection, WmiTile } from './WmiLayout';
import { WmiField } from './WmiField';
import type { Constant } from '../dialogs/types';
import { isOn, type WmiTone } from './wmiFormat';

export interface WmiSafetyProps {
  values: Record<string, number>;
  missing: Set<string>;
  meta: Record<string, Constant>;
  onCommit: (name: string, value: number) => Promise<void>;
}

export function WmiSafety({ values, missing, meta, onCommit }: WmiSafetyProps) {
  const live = useChannels([
    'wmiFluidOk',
    'wmiFlowFault',
    'wmiEgtFault',
  ]);

  const enabled = isOn(values[WMI_CONSTANTS.enabled]);
  const fallbackMaps = isOn(values[WMI_CONSTANTS.fallbackMaps]);
  const safetyRetard = isOn(values[WMI_CONSTANTS.safetyRetard]);
  const egtEnabled = isOn(values[WMI_CONSTANTS.egtFault]);
  const flowPin = values[WMI_CONSTANTS.flowPin] ?? 0;

  const fluidTone: WmiTone = live.wmiFluidOk === undefined
    ? 'dim'
    : live.wmiFluidOk >= 0.5 ? 'ok' : 'crit';
  const flowTone: WmiTone = flowPin <= 0
    ? 'dim'
    : isOn(live.wmiFlowFault) ? 'crit' : 'ok';
  const egtTone: WmiTone = !egtEnabled
    ? 'dim'
    : isOn(live.wmiEgtFault) ? 'crit' : 'ok';

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
      meta={meta[name] ?? null}
      onCommit={onCommit}
      variant={variant}
      disabled={disabled || !enabled}
    />
  );

  return (
    <div className="wmi-page">
      <WmiSection
        title="Live safety chain"
        description="These are the ECU's own guards, not calibration-software estimates."
      >
        <div className="wmi-grid wmi-grid--three">
          <WmiTile
            label="Fluid level"
            value={live.wmiFluidOk === undefined ? '—' : live.wmiFluidOk >= 0.5 ? 'OK' : 'Fault'}
            detail="Debounced sensor guard"
            tone={fluidTone}
          />
          <WmiTile
            label="Flow"
            value={flowPin <= 0 ? 'Not monitored' : isOn(live.wmiFlowFault) ? 'Fault' : 'OK'}
            detail={flowPin <= 0 ? 'No flow meter configured' : 'Hall meter guard'}
            tone={flowTone}
          />
          <WmiTile
            label="EGT"
            value={!egtEnabled ? 'Not configured' : isOn(live.wmiEgtFault) ? 'Fault' : 'OK'}
            detail={egtEnabled ? 'Over-temperature guard' : 'Enable below to monitor'}
            tone={egtTone}
          />
        </div>
      </WmiSection>

      <WmiSection
        title="Fault response"
        description="What the ECU does when WMI faults at active conditions."
      >
        <div className="wmi-field-grid">
          {field(
            WMI_CONSTANTS.fallbackMaps,
            'Auto-switch safeguard maps',
            'Forces the selected Table Switch slots to the no-WMI safe map.',
            'toggle',
          )}
          {fallbackMaps
            ? field(WMI_CONSTANTS.fallbackVe1, 'VE Table Switch 1', undefined, 'toggle')
            : null}
          {fallbackMaps
            ? field(WMI_CONSTANTS.fallbackVe2, 'VE Table Switch 2', undefined, 'toggle')
            : null}
          {fallbackMaps
            ? field(WMI_CONSTANTS.fallbackIgn1, 'Ignition Table Switch 1', undefined, 'toggle')
            : null}
          {fallbackMaps
            ? field(WMI_CONSTANTS.fallbackIgn2, 'Ignition Table Switch 2', undefined, 'toggle')
            : null}
          {fallbackMaps
            ? field(WMI_CONSTANTS.fallbackOlBoost1, 'Open loop boost switch 1', undefined, 'toggle')
            : null}
          {fallbackMaps
            ? field(WMI_CONSTANTS.fallbackClBoost1, 'Closed loop boost switch 1', undefined, 'toggle')
            : null}
          {fallbackMaps
            ? field(WMI_CONSTANTS.fallbackAfr1, 'Target AFR switch 1', undefined, 'toggle')
            : null}
          {field(
            WMI_CONSTANTS.safetyRetard,
            'Retard timing on fault',
            'Extra margin on top of the safeguard maps.',
            'toggle',
          )}
          {safetyRetard
            ? field(
                WMI_CONSTANTS.faultTimingRetard,
                'Fault timing retard',
                'Positive = more retard, not more advance.',
              )
            : null}
          {field(
            WMI_CONSTANTS.fuelCut,
            'Cut fuel on fault',
            'Last resort: stops all injection. Safeguard maps keep the engine fueled.',
            'toggle',
          )}
        </div>
        {isOn(values[WMI_CONSTANTS.fuelCut]) ? (
          <WmiCallout tone="crit">
            Fuel cut is armed. A WMI fault at active conditions will stop injection instead of
            only switching maps.
          </WmiCallout>
        ) : null}
      </WmiSection>

      <WmiSection
        title="EGT health monitor"
        description="Use only when an EGT1 sensor is installed and calibrated."
      >
        <div className="wmi-field-grid">
          {field(
            WMI_CONSTANTS.egtFault,
            'EGT sensor installed',
            'Enables the EGT over-temperature guard while WMI is active.',
            'toggle',
          )}
          {egtEnabled
            ? field(
                WMI_CONSTANTS.egtThreshold,
                'EGT fault threshold',
                '0 = disabled. Uses the fluid debounce timer.',
              )
            : null}
          {egtEnabled
            ? field(
                WMI_CONSTANTS.egtBaseline,
                'EGT baseline (dyno)',
                'Expected EGT with WMI working; live delta = baseline − EGT1.',
              )
            : null}
        </div>
      </WmiSection>
    </div>
  );
}
