/** rusEFI-family knock spectrum OCH unpack (mirrors libretune_core::knock). */

export const SPECTRUM_WORD_COUNT = 16;
export const SPECTRUM_BIN_COUNT = 64;

export interface KnockSpectrumFrame {
  bins: Uint8Array;
  freqStartHz: number;
  freqStepHz: number;
  channel: number;
  cylinder: number;
}

export function unpackSpectrumWord(word: number): [number, number, number, number] {
  const w = word >>> 0;
  return [(w >>> 24) & 0xff, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff];
}

export function unpackSpectrumWords(words: number[]): Uint8Array {
  const bins = new Uint8Array(SPECTRUM_BIN_COUNT);
  for (let i = 0; i < SPECTRUM_WORD_COUNT; i++) {
    const chunk = unpackSpectrumWord(words[i] ?? 0);
    const base = i * 4;
    bins[base] = chunk[0];
    bins[base + 1] = chunk[1];
    bins[base + 2] = chunk[2];
    bins[base + 3] = chunk[3];
  }
  return bins;
}

export function unpackChannelCyl(packed: number): { channel: number; cylinder: number } {
  const v = packed >>> 0;
  return { channel: (v >>> 8) & 0xff, cylinder: v & 0xff };
}

export function frameFromOch(channels: Record<string, number>): KnockSpectrumFrame | null {
  if (channels.m_knockSpectrum1 === undefined) return null;
  const words: number[] = [];
  for (let i = 1; i <= SPECTRUM_WORD_COUNT; i++) {
    words.push(channels[`m_knockSpectrum${i}`] ?? 0);
  }
  const packed = channels.m_knockSpectrumChannelCyl ?? 0;
  const { channel, cylinder } = unpackChannelCyl(packed);
  return {
    bins: unpackSpectrumWords(words),
    freqStartHz: channels.m_knockFrequencyStart ?? 0,
    freqStepHz: channels.m_knockFrequencyStep ?? 0,
    channel,
    cylinder,
  };
}

export function frequencyHz(frame: KnockSpectrumFrame, bin: number): number {
  return frame.freqStartHz + bin * frame.freqStepHz;
}

export function peakBin(frame: KnockSpectrumFrame): { index: number; amplitude: number } {
  let index = 0;
  let amplitude = 0;
  for (let i = 0; i < frame.bins.length; i++) {
    const v = frame.bins[i]!;
    if (v > amplitude) {
      amplitude = v;
      index = i;
    }
  }
  return { index, amplitude };
}

/** Heat-map color for amplitude 0..255 → dark blue → cyan → yellow → red. */
export function amplitudeColor(v: number): string {
  const t = Math.max(0, Math.min(1, v / 255));
  if (t < 0.25) {
    const u = t / 0.25;
    return `rgb(0, ${Math.round(40 + 80 * u)}, ${Math.round(80 + 120 * u)})`;
  }
  if (t < 0.5) {
    const u = (t - 0.25) / 0.25;
    return `rgb(0, ${Math.round(120 + 135 * u)}, ${Math.round(200 - 80 * u)})`;
  }
  if (t < 0.75) {
    const u = (t - 0.5) / 0.25;
    return `rgb(${Math.round(255 * u)}, 255, 0)`;
  }
  const u = (t - 0.75) / 0.25;
  return `rgb(255, ${Math.round(255 * (1 - u))}, 0)`;
}

export const KNOCK_SPECTRUM_CHANNELS: string[] = [
  ...Array.from({ length: SPECTRUM_WORD_COUNT }, (_, i) => `m_knockSpectrum${i + 1}`),
  "m_knockSpectrumChannelCyl",
  "m_knockFrequencyStart",
  "m_knockFrequencyStep",
  "m_knockLevel",
  "m_knockRetard",
  "m_knockCount",
  "rpm",
];
