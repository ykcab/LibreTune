/**
 * Startup dashboard — channel catalogue.
 *
 * Single source of truth for every number the Startup dashboard shows. Nothing
 * in the UI hard-codes a channel name, a unit, a range or a limit: tiles look
 * their spec up here, resolve the spec against the channel names the loaded INI
 * actually publishes, and render whatever the ECU really has.
 *
 * Units
 * -----
 * `unit` is the *source* unit of the raw stream value (kPa, °C, AFR, λ, %…).
 * Display conversion goes through the app's unit-preference layer
 * (`useUnitPreferences().autoConvert`), so a US user sees PSI/°F/mph without a
 * single literal in this file changing. Threshold bands are declared in source
 * units and their tick labels are converted at render time.
 *
 * Limits
 * ------
 * Bands are deliberate, documented engine-protection limits — not tuning
 * opinions. They are *warnings*, not verdicts: each one is always rendered with
 * its numeric boundary so the user can see exactly what tripped.
 */
import type { Tone } from './types';

export interface Band {
  /** Upper bound of this band in source units (ascending, last band is the top). */
  max: number;
  tone: Tone;
  /** Optional short label for the band boundary ("FAN", "LIMIT"). */
  label?: string;
}

export interface ChannelSpec {
  /** Stable internal id (also the preferred stream key). */
  id: string;
  /** Stream keys to try in priority order; first one present wins. */
  keys: string[];
  /** Short uppercase label (rails, scope gutters). */
  label: string;
  /** Long label for tooltips / accessible names. */
  title: string;
  /** Source unit of the raw stream value. */
  unit: string;
  digits: number;
  /** Display range in source units. */
  min: number;
  max: number;
  /** Ascending threshold bands. Omitted when the channel has no universal limit. */
  bands?: Band[];
  /** False for on/off channels, where a bar between two numbers says nothing. */
  meter?: boolean;
  /** True when a raw 0 means "not published right now" rather than a real reading. */
  zeroIsGap?: boolean;
  /** Trace accent CSS variable (dark/light aware, declared in StartupDash.css). */
  color?: string;
  /** Optional commanded/reference channel shown alongside the measured value. */
  reference?: { keys: string[]; label: string };
  /** Group is used for rail placement and to gate "engine running" rules. */
  group: 'engine' | 'air' | 'fuel' | 'spark' | 'thermal' | 'electrical' | 'drivetrain';
}

const ok = (max: number, label?: string): Band => ({ max, tone: 'ok', label });
const warn = (max: number, label?: string): Band => ({ max, tone: 'warn', label });
const crit = (max: number, label?: string): Band => ({ max, tone: 'crit', label });
const INF = Number.POSITIVE_INFINITY;

/**
 * The catalogue. Ordered by display priority inside each rail.
 *
 * Every band set is annotated with the reasoning so a future maintainer can
 * see that the number is a documented limit and not a guess.
 */
export const CHANNELS: Record<string, ChannelSpec> = {
  /* ------------------------------------------------ engine speed / drivetrain */
  rpm: {
    id: 'rpm',
    keys: ['rpm', 'RPM', 'RPMValue', 'engineSpeed', 'rpmSensor'],
    label: 'RPM',
    title: 'Engine speed',
    unit: '',
    digits: 0,
    min: 0,
    max: 8000,
    // No bands: the limit is whatever the tune says, so we only mark it when the
    // ECU publishes one (see `reference`).
    reference: { keys: ['rpmHardLimit', 'revLimit', 'rpmLimit', 'hardRevLimit'], label: 'LIMIT' },
    group: 'engine',
    color: '--sd-trace-rpm',
  },
  gear: {
    id: 'gear',
    keys: ['gear', 'currentGear', 'detectedGear', 'requestedGear'],
    label: 'GEAR',
    title: 'Engaged gear',
    unit: '',
    digits: 0,
    min: -1,
    max: 6,
    group: 'drivetrain',
  },
  speed: {
    id: 'speed',
    keys: ['speed', 'vehicleSpeedKph', 'wheelSpeed', 'gpsSpeed'],
    label: 'SPEED',
    title: 'Vehicle speed',
    unit: 'km/h',
    digits: 0,
    min: 0,
    max: 240,
    group: 'drivetrain',
  },

  /* ----------------------------------------------------------- air / load */
  map: {
    id: 'map',
    keys: ['map', 'MAPValue', 'manifoldPressure', 'fuelLoad'],
    label: 'MAP',
    title: 'Manifold absolute pressure',
    unit: 'kPa',
    digits: 0,
    min: 0,
    max: 300,
    // No threshold bands: manifold pressure is a load axis, not a limit. A boost
    // ceiling is only meaningful relative to the ECU's own boost target, which
    // is what the overboost rule uses.
    // 0 kPa is physically impossible at any baro, so a raw 0 is a dead sensor.
    zeroIsGap: true,
    group: 'air',
    color: '--sd-trace-map',
  },
  boost: {
    id: 'boost',
    keys: ['boost', 'boostPressure', 'boostOutput'],
    label: 'BOOST',
    title: 'Boost pressure (gauge)',
    unit: 'kPa',
    digits: 0,
    // Gauge pressure: -101 kPa (full vacuum) to +200 kPa (2 bar of boost).
    min: -101,
    max: 200,
    // Limits come from the ECU's boost target (see the overboost rule), not from
    // a number invented here.
    reference: { keys: ['boostTarget', 'targetBoost', 'boostControlTarget'], label: 'TARGET' },
    group: 'air',
  },
  baro: {
    id: 'baro',
    keys: ['baro', 'baroPressure', 'BaroPressure'],
    label: 'BARO',
    title: 'Barometric pressure',
    unit: 'kPa',
    digits: 1,
    min: 85,
    max: 110,
    zeroIsGap: true,
    group: 'air',
  },
  tps: {
    id: 'tps',
    keys: ['tps', 'TPSValue', 'throttlePosition', 'throttle'],
    label: 'TPS',
    title: 'Throttle plate position',
    unit: '%',
    digits: 1,
    min: 0,
    max: 100,
    group: 'air',
    color: '--sd-trace-tps',
  },
  pedal: {
    id: 'pedal',
    keys: ['throttlePedalPosition', 'pedalPosition', 'acceleratorPedal'],
    label: 'PEDAL',
    title: 'Accelerator pedal position',
    unit: '%',
    digits: 1,
    min: 0,
    max: 100,
    group: 'air',
  },
  ve: {
    id: 've',
    keys: ['ve', 'veValue', 'VE1', 've1', 'currentVe'],
    label: 'VE',
    title: 'Volumetric efficiency (live)',
    unit: '%',
    digits: 1,
    min: 40,
    max: 140,
    group: 'fuel',
  },

  /* --------------------------------------------------------------- fueling */
  lambda: {
    id: 'lambda',
    keys: ['lambda', 'Lambda', 'lambdaValue', 'wbo2', 'RealLambdaValue1'],
    label: 'LAMBDA',
    title: 'Measured lambda',
    unit: 'λ',
    digits: 3,
    min: 0.7,
    max: 1.25,
    bands: [ok(1.05, 'NOMINAL'), warn(1.15, 'LEAN'), crit(INF, 'VERY LEAN')],
    // A wideband that reads 0 (or is unplugged) must not look like "very rich".
    zeroIsGap: true,
    group: 'fuel',
    color: '--sd-trace-lambda',
  },
  afr: {
    id: 'afr',
    keys: ['afr', 'AFRValue', 'RealAFRValue', 'afr1'],
    label: 'AFR',
    title: 'Measured air/fuel ratio',
    unit: 'AFR',
    digits: 2,
    min: 10,
    max: 18,
    bands: [ok(15.5, 'NOMINAL'), warn(16.5, 'LEAN'), crit(INF, 'VERY LEAN')],
    zeroIsGap: true,
    group: 'fuel',
  },
  lambdaTarget: {
    id: 'lambdaTarget',
    keys: ['lambdaTarget', 'targetLambda', 'LambdaTarget'],
    label: 'λ TARGET',
    title: 'Commanded lambda',
    unit: 'λ',
    digits: 3,
    min: 0.7,
    max: 1.25,
    zeroIsGap: true,
    group: 'fuel',
  },
  // Second wideband, for a V engine or a dual-bank setup. Exists as its own
  // entry so it gets a tile and a scope lane; the *insight* is the split, which
  // the session computes (a dead injector on one bank shows up as a step).
  lambdaBank2: {
    id: 'lambdaBank2',
    keys: [
      'lambdaValue2',
      'RealLambdaValue2',
      'lambda2',
      'Lambda2',
      'lambdaBank2',
      'wbo2Bank2',
      'lambda1_2',
    ],
    label: 'λ BANK 2',
    title: 'Second wideband lambda (bank 2 / other cylinder bank)',
    unit: 'λ',
    digits: 3,
    min: 0.7,
    max: 1.25,
    bands: [ok(1.05, 'NOMINAL'), warn(1.15, 'LEAN'), crit(INF, 'VERY LEAN')],
    zeroIsGap: true,
    group: 'fuel',
  },
  afrTarget: {
    id: 'afrTarget',
    keys: ['afrTarget', 'targetAFR', 'targetAfr', 'AFRTarget'],
    label: 'AFR TARGET',
    title: 'Commanded air/fuel ratio',
    unit: 'AFR',
    digits: 2,
    min: 10,
    max: 18,
    zeroIsGap: true,
    group: 'fuel',
  },
  correction: {
    id: 'correction',
    keys: ['correction', 'stftCorrection1', 'egoCorrection', 'fuelCorrection', 'totalFuelCorrection'],
    label: 'TRIM',
    title: 'Live fuel correction',
    unit: '%',
    digits: 1,
    // Centred on 100 %. A trim that has to add >15 % (or pull >15 %) is telling
    // you the base table / fuel pressure is wrong, so ±15 % is the limit.
    min: 70,
    max: 130,
    bands: [warn(85, 'TRIM AT LIMIT'), ok(115, 'NOMINAL'), crit(INF, 'TRIM AT LIMIT')],
    zeroIsGap: true,
    group: 'fuel',
    color: '--sd-trace-trim',
  },
  dutyCycle: {
    id: 'dutyCycle',
    keys: ['dutyCycle', 'injectorDutyCycle', 'injDuty'],
    label: 'DUTY',
    title: 'Injector duty cycle',
    unit: '%',
    digits: 1,
    min: 0,
    max: 100,
    // ≥ 90 % sustained means the injectors are out of headroom.
    bands: [ok(85, 'NOMINAL'), warn(95, 'LOW HEADROOM'), crit(INF, 'MAXED')],
    group: 'fuel',
    color: '--sd-trace-duty',
  },
  pulseWidth: {
    id: 'pulseWidth',
    keys: ['pulseWidth', 'actualLastInjection', 'pulseWidth1', 'pw1', 'PW1'],
    label: 'PULSE W',
    title: 'Injector pulse width',
    unit: 'ms',
    digits: 2,
    min: 0,
    max: 25,
    group: 'fuel',
    color: '--sd-trace-pw',
  },
  fuelPressure: {
    id: 'fuelPressure',
    keys: ['fuelPressure', 'highFuelPressure', 'lowFuelPressure', 'rawHighFuelPressure'],
    label: 'FUEL P',
    title: 'Fuel pressure',
    unit: 'kPa',
    digits: 0,
    min: 0,
    max: 600,
    zeroIsGap: true,
    group: 'fuel',
  },
  fuelLevel: {
    id: 'fuelLevel',
    keys: ['fuelLevel', 'fuelTankLevel', 'fuel'],
    label: 'FUEL',
    title: 'Fuel level',
    unit: '%',
    digits: 0,
    min: 0,
    max: 100,
    bands: [crit(8, 'RESERVE'), warn(15, 'LOW'), ok(INF)],
    group: 'fuel',
  },
  flexPercent: {
    id: 'flexPercent',
    keys: ['flexPercent', 'ethanol', 'ethanolPercent', 'flexFuel', 'flex'],
    label: 'ETHANOL',
    title: 'Flex-fuel ethanol content',
    unit: '%',
    digits: 0,
    min: 0,
    max: 100,
    group: 'fuel',
  },

  /* ---------------------------------------------------------------- spark */
  advance: {
    id: 'advance',
    keys: ['advance', 'runningAdvance', 'correctedIgnitionAdvance', 'SA', 'ignitionAdvance'],
    label: 'ADVANCE',
    title: 'Ignition advance',
    unit: '°',
    digits: 1,
    // Timing is tune-specific (a 2-stroke and a diesel V8 share nothing), so no
    // bands — but the value is compared against the spark table by the tuner.
    min: -10,
    max: 50,
    group: 'spark',
    color: '--sd-trace-adv',
  },
  dwell: {
    id: 'dwell',
    keys: ['dwell', 'sparkDwell', 'dwellValue', 'sparkDwellValue'],
    label: 'DWELL',
    title: 'Spark dwell',
    unit: 'ms',
    digits: 2,
    min: 0,
    max: 8,
    zeroIsGap: true,
    group: 'spark',
  },
  knock: {
    id: 'knock',
    keys: ['knock', 'knockCount', 'knockLevel'],
    label: 'KNOCK',
    title: 'Knock events',
    unit: '',
    digits: 0,
    min: 0,
    max: 10,
    // Any knock while running is worth surfacing.
    bands: [ok(0.5, 'QUIET'), warn(INF, 'KNOCK DETECTED')],
    group: 'spark',
    color: '--sd-trace-knock',
  },
  knockRetard: {
    id: 'knockRetard',
    keys: ['knockRetard', 'knockRetardValue', 'retard'],
    label: 'RETARD',
    title: 'Knock retard applied',
    unit: '°',
    digits: 1,
    min: 0,
    max: 15,
    bands: [ok(0.2, 'CLEAN'), warn(INF, 'RETARD ACTIVE')],
    group: 'spark',
  },

  /* -------------------------------------------------------------- thermal */
  coolant: {
    id: 'coolant',
    keys: ['coolant', 'clt', 'CLT', 'CLTValue', 'coolantTemp'],
    label: 'COOLANT',
    title: 'Coolant temperature',
    unit: '°C',
    digits: 0,
    min: 0,
    max: 140,
    // 105 °C = fan/no-headroom, 115 °C = stop-and-investigate.
    bands: [ok(105, 'FAN'), warn(115, 'HOT'), crit(INF, 'CRITICAL')],
    // NOT a zero-is-gap channel: 0 °C is an ordinary winter reading.
    group: 'thermal',
    color: '--sd-trace-clt',
  },
  iat: {
    id: 'iat',
    keys: ['iat', 'intake', 'IATValue', 'intakeAirTemp'],
    label: 'IAT',
    title: 'Intake air temperature',
    unit: '°C',
    digits: 0,
    min: -20,
    max: 100,
    // Charge temperature is a power limiter: 60 °C is hot, 80 °C is pulling timing.
    bands: [ok(60, 'COOL'), warn(80, 'HEAT-SOAK'), crit(INF, 'VERY HOT')],
    group: 'thermal',
    color: '--sd-trace-iat',
  },
  oilTemp: {
    id: 'oilTemp',
    keys: ['oilTemp', 'OilTemp', 'oilTemperature'],
    label: 'OIL T',
    title: 'Oil temperature',
    unit: '°C',
    digits: 0,
    min: 0,
    max: 160,
    bands: [ok(120, 'NOMINAL'), warn(135, 'HOT'), crit(INF, 'CRITICAL')],
    group: 'thermal',
  },
  oilPressure: {
    id: 'oilPressure',
    keys: ['oilPressure', 'OilPressure', 'oilpress'],
    label: 'OIL P',
    title:
      'Oil pressure. The live low-pressure alarm is scaled with engine speed (about 69 kPa per 1000 rpm above 1200 rpm), so a healthy hot idle is never flagged.',
    unit: 'kPa',
    digits: 0,
    min: 0,
    max: 700,
    // The *safety* floor only: below this, pressure is inadequate at any speed.
    // The rpm-scaled warning lives in the session's rules, because a fixed floor
    // false-alarms on engines whose hot idle sits near 1 bar.
    bands: [crit(40, 'CRITICAL'), warn(70, 'LOW'), ok(INF, 'NOMINAL')],
    zeroIsGap: true,
    group: 'engine',
    color: '--sd-trace-oilp',
  },
  egt: {
    id: 'egt',
    keys: ['egt', 'egt1', 'EGT1'],
    label: 'EGT',
    title: 'Exhaust gas temperature',
    unit: '°C',
    digits: 0,
    min: 0,
    max: 1100,
    bands: [ok(850, 'NOMINAL'), warn(950, 'HOT'), crit(INF, 'CRITICAL')],
    group: 'thermal',
    color: '--sd-trace-egt',
  },

  /* ----------------------------------------------------------- electrical */
  battery: {
    id: 'battery',
    keys: ['battery', 'VBatt', 'vBatt', 'vbatt', 'batteryVoltage'],
    label: 'BATTERY',
    title: 'Battery voltage',
    unit: 'V',
    digits: 1,
    min: 8,
    max: 16,
    // Alternator/regulator window. Anything else is a warning on any vehicle.
    bands: [crit(11.5, 'CRANKING RANGE'), warn(12.5, 'LOW'), ok(15, 'CHARGING'), warn(INF, 'OVERCHARGE')],
    zeroIsGap: true,
    group: 'electrical',
    color: '--sd-trace-batt',
  },

  /* ------------------------------------------------------- supporting data */
  sync: {
    id: 'sync',
    keys: ['sync', 'engineSync', 'hasSync', 'triggerSync'],
    label: 'SYNC',
    title: 'Crank/cam trigger sync',
    unit: '',
    digits: 0,
    min: 0,
    max: 1,
    bands: [crit(0.5, 'NO SYNC'), ok(INF)], // never evaluated while stopped
    // On/off state: the text ("trigger locked") carries it, not a half-red bar.
    meter: false,
    group: 'engine',
  },
};

export const CHANNEL_LIST: ChannelSpec[] = Object.values(CHANNELS);

/** Stream keys the dashboard wants to observe (used to pre-warm subscriptions). */
export const PRIMED_KEYS: string[] = [
  'lastUpdateTime',
  ...CHANNEL_LIST.flatMap((c) => c.keys.slice(0, 2)),
];

/** Boolean/state channels rendered as state chips. */
export interface FlagSpec {
  id: string;
  keys: string[];
  label: string;
  tone: Tone;
  title: string;
}

export const FLAGS: FlagSpec[] = [
  { id: 'limiterSoft', keys: ['softLimit'], label: 'SOFT LIMIT', tone: 'warn', title: 'Soft rev limiter active' },
  { id: 'limiterHard', keys: ['hardLimit'], label: 'HARD LIMIT', tone: 'crit', title: 'Hard rev limiter active' },
  { id: 'launch', keys: ['launch', 'launchControlActive'], label: 'LAUNCH', tone: 'info', title: 'Launch control active' },
  { id: 'ase', keys: ['ase', 'afterStartEnrichment'], label: 'AFTERSTART', tone: 'info', title: 'After-start enrichment active' },
  { id: 'dfco', keys: ['dfco', 'dfcoActive'], label: 'OVER-RUN CUT', tone: 'info', title: 'Deceleration fuel cut active' },
  { id: 'idle', keys: ['idle', 'isIdling', 'idleActive'], label: 'IDLE CTRL', tone: 'info', title: 'Idle valve/duty active' },
  { id: 'fan', keys: ['fan', 'fanOn', 'fan1'], label: 'FAN', tone: 'info', title: 'Cooling fan commanded on' },
  { id: 'pump', keys: ['fuelPump', 'fuelPumpOn'], label: 'PUMP', tone: 'info', title: 'Fuel pump relay commanded on' },
  { id: 'closedLoop', keys: ['closedLoop', 'isClosedLoop', 'lambdaClosedLoop'], label: 'CLOSED LOOP', tone: 'ok', title: 'Closed-loop fuelling active' },
  { id: 'wmi', keys: ['wmiArmed'], label: 'WMI ARMED', tone: 'info', title: 'Water/meth injection armed' },
];

/* ------------------------------------------------------- source-unit handling */

/**
 * Unit families whose members are inter-convertible by an affine transform.
 *
 * The catalogue declares the unit the *canonical* channel is published in, but
 * an INI is free to publish the same channel in a different member of the family
 * (MegaSquirt INIs publish coolant in °F, some publish fuel pressure in PSI).
 * `adaptSpecToUnit` re-expresses a spec — value unit, display range **and
 * threshold bands** — in whatever unit the loaded INI actually declares, so a
 * limit can never be judged against the wrong scale.
 */
export type UnitFamily = 'temperature' | 'pressure' | 'speed' | 'ratio' | 'none';

export function unitFamily(unit: string): UnitFamily {
  const u = unit.toLowerCase().replace(/\s+/g, '');
  if (!u) return 'none';
  if (u.includes('°c') || u === 'c' || u.includes('degc') || u.includes('celsius')) return 'temperature';
  if (u.includes('°f') || u === 'f' || u.includes('degf') || u.includes('fahrenheit')) return 'temperature';
  if (u === 'k' || u.includes('kelvin')) return 'temperature';
  if (u.includes('kpa') || u.includes('psi') || u.includes('bar') || u.includes('inhg')) return 'pressure';
  if (u.includes('km/h') || u.includes('kph') || u.includes('kmh') || u.includes('mph')) return 'speed';
  if (u.includes('λ') || u.includes('lambda') || u.includes('afr')) return 'ratio';
  return 'none';
}

/** Affine transform between two units of the same family, or null if unrelated. */
export function unitTransform(from: string, to: string): { scale: number; offset: number } | null {
  const family = unitFamily(from);
  if (family === 'none' || family !== unitFamily(to)) return null;
  const identity = { scale: 1, offset: 0 };
  const norm = (u: string) => u.toLowerCase().replace(/\s+/g, '');
  if (norm(from) === norm(to)) return identity;

  if (family === 'temperature') {
    // toC: value → °C, fromC: °C → value
    const toC: Record<string, { scale: number; offset: number }> = {
      c: { scale: 1, offset: 0 },
      degc: { scale: 1, offset: 0 },
      '°c': { scale: 1, offset: 0 },
      celsius: { scale: 1, offset: 0 },
      f: { scale: 5 / 9, offset: -32 * (5 / 9) },
      degf: { scale: 5 / 9, offset: -32 * (5 / 9) },
      '°f': { scale: 5 / 9, offset: -32 * (5 / 9) },
      fahrenheit: { scale: 5 / 9, offset: -32 * (5 / 9) },
      k: { scale: 1, offset: -273.15 },
      kelvin: { scale: 1, offset: -273.15 },
    };
    const fromC: Record<string, { scale: number; offset: number }> = {
      c: { scale: 1, offset: 0 },
      degc: { scale: 1, offset: 0 },
      '°c': { scale: 1, offset: 0 },
      celsius: { scale: 1, offset: 0 },
      f: { scale: 9 / 5, offset: 32 },
      degf: { scale: 9 / 5, offset: 32 },
      '°f': { scale: 9 / 5, offset: 32 },
      fahrenheit: { scale: 9 / 5, offset: 32 },
      k: { scale: 1, offset: 273.15 },
      kelvin: { scale: 1, offset: 273.15 },
    };
    const a = toC[norm(from)];
    const b = fromC[norm(to)];
    if (!a || !b) return null;
    return { scale: a.scale * b.scale, offset: a.offset * b.scale + b.offset };
  }

  if (family === 'pressure') {
    // Factor into kPa.
    const toKpa: Record<string, number> = { kpa: 1, psi: 6.89476, bar: 100, inhg: 3.38639 };
    const a = toKpa[norm(from)];
    const b = toKpa[norm(to)];
    if (!a || !b) return null;
    return { scale: a / b, offset: 0 };
  }

  if (family === 'speed') {
    const toKmh: Record<string, number> = { 'km/h': 1, kmh: 1, kph: 1, mph: 1.609344 };
    const a = toKmh[norm(from)];
    const b = toKmh[norm(to)];
    if (!a || !b) return null;
    return { scale: a / b, offset: 0 };
  }

  // λ ↔ AFR is a ratio, not an affine transform of the same family member, and
  // depends on the fuel's stoichiometry — handled by `fuelRatio` instead.
  return null;
}

/**
 * Re-express a catalogue spec in the unit the loaded INI declares for the
 * channel. Returns the spec untouched when the unit is unrelated or unknown.
 */
export function adaptSpecToUnit(spec: ChannelSpec, iniUnit: string): ChannelSpec {
  const declared = iniUnit.trim();
  if (!declared || declared === spec.unit) return spec;
  const transform = unitTransform(spec.unit, declared);
  if (!transform) return spec;
  const apply = (value: number) =>
    Number.isFinite(value) ? value * transform.scale + transform.offset : value;
  return {
    ...spec,
    unit: declared,
    min: apply(spec.min),
    max: apply(spec.max),
    bands: spec.bands?.map((band) => ({ ...band, max: apply(band.max) })),
  };
}

/* ------------------------------------------------------------------ helpers */

export function formatNumber(value: number | undefined, digits: number): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function formatSigned(value: number, digits: number): string {
  const s = value.toFixed(digits);
  return value > 0 ? `+${s}` : s;
}

/**
 * Resolve a spec to a real stream key. Canonical aliases are emitted by the
 * backend, but an ECU that publishes only its native name still works: we try
 * every candidate against the union of (INI channel list ∪ live stream keys).
 */
export function resolveKey(spec: ChannelSpec, available: ReadonlySet<string>): string | undefined {
  for (const key of spec.keys) if (available.has(key)) return key;
  return undefined;
}

/** Resolve the first present key from a candidate list (reference/target channels). */
export function resolveKeys(keys: string[], available: ReadonlySet<string>): string | undefined {
  for (const key of keys) if (available.has(key)) return key;
  return undefined;
}

/** Band lookup for a value, in source units. */
export function bandFor(spec: ChannelSpec, value: number | undefined): Band | undefined {
  if (!spec.bands || value === undefined || !Number.isFinite(value)) return undefined;
  for (const band of spec.bands) if (value <= band.max) return band;
  return spec.bands[spec.bands.length - 1];
}

/** Warning/critical tone for a value (never 'ok' for a missing value). */
export function toneFor(spec: ChannelSpec, value: number | undefined): Tone {
  if (value === undefined || !Number.isFinite(value)) return 'dim';
  if (spec.zeroIsGap && value === 0) return 'dim';
  return bandFor(spec, value)?.tone ?? 'ok';
}

export function isGap(spec: ChannelSpec, value: number | undefined): boolean {
  return value === undefined || !Number.isFinite(value) || (spec.zeroIsGap === true && value === 0);
}

export function flagActive(values: Record<string, number>, spec: FlagSpec): boolean | undefined {
  for (const key of spec.keys) {
    const v = values[key];
    if (v !== undefined && Number.isFinite(v)) return v > 0.5;
  }
  return undefined;
}

/* ------------------------------------------------------- engine state model */

export type EnginePhase = 'off' | 'cranking' | 'idle' | 'overrun' | 'running' | 'load' | 'unknown';

export interface EngineState {
  phase: EnginePhase;
  label: string;
  tone: Tone;
  /** How the phase was derived — shown in the tile's tooltip so it is never a black box. */
  basis: string;
}

/**
 * Derive the operating phase from live data.
 *
 * This is a *presentation* heuristic over rpm/tps/map — the ECU's own state
 * flags (limiter, launch, ASE, DFCO) are rendered from the ECU's channels and
 * always win. The basis string is surfaced in the UI so nobody mistakes a
 * derived label for a device-reported one.
 */
export function engineState(sample: {
  rpm?: number;
  tps?: number;
  map?: number;
  softLimit?: boolean;
  hardLimit?: boolean;
  launch?: boolean;
}): EngineState {
  const rpm = sample.rpm;
  if (rpm === undefined || !Number.isFinite(rpm)) {
    return { phase: 'unknown', label: 'NO DATA', tone: 'dim', basis: 'no rpm channel' };
  }
  if (sample.hardLimit) return { phase: 'running', label: 'HARD LIMIT', tone: 'crit', basis: 'ECU hard limiter' };
  if (sample.softLimit) return { phase: 'running', label: 'SOFT LIMIT', tone: 'warn', basis: 'ECU soft limiter' };
  if (sample.launch) return { phase: 'cranking', label: 'LAUNCH', tone: 'info', basis: 'ECU launch control' };

  const tps = sample.tps ?? 0;
  const map = sample.map;
  if (rpm < 60) return { phase: 'off', label: 'ENGINE OFF', tone: 'dim', basis: 'rpm < 60' };
  if (rpm <= 450) return { phase: 'cranking', label: 'CRANKING', tone: 'info', basis: 'rpm 60–450' };
  if (rpm > 1400 && tps < 2 && map !== undefined && map <= 45) {
    return { phase: 'overrun', label: 'OVER-RUN', tone: 'info', basis: 'rpm > 1400, tps < 2 %, MAP ≤ 45 kPa' };
  }
  if (tps >= 55 || (map !== undefined && map >= 130)) {
    return { phase: 'load', label: 'LOAD', tone: 'warn', basis: 'tps ≥ 55 % or MAP ≥ 130 kPa' };
  }
  if (rpm <= 1200 && tps < 5 && (map === undefined || map <= 60)) {
    return { phase: 'idle', label: 'IDLE', tone: 'ok', basis: 'rpm ≤ 1200, tps < 5 %, MAP ≤ 60 kPa' };
  }
  return { phase: 'running', label: 'RUNNING', tone: 'ok', basis: 'rpm > 450' };
}

/* -------------------------------------------------- measured / commanded pair */

export interface FuelRatio {
  /** Measured value in `unit`. */
  measured?: number;
  /** Commanded value in the same unit. */
  target?: number;
  unit: 'AFR' | 'λ';
  /** True when the ECU published λ/AFR directly; false when converted from the other side. */
  measuredDerived: boolean;
  targetDerived: boolean;
}

/**
 * Build the measured/commanded ratio pair.
 *
 * Prefers the user's preferred unit (AFR or λ) when the ECU publishes both —
 * if only one side exists it is converted with the configured stoichiometric
 * ratio, and `source` is flagged so the UI can mark the value as derived.
 */
export function fuelRatio(
  values: Record<string, number>,
  available: ReadonlySet<string>,
  prefer: 'AFR' | 'Lambda',
  stoich: number,
): FuelRatio | undefined {
  const measLambda = pickSpec(CHANNELS.lambda, values, available);
  const measAfr = pickSpec(CHANNELS.afr, values, available);
  const tgtLambda = pickSpec(CHANNELS.lambdaTarget, values, available);
  const tgtAfr = pickSpec(CHANNELS.afrTarget, values, available);

  let measured: number | undefined;
  let target: number | undefined;
  let measuredDerived = false;
  let targetDerived = false;
  let unit: 'AFR' | 'λ';

  const measuredIsLambda = measLambda !== undefined;
  const measuredValue = measuredIsLambda ? measLambda : measAfr;
  const targetIsLambda = tgtLambda !== undefined;
  const targetValue = targetIsLambda ? tgtLambda : tgtAfr;

  if (measuredValue === undefined && targetValue === undefined) return undefined;

  if (prefer === 'Lambda') {
    unit = 'λ';
    measured = measuredValue === undefined
      ? undefined
      : measuredIsLambda
        ? measuredValue
        : measuredValue / stoich;
    target = targetValue === undefined
      ? undefined
      : targetIsLambda
        ? targetValue
        : targetValue / stoich;
    measuredDerived = !measuredIsLambda && measuredValue !== undefined;
    targetDerived = !targetIsLambda && targetValue !== undefined;
  } else {
    unit = 'AFR';
    measured = measuredValue === undefined
      ? undefined
      : measuredIsLambda
        ? measuredValue * stoich
        : measuredValue;
    target = targetValue === undefined
      ? undefined
      : targetIsLambda
        ? targetValue * stoich
        : targetValue;
    measuredDerived = measuredIsLambda && measuredValue !== undefined;
    targetDerived = targetIsLambda && targetValue !== undefined;
  }

  return { measured, target, unit, measuredDerived, targetDerived };
}

function pickSpec(
  spec: ChannelSpec,
  values: Record<string, number>,
  available: ReadonlySet<string>,
): number | undefined {
  const key = resolveKey(spec, available);
  if (key === undefined) return undefined;
  const value = values[key];
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (isGap(spec, value)) return undefined;
  return value;
}

/**
 * Effective boost in kPa (gauge). Uses the ECU's boost channel when it exists,
 * otherwise derives it from MAP minus baro (or standard atmosphere) and says so.
 */
export function effectiveBoost(
  values: Record<string, number>,
  available: ReadonlySet<string>,
): { value?: number; derived: boolean } {
  const boostKey = resolveKey(CHANNELS.boost, available);
  if (boostKey !== undefined && Number.isFinite(values[boostKey])) {
    return { value: values[boostKey], derived: false };
  }
  const mapKey = resolveKey(CHANNELS.map, available);
  if (mapKey === undefined || !Number.isFinite(values[mapKey]) || values[mapKey] === 0) {
    return { derived: false };
  }
  const baroKey = resolveKey(CHANNELS.baro, available);
  const baro = baroKey !== undefined && Number.isFinite(values[baroKey]) && values[baroKey] > 50
    ? values[baroKey]
    : 101.325;
  return { value: values[mapKey] - baro, derived: true };
}
