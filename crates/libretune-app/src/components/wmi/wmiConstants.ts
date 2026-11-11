/** WMI tune constants used by the native view. Names come from the INI. */
export const WMI_CONSTANTS = {
  enabled: 'isWmiEnabled',
  outputPin: 'wmiOutputPin',
  outputPinMode: 'wmiOutputPinMode',
  pwmFrequency: 'wmiPwmFrequency',
  fluidPin: 'wmiFluidLevelPin',
  fluidPinMode: 'wmiFluidLevelPinMode',
  enablePin: 'wmiEnablePin',
  enablePinMode: 'wmiEnablePinMode',
  minMap: 'wmiMinMap',
  minRpm: 'wmiMinRpm',
  minTps: 'wmiMinTps',
  minClt: 'wmiMinClt',
  dutyIfError: 'wmiDutyIfError',
  activationDelayMs: 'wmiActivationDelayMs',
  fluidDebounceMs: 'wmiFluidDebounceMs',
  methanolPct: 'wmiMethanolPct',
  nozzleCcMin: 'wmiNozzleCcMin',
  flowPin: 'wmiFlowPin',
  flowHzPerLmin: 'wmiFlowHzPerLmin',
  flowMinGps: 'wmiFlowMinGpsWhileSpraying',
  fallbackMaps: 'isWmiEnableFallbackMaps',
  fallbackVe1: 'wmiFallbackVeBlend1',
  fallbackVe2: 'wmiFallbackVeBlend2',
  fallbackIgn1: 'wmiFallbackIgnBlend1',
  fallbackIgn2: 'wmiFallbackIgnBlend2',
  fallbackOlBoost1: 'wmiFallbackOlBoostBlend1',
  fallbackClBoost1: 'wmiFallbackClBoostBlend1',
  fallbackAfr1: 'wmiFallbackAfrBlend1',
  safetyRetard: 'isWmiEnableSafetyRetard',
  fuelCut: 'isWmiEnableFuelCutOnFault',
  egtFault: 'isWmiEnableEgtFault',
  faultTimingRetard: 'wmiFaultTimingRetard',
  egtThreshold: 'wmiEgtFaultThreshold',
  egtBaseline: 'wmiEgtBaseline',
} as const;

export type WmiConstantName = (typeof WMI_CONSTANTS)[keyof typeof WMI_CONSTANTS];

export const WMI_CONSTANT_NAMES: WmiConstantName[] = Object.values(WMI_CONSTANTS);

export const WMI_COMMANDS = {
  prime: 'cmd_test_wmi_prime',
  test: 'cmd_test_wmi_pump',
  calibrate: 'cmd_test_wmi_calibrate',
  cancel: 'cmd_test_wmi_cancel',
} as const;

export type WmiAction = keyof typeof WMI_COMMANDS;

/** Firmware-side durations. Cancel is instantaneous. */
export const WMI_ACTION_SECONDS: Record<WmiAction, number> = {
  prime: 5,
  test: 5,
  calibrate: 60,
  cancel: 0,
};

export const WMI_ACTION_LABEL: Record<WmiAction, string> = {
  prime: 'Prime line',
  test: 'Test pump',
  calibrate: 'Nozzle calibration',
  cancel: 'Cancel',
};

export const WMI_ACTION_DETAIL: Record<WmiAction, string> = {
  prime: '5 s · 100% duty',
  test: '5 s · 50% duty',
  calibrate: '60 s · 100% duty',
  cancel: '',
};

export type WmiTab = 'status' | 'setup' | 'bench';

/** Native editors that own the WMI tables and curves. */
export const WMI_EDITOR_LINKS = [
  {
    label: 'Pump duty table',
    target: 'wmiTableTbl',
    detail: 'MAP × RPM → commanded pump duty',
  },
  {
    label: 'Fuel enrichment curve',
    target: 'wmiFuelAdderCurve',
    detail: 'Extra fuel vs pump duty',
  },
  {
    label: 'Ignition advance curve',
    target: 'wmiTimingAdderCurve',
    detail: 'Extra advance vs pump duty',
  },
  {
    label: 'IAT correction curve',
    target: 'wmiIatCorrScaleCurve',
    detail: 'Correction authority vs intake temperature',
  },
] as const;
