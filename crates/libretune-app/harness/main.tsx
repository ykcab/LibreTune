/**
 * Screenshot harness for the Startup dashboard.
 *
 * Renders the real `StartupDash` component with:
 *  - a stubbed Tauri IPC layer (`tauri-stub.ts`),
 *  - a virtual clock (Date.now is accelerated 5×) so a 30 s session with a full
 *    history buffer, coverage map and event stream can be captured in ~7 s,
 *  - two deterministic driving profiles: `nominal` and `faulty`
 *    (`?state=faulty`), plus `?theme=light|dark|...` for theme checks.
 *
 * Not part of the shipped app.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../src/themes/fonts.css';
import '../src/themes/base.css';
import '../src/components/dashboards/TsDashboard.css';
import { UnitPreferencesProvider } from '../src/contexts/useUnitPreferences';
import StartupDash from '../src/components/dashboards/startup/StartupDash';
import { useRealtimeStore } from '../src/stores/realtimeStore';
import type { ChannelMeta } from '../src/components/dashboards/startup/types';

const params = new URLSearchParams(window.location.search);
const state = params.get('state') ?? 'nominal';
const faulty = state === 'faulty';
const offline = state === 'offline';
const theme = params.get('theme') ?? 'dark';
document.documentElement.setAttribute('data-theme', theme);

/* ------------------------------------------------------------- virtual clock */

const realNow = Date.now.bind(Date);
let virtualOffset = 0;
Date.now = () => realNow() + virtualOffset;

/* ------------------------------------------------------------ channel metadata */

const CHANNEL_META: ChannelMeta[] = [
  { name: 'rpm', label: 'RPM', units: '' },
  { name: 'map', label: 'MAP', units: 'kPa' },
  { name: 'baro', label: 'Baro', units: 'kPa' },
  { name: 'tps', label: 'TPS', units: '%' },
  { name: 'throttlePedalPosition', label: 'Pedal', units: '%' },
  { name: 'coolant', label: 'CLT', units: '°C' },
  { name: 'iat', label: 'IAT', units: '°C' },
  { name: 'oilPressure', label: 'Oil pressure', units: 'kPa' },
  { name: 'oilTemp', label: 'Oil temp', units: '°C' },
  { name: 'fuelPressure', label: 'Fuel pressure', units: 'kPa' },
  { name: 'lambda', label: 'Lambda', units: 'λ' },
  { name: 'lambdaValue2', label: 'Lambda 2', units: 'λ' },
  { name: 'afrTarget', label: 'AFR target', units: 'AFR' },
  { name: 'advance', label: 'Ignition advance', units: 'deg' },
  { name: 'dwell', label: 'Dwell', units: 'ms' },
  { name: 'dutyCycle', label: 'Injector duty', units: '%' },
  { name: 'pulseWidth', label: 'Pulse width', units: 'ms' },
  { name: 've', label: 'VE', units: '%' },
  { name: 'correction', label: 'Fuel trim', units: '%' },
  { name: 'egt', label: 'EGT', units: '°C' },
  { name: 'knock', label: 'Knock', units: '' },
  { name: 'knockRetard', label: 'Knock retard', units: 'deg' },
  { name: 'flexPercent', label: 'Ethanol', units: '%' },
  { name: 'fuelLevel', label: 'Fuel level', units: '%' },
  { name: 'battery', label: 'Battery', units: 'V' },
  { name: 'speed', label: 'Speed', units: 'km/h' },
  { name: 'gear', label: 'Gear', units: '' },
  { name: 'sync', label: 'Sync', units: '' },
  { name: 'softLimit', label: 'Soft limit', units: '' },
  { name: 'hardLimit', label: 'Hard limit', units: '' },
  { name: 'launch', label: 'Launch', units: '' },
  { name: 'ase', label: 'Afterstart', units: '' },
  { name: 'fan', label: 'Fan', units: '' },
  { name: 'fuelPump', label: 'Fuel pump', units: '' },
  { name: 'closedLoop', label: 'Closed loop', units: '' },
  { name: 'rpmHardLimit', label: 'Rev limit', units: '' },
  { name: 'boostTarget', label: 'Boost target', units: 'kPa' },
  { name: 'idleTarget', label: 'Idle target', units: 'rpm' },
  { name: 'wue', label: 'Warmup enrich', units: '%' },
  { name: 'vvtIntake', label: 'VVT intake', units: 'deg' },
  { name: 'egt2', label: 'EGT 2', units: '°C' },
];

/* ------------------------------------------------------------- driving profile */

let seed = 987654321;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

/** One 14 s cycle: idle → 3rd gear pull → shift → over-run. */
function profile(seconds: number): Record<string, number> {
  const cycle = seconds % 14;
  let rpm = 850;
  let map = 34;
  let tps = 0;
  let gear = 1;

  if (cycle >= 2 && cycle < 9.5) {
    const phase = (cycle - 2) / 7.5; // 0..1 through the pull
    const accel = Math.sin(Math.min(1, phase) * Math.PI * 0.5);
    rpm = 1400 + 4700 * accel;
    map = 45 + 168 * accel;
    tps = Math.min(100, 18 + 88 * accel);
    gear = 3;
  } else if (cycle >= 9.5 && cycle < 10.6) {
    rpm = 6100 - 1500 * ((cycle - 9.5) / 1.1);
    map = 30;
    tps = 4;
    gear = 3;
  } else if (cycle >= 10.6 && cycle < 12.2) {
    rpm = 4600 - 900 * ((cycle - 10.6) / 1.6);
    map = 28;
    tps = 0;
    gear = 4;
  } else if (cycle >= 12.2) {
    rpm = 3600 - 600 * ((cycle - 12.2) / 1.8);
    map = 30;
    tps = 12;
    gear = 4;
  }

  const loaded = map > 100;
  const target = loaded ? 0.85 : map > 55 ? 0.95 : 1.0;
  // A 3 %-rich, 2 %-lean breathing pattern — realistic, and it exercises the
  // error meter without tripping the alert rules in the nominal profile.
  let lambda = target + (rnd() - 0.5) * 0.02 + 0.01;
  if (faulty) {
    if (loaded && cycle > 6) lambda = target + 0.09 + rnd() * 0.03; // lean under load
  }
  const coolant = faulty ? 104 + cycle * 0.6 : 88 + cycle * 0.12;
  // Oil pressure tracks engine speed (and load a little) — not MAP, which would
  // be backwards. The faulty profile runs deliberately thin above idle.
  const oilPressure = faulty
    ? 120 + rpm * 0.02 + map * 0.2
    : 150 + rpm * 0.05 + map * 0.6;
  const duty = 8 + (map / 210) * 74;

  return {
    rpm,
    map,
    baro: 100.2,
    tps,
    throttlePedalPosition: Math.min(100, tps * 1.02),
    coolant,
    iat: 32 + (map / 210) * 12,
    oilPressure,
    oilTemp: 104 + cycle * 0.2,
    fuelPressure: 300 + (map / 210) * 110,
    lambda,
    lambdaValue2: lambda + (loaded ? 0.04 : 0.01) + (rnd() - 0.5) * 0.004,
    targetLambda: target,
    afrTarget: target * 14.7,
    advance: 10 + (rpm / 6100) * 18,
    dwell: 2.6,
    dutyCycle: duty,
    pulseWidth: 1.4 + (duty / 100) * 12,
    ve: 42 + (map / 210) * 48,
    correction: 100 + (rnd() - 0.5) * 4,
    egt: 380 + (map / 210) * 400 + (faulty ? 130 : 0),
    knock: faulty && loaded ? (rnd() > 0.72 ? 2 : 0) : 0,
    knockRetard: faulty && loaded && rnd() > 0.8 ? 1.8 : 0,
    flexPercent: 0,
    fuelLevel: 46,
    battery: faulty ? 12.2 : 14.1,
    speed: gear === 3 ? 40 + (rpm / 6100) * 110 : 60 + (rpm / 6100) * 60,
    gear,
    sync: 1,
    softLimit: 0,
    hardLimit: 0,
    launch: 0,
    ase: seconds < 3 ? 1 : 0,
    fan: coolant > 103 ? 1 : 0,
    fuelPump: 1,
    closedLoop: map > 55 ? 1 : 0,
    rpmHardLimit: 7200,
    boostTarget: 180,
    idleTarget: 880,
    wue: 0,
    vvtIntake: 12,
    egt2: 0,
  };
}

/* --------------------------------------------------------------------- bootstrap */

// Seed the vehicle profile the Virtual Dyno tab and the performance panel share,
// so the harness exercises the real read path.
window.localStorage.setItem(
  'libretune-virtual-dyno-profile',
  JSON.stringify({
    weight_kg: 1180,
    cargo_kg: 95,
    drag_coefficient: 0.34,
    frontal_area_m2: 2.05,
    tire_diameter_m: 0.62,
    gear_ratio: 1.4,
    final_drive: 3.9,
    primary_reduction: 1,
    drivetrain_loss_pct: 15,
  }),
);

// Seed the full history buffer (300 samples = 30 s at 10 Hz virtual).
if (!offline) {
  for (let i = 0; i < 300; i++) {
    virtualOffset += 100;
    useRealtimeStore.getState().updateChannels(profile(i * 0.1));
  }
}

let frame = 300;
if (!offline) {
  window.setInterval(() => {
    virtualOffset += 100; // 10 Hz of virtual time
    frame += 1;
    useRealtimeStore.getState().updateChannels(profile(frame * 0.1));
  }, 20); // ...advancing 5× faster than wall clock
}

function Harness() {
  return (
    <div className="ts-dashboard-container" style={{ height: '100vh' }}>
      <div className="ts-dashboard-startup-host">
        <StartupDash isConnected={!offline} channelMeta={CHANNEL_META} />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UnitPreferencesProvider>
      <Harness />
    </UnitPreferencesProvider>
  </React.StrictMode>,
);
