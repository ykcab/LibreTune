import { describe, expect, it } from 'vitest';
import {
  formatDuty,
  formatNumber,
  formatWf,
  isOn,
  wmiStateInfo,
} from '../wmiFormat';

describe('WMI formatting', () => {
  it('maps every firmware state to a distinct label', () => {
    expect(wmiStateInfo(0)).toMatchObject({ key: 'disabled', shortLabel: 'OFF', tone: 'dim' });
    expect(wmiStateInfo(1)).toMatchObject({ key: 'standby', shortLabel: 'ARMED', tone: 'info' });
    expect(wmiStateInfo(2)).toMatchObject({ key: 'priming', shortLabel: 'ON', tone: 'ok' });
    expect(wmiStateInfo(3)).toMatchObject({ key: 'active', shortLabel: 'ON', tone: 'ok' });
    expect(wmiStateInfo(4)).toMatchObject({ key: 'fault', shortLabel: 'FAULT', tone: 'crit' });
    expect(wmiStateInfo(undefined).shortLabel).toBe('—');
  });

  it('never renders an inactive W/F as zero', () => {
    expect(formatWf(undefined)).toBe('—');
    expect(formatWf(0)).toBe('—');
    expect(formatWf(0.56)).toBe('0.56');
  });

  it('formats missing numbers as an em dash', () => {
    expect(formatNumber(undefined, 2, ' g/s')).toBe('—');
    expect(formatNumber(3.731, 2, ' g/s')).toBe('3.73 g/s');
    expect(formatDuty(undefined)).toBe('—');
    expect(formatDuty(42.4)).toBe('42%');
  });

  it('reads bit constants as on above 0.5', () => {
    expect(isOn(1)).toBe(true);
    expect(isOn(0)).toBe(false);
    expect(isOn(undefined)).toBe(false);
  });
});
