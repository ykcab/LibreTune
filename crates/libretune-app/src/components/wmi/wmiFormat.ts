export type WmiTone = 'dim' | 'info' | 'ok' | 'warn' | 'crit';

export interface WmiStateInfo {
  key: 'disabled' | 'standby' | 'priming' | 'active' | 'fault' | 'unknown';
  label: string;
  shortLabel: string;
  tone: WmiTone;
  description: string;
}

/** Decode the firmware `wmiState` channel (0..4). */
export function wmiStateInfo(state: number | undefined): WmiStateInfo {
  if (state === undefined || !Number.isFinite(state)) {
    return {
      key: 'unknown',
      label: '—',
      shortLabel: '—',
      tone: 'dim',
      description: 'No WMI state channel is being published.',
    };
  }

  switch (Math.round(state)) {
    case 0:
      return {
        key: 'disabled',
        label: 'Disabled',
        shortLabel: 'OFF',
        tone: 'dim',
        description: 'WMI is off or no pump output pin is configured.',
      };
    case 1:
      return {
        key: 'standby',
        label: 'Standby',
        shortLabel: 'ARMED',
        tone: 'info',
        description: 'Configured and waiting for the activation thresholds.',
      };
    case 2:
      return {
        key: 'priming',
        label: 'Priming',
        shortLabel: 'ON',
        tone: 'ok',
        description: 'Pump is running; fuel and timing corrections are still withheld.',
      };
    case 3:
      return {
        key: 'active',
        label: 'Active',
        shortLabel: 'ON',
        tone: 'ok',
        description: 'Pump is running and the ECU corrections are live.',
      };
    case 4:
      return {
        key: 'fault',
        label: 'Fault',
        shortLabel: 'FAULT',
        tone: 'crit',
        description: 'A WMI guard has tripped. Check fluid, flow and EGT status.',
      };
    default:
      return {
        key: 'unknown',
        label: 'Unknown',
        shortLabel: '—',
        tone: 'dim',
        description: `Unrecognized WMI state (${state}).`,
      };
  }
}

export function formatNumber(
  value: number | undefined,
  digits: number,
  unit = '',
): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}${unit}`;
}

export function formatDuty(value: number | undefined): string {
  return formatNumber(value, 0, '%');
}

/** W/F is only meaningful while water is flowing and fuel flow is known. */
export function formatWf(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return '—';
  return value.toFixed(2);
}

export function formatOnOff(value: number | undefined, on = 'On', off = 'Off'): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value >= 0.5 ? on : off;
}

export function isOn(value: number | undefined): boolean {
  return value !== undefined && Number.isFinite(value) && value >= 0.5;
}
