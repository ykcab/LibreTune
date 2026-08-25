import { describe, expect, it } from "vitest";
import {
  frameFromOch,
  frequencyHz,
  peakBin,
  unpackChannelCyl,
  unpackSpectrumWord,
  unpackSpectrumWords,
} from "../knockSpectrum";

describe("knockSpectrum", () => {
  it("unpacks a compressed U32 MSB-first", () => {
    expect(unpackSpectrumWord(0x01020304)).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it("fills 64 bins from 16 words", () => {
    const words = Array(16).fill(0);
    words[0] = 0xaabbccdd;
    words[15] = 0x11223344;
    const bins = unpackSpectrumWords(words);
    expect([...bins.slice(0, 4)]).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
    expect([...bins.slice(60, 64)]).toEqual([0x11, 0x22, 0x33, 0x44]);
  });

  it("splits channel/cylinder", () => {
    expect(unpackChannelCyl(0x0205)).toEqual({ channel: 2, cylinder: 5 });
  });

  it("builds a frame from OCH map and finds the peak", () => {
    const channels: Record<string, number> = {
      m_knockSpectrum1: 0,
      m_knockSpectrum2: 0,
      m_knockSpectrum3: 0x00f00000,
      m_knockSpectrum4: 0,
      m_knockSpectrum5: 0,
      m_knockSpectrum6: 0,
      m_knockSpectrum7: 0,
      m_knockSpectrum8: 0,
      m_knockSpectrum9: 0,
      m_knockSpectrum10: 0,
      m_knockSpectrum11: 0,
      m_knockSpectrum12: 0,
      m_knockSpectrum13: 0,
      m_knockSpectrum14: 0,
      m_knockSpectrum15: 0,
      m_knockSpectrum16: 0,
      m_knockSpectrumChannelCyl: 0x0103,
      m_knockFrequencyStart: 4000,
      m_knockFrequencyStep: 100,
    };
    const frame = frameFromOch(channels);
    expect(frame).not.toBeNull();
    expect(frame!.channel).toBe(1);
    expect(frame!.cylinder).toBe(3);
    expect(peakBin(frame!)).toEqual({ index: 9, amplitude: 0xf0 });
    expect(frequencyHz(frame!, 9)).toBeCloseTo(4900);
  });
});
