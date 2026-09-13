/**
 * F1 steering-wheel LCD. Composed driver display — not a gauge grid.
 * Missing channels show "—"; values are never invented.
 * Later: last/running/best/delta once we have GPS, a lap beacon, or a button.
 * IMU G-lat/G-long and GPS speed aliases are already wired.
 */
import { useEffect, useMemo, useState } from 'react';
import { useChannels, useIsReceivingData } from '../../stores/realtimeStore';
import './RaceMonitor.css';

export interface RaceMonitorProps {
  isConnected: boolean;
}

type Page = 'race' | 'engine';

const RPM_MAX = 8000;
const RPM_FLASH = 7200;
const GREEN_LEDS = 5;
const TICKS = 36;

export function isRaceMonitorPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const base = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  return base === 'race.ltdash.xml' || base.startsWith('race.');
}

export function formatRaceGear(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return 'N';
  const g = Math.round(value);
  if (g < 0) return 'R';
  if (g === 0) return 'N';
  return String(g);
}

export function rpmBarPct(rpm: number | undefined, max = RPM_MAX): number {
  if (rpm === undefined || Number.isNaN(rpm) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (rpm / max) * 100));
}

export function greenLedsOn(rpm: number | undefined, max = RPM_MAX, count = GREEN_LEDS): number {
  if (rpm === undefined || Number.isNaN(rpm) || max <= 0) return 0;
  const t = Math.max(0, Math.min(1, (rpm / max - 0.72) / 0.28));
  return Math.round(t * count);
}

export function formatSigned(value: number | undefined, digits: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  const n = value.toFixed(digits);
  return value > 0 ? `+${n}` : n;
}

/** 0=OFF, 1=ARMED, ≥2 or pump duty = ON (rusEFI wmiState / isWmiEnabled). */
export function formatWmi(
  state: number | undefined,
  duty?: number,
): { label: string; cls: string } {
  if (duty !== undefined && !Number.isNaN(duty) && duty > 1) return { label: 'ON', cls: 'ok' };
  if (state === undefined || Number.isNaN(state)) return { label: '—', cls: 'dim' };
  if (state >= 1.5) return { label: 'ON', cls: 'ok' };
  if (state >= 0.5) return { label: 'ARMED', cls: 'ok' };
  return { label: 'OFF', cls: 'dim' };
}

function pick(channels: Record<string, number>, name: string): number | undefined {
  if (channels[name] !== undefined) return channels[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(channels)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function fmt(value: number | undefined, digits: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function tone(value: number | undefined, spec: { lo?: number; hi?: number; crit?: number }): string {
  if (value === undefined) return 'dim';
  if (spec.crit !== undefined && value >= spec.crit) return 'crit';
  if (spec.hi !== undefined && value >= spec.hi) return 'warn';
  if (spec.lo !== undefined && value <= spec.lo) return 'warn';
  return '';
}

function Cell({
  k,
  v,
  cls = '',
  bar,
}: {
  k: string;
  v: string;
  cls?: string;
  bar?: number;
}) {
  return (
    <div className={`rm-cell ${cls}`}>
      <span className="rm-k">{k}</span>
      <span className="rm-n">{v}</span>
      {bar !== undefined ? (
        <span className="rm-bar">
          <i style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </span>
      ) : null}
    </div>
  );
}

export default function RaceMonitor({ isConnected }: RaceMonitorProps) {
  const [page, setPage] = useState<Page>('race');
  const live = useIsReceivingData();
  const channels = useChannels([
    'rpm', 'speed', 'gear', 'tps', 'map', 'boost', 'afr', 'afrTarget', 'lambda',
    'coolant', 'iat', 'oilPressure', 'oilTemp', 'battery', 'dutyCycle',
    'advance', 'fuelLevel', 'wmiArmed', 'wmiDuty', 'launch', 'egt', 'gLat', 'gLong',
  ]);

  const rpm = pick(channels, 'rpm');
  const speed = pick(channels, 'speed');
  const gear = pick(channels, 'gear');
  const tps = pick(channels, 'tps');
  const map = pick(channels, 'map');
  const boost = pick(channels, 'boost');
  const afr = pick(channels, 'afr') ?? (pick(channels, 'lambda') !== undefined
    ? pick(channels, 'lambda')! * 14.7
    : undefined);
  const afrT = pick(channels, 'afrTarget');
  const fuel = pick(channels, 'fuelLevel');
  const wmi = pick(channels, 'wmiArmed');
  const wmiDuty = pick(channels, 'wmiDuty');
  const gLat = pick(channels, 'gLat');
  const gLong = pick(channels, 'gLong');
  const launch = pick(channels, 'launch');
  const oilP = pick(channels, 'oilPressure');
  const oilT = pick(channels, 'oilTemp');
  const clt = pick(channels, 'coolant');
  const iat = pick(channels, 'iat');
  const batt = pick(channels, 'battery');
  const duty = pick(channels, 'dutyCycle');
  const tim = pick(channels, 'advance');
  const egt = pick(channels, 'egt');

  const afrErr = afr !== undefined && afrT !== undefined ? afr - afrT : undefined;
  const flash = rpm !== undefined && rpm >= RPM_FLASH;
  const bar = rpmBarPct(rpm);
  const greens = greenLedsOn(rpm);
  const gearTxt = formatRaceGear(gear);
  const gearTone = gearTxt === 'N' || gearTxt === 'R' ? ' special' : '';

  const wmiTxt = formatWmi(wmi, wmiDuty);
  const flankL = wmi !== undefined || wmiDuty !== undefined
    ? { k: 'WMI', v: wmiTxt.label, cls: `stat ${wmiTxt.cls}` }
    : launch !== undefined
      ? { k: 'LC', v: Math.abs(launch) > 0.5 ? 'ON' : 'OFF', cls: `stat ${Math.abs(launch) > 0.5 ? 'ok' : 'dim'}` }
      : { k: 'AFR', v: fmt(afr, 1), cls: tone(afr, { lo: 11.5, hi: 16.5 }) };

  const flankR = boost !== undefined
    ? { k: 'BST', v: fmt(boost, 0), cls: tone(boost, { hi: 220 }) }
    : { k: 'THR', v: fmt(tps, 0), cls: '' };

  const gap = gLat !== undefined
    ? { k: 'G-LAT', v: formatSigned(gLat, 2), cls: Math.abs(gLat) >= 1.2 ? 'warn' : '', bar: Math.min(100, Math.abs(gLat) * 40) }
    : afrErr !== undefined
      ? { k: 'AFR Δ', v: formatSigned(afrErr, 2), cls: Math.abs(afrErr) < 0.35 ? 'ok' : Math.abs(afrErr) < 0.8 ? 'warn' : 'crit', bar: Math.min(100, Math.abs(afrErr) * 50) }
      : { k: 'AFR', v: fmt(afr, 1), cls: tone(afr, { lo: 11.5, hi: 16.5 }), bar: afr === undefined ? 0 : Math.max(0, Math.min(100, ((afr - 10) / 8) * 100)) };

  const rots = gLat !== undefined || gLong !== undefined
    ? [
        { v: fmt(map, 0), k: 'MAP' },
        { v: formatSigned(gLat, 2), k: 'G-LAT' },
        { v: formatSigned(gLong, 2), k: 'G-LON' },
      ]
    : [
        { v: fmt(map, 0), k: 'MAP' },
        { v: fmt(tim, 1), k: 'TIM' },
        { v: fmt(tps, 0), k: 'THR' },
      ];

  const warns = useMemo(() => {
    const out: string[] = [];
    if (oilP !== undefined && oilP < 180 && (rpm ?? 0) > 1500) out.push('OIL PRESSURE');
    if (clt !== undefined && clt >= 105) out.push('WATER TEMP');
    if (oilT !== undefined && oilT >= 125) out.push('OIL TEMP');
    if (batt !== undefined && batt <= 11.5) out.push('BATTERY');
    if (fuel !== undefined && fuel <= 10) out.push('LOW FUEL');
    return out;
  }, [oilP, clt, oilT, batt, fuel, rpm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '1') setPage('race');
      if (e.key === '2') setPage('engine');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`race-monitor${isConnected && live ? '' : ' offline'}`}>
      <div className="rm-face">
        <div className={`rm-leds${flash ? ' flash' : ''}`}>
          <div className="rm-ticks">
            {Array.from({ length: TICKS }, (_, i) => (
              <span key={i} className={i % 5 === 0 ? 'maj' : ''} />
            ))}
          </div>
          <div className="rm-led-row">
            <span className="rm-rpm-bar">
              <i className={flash ? 'crit' : bar >= 80 ? 'hot' : ''} style={{ width: `${bar}%` }} />
            </span>
            <span className="rm-greens">
              {Array.from({ length: GREEN_LEDS }, (_, i) => (
                <b key={i} className={i < greens ? 'on' : ''} />
              ))}
            </span>
          </div>
        </div>

        {page === 'race' ? (
          <div className="rm-race">
            <div className="rm-hero">
              <Cell k="SPD" v={fmt(speed, 0)} cls="hero" />
              <Cell k={flankL.k} v={flankL.v} cls={`flank ${flankL.cls}`} />
              <div className={`rm-gear${gearTone}`}>{gearTxt}</div>
              <Cell k={flankR.k} v={flankR.v} cls={`flank ${flankR.cls}`} />
              <Cell k="RPM" v={fmt(rpm, 0)} cls={`hero${flash ? ' crit' : ''}`} />
            </div>
            <div className="rm-row">
              <Cell k="OIL P" v={fmt(oilP, 0)} cls={tone(oilP, { lo: 180 })} />
              <Cell k={gap.k} v={gap.v} cls={gap.cls} bar={gap.bar} />
              <Cell k="WATER" v={fmt(clt, 0)} cls={tone(clt, { hi: 100, crit: 110 })} />
            </div>
            <div className="rm-row">
              <Cell k="FUEL" v={fmt(fuel, 0)} cls={tone(fuel, { lo: 10 })} />
              <button
                type="button"
                className={`rm-badge${warns.length ? ' crit' : live ? '' : ' dim'}`}
                onClick={() => setPage('engine')}
              >
                {warns[0] ?? (live ? 'RACE' : 'NO LINK')}
              </button>
              <Cell k="BATT" v={fmt(batt, 1)} cls={tone(batt, { lo: 11.5 })} bar={batt === undefined ? 0 : Math.max(0, Math.min(100, ((batt - 10) / 5) * 100))} />
            </div>
            <div className="rm-rots">
              {rots.map((r) => (
                <div key={r.k}><b>{r.v}</b><span>{r.k}</span></div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rm-eng">
            <div className="rm-eng-top">
              <Cell k="AFR" v={fmt(afr, 1)} cls={`lg ${tone(afr, { lo: 11.5, hi: 16.5 })}`} />
              <Cell k="RPM" v={fmt(rpm, 0)} cls={`lg${flash ? ' crit' : ''}`} />
              <Cell k="BST" v={fmt(boost, 0)} cls={`lg ${tone(boost, { hi: 220 })}`} />
            </div>
            <div className="rm-eng-mid">
              <Cell k="SPD" v={fmt(speed, 0)} />
              <Cell k="THR" v={fmt(tps, 0)} />
              <div className={`rm-gear${gearTone}`}>{gearTxt}</div>
              <Cell k="MAP" v={fmt(map, 0)} />
              <Cell k="TIM" v={fmt(tim, 1)} />
            </div>
            <div className="rm-eng-bot">
              <Cell k="OIL P" v={fmt(oilP, 0)} cls={tone(oilP, { lo: 180 })} />
              <Cell k="OIL T" v={fmt(oilT, 0)} cls={tone(oilT, { hi: 120, crit: 130 })} />
              <Cell k="WATER" v={fmt(clt, 0)} cls={tone(clt, { hi: 100, crit: 110 })} />
              <Cell k="IAT" v={fmt(iat, 0)} />
              <Cell k="EGT" v={fmt(egt, 0)} cls={tone(egt, { hi: 850, crit: 950 })} />
              <Cell k="BATT" v={fmt(batt, 1)} cls={tone(batt, { lo: 11.5 })} />
            </div>
            <div className="rm-eng-foot">
              <Cell k="DUTY" v={fmt(duty, 0)} cls={tone(duty, { hi: 85, crit: 95 })} bar={duty ?? 0} />
              <button type="button" className="rm-badge" onClick={() => setPage('race')}>
                ENGINE
              </button>
              <Cell k="FUEL" v={fmt(fuel, 0)} cls={tone(fuel, { lo: 10 })} bar={fuel ?? 0} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
