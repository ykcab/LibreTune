import { describe, expect, it } from 'vitest';
import {
  formatRaceGear,
  formatSigned,
  formatWmi,
  greenLedsOn,
  isRaceMonitorPath,
  rpmBarPct,
} from '../RaceMonitor';

describe('RaceMonitor', () => {
  it('matches the Race dashboard path', () => {
    expect(isRaceMonitorPath('C:/x/Race.ltdash.xml')).toBe(true);
    expect(isRaceMonitorPath('Startup.ltdash.xml')).toBe(false);
  });

  it('formats gear states', () => {
    expect(formatRaceGear(-1)).toBe('R');
    expect(formatRaceGear(0)).toBe('N');
    expect(formatRaceGear(6)).toBe('6');
    expect(formatRaceGear(undefined)).toBe('N');
  });

  it('fills the rpm bar and lights green leds in the shift band', () => {
    expect(rpmBarPct(0)).toBe(0);
    expect(rpmBarPct(4000)).toBe(50);
    expect(rpmBarPct(8000)).toBe(100);
    expect(greenLedsOn(0)).toBe(0);
    expect(greenLedsOn(5760)).toBe(0);
    expect(greenLedsOn(8000)).toBe(5);
  });

  it('formats signed deltas', () => {
    expect(formatSigned(-0.21, 2)).toBe('-0.21');
    expect(formatSigned(0.35, 2)).toBe('+0.35');
    expect(formatSigned(undefined, 2)).toBe('—');
  });

  it('formats WMI off / armed / on', () => {
    expect(formatWmi(0)).toEqual({ label: 'OFF', cls: 'dim' });
    expect(formatWmi(1)).toEqual({ label: 'ARMED', cls: 'ok' });
    expect(formatWmi(2)).toEqual({ label: 'ON', cls: 'ok' });
    expect(formatWmi(1, 40)).toEqual({ label: 'ON', cls: 'ok' });
    expect(formatWmi(undefined)).toEqual({ label: '—', cls: 'dim' });
  });
});
