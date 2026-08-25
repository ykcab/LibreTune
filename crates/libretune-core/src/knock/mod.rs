//! Knock spectrogram decode for rusEFI-family firmwares (rusEFI / FOME / epicEFI).
//!
//! Firmware packs a 64-bin FFT magnitude display into 16 U32 OCH fields
//! (`m_knockSpectrum1`..`16`). LibreTune unpacks those words for a native
//! spectrogram view — no TunerStudio plugin required.

/// Number of compressed U32 words published in OCH.
pub const SPECTRUM_WORD_COUNT: usize = 16;
/// Number of amplitude bins after unpacking.
pub const SPECTRUM_BIN_COUNT: usize = 64;

/// One decoded knock spectrum frame from a coherent OCH snapshot.
#[derive(Debug, Clone, PartialEq)]
pub struct KnockSpectrumFrame {
    /// Amplitudes 0..255 (firmware display units, roughly "dB-like").
    pub bins: [u8; SPECTRUM_BIN_COUNT],
    /// First bin frequency in Hz (`m_knockFrequencyStart`).
    pub freq_start_hz: f64,
    /// Spacing between bins in Hz (`m_knockFrequencyStep`).
    pub freq_step_hz: f64,
    /// Knock sensor channel index (high byte of `m_knockSpectrumChannelCyl`).
    pub channel: u8,
    /// Cylinder index (low byte of `m_knockSpectrumChannelCyl`).
    pub cylinder: u8,
}

impl KnockSpectrumFrame {
    /// Frequency in Hz for bin `i` (0..63).
    pub fn frequency_hz(&self, bin: usize) -> f64 {
        self.freq_start_hz + (bin as f64) * self.freq_step_hz
    }

    /// Index of the loudest bin and its amplitude.
    pub fn peak(&self) -> (usize, u8) {
        let mut best_i = 0usize;
        let mut best_v = 0u8;
        for (i, &v) in self.bins.iter().enumerate() {
            if v > best_v {
                best_v = v;
                best_i = i;
            }
        }
        (best_i, best_v)
    }
}

/// Unpack one compressed spectrum U32 into four amplitude bytes (MSB first).
#[inline]
pub fn unpack_spectrum_word(word: u32) -> [u8; 4] {
    [
        ((word >> 24) & 0xff) as u8,
        ((word >> 16) & 0xff) as u8,
        ((word >> 8) & 0xff) as u8,
        (word & 0xff) as u8,
    ]
}

/// Unpack all 16 spectrum words into a contiguous 64-bin amplitude array.
pub fn unpack_spectrum_words(words: &[u32; SPECTRUM_WORD_COUNT]) -> [u8; SPECTRUM_BIN_COUNT] {
    let mut bins = [0u8; SPECTRUM_BIN_COUNT];
    for (i, word) in words.iter().enumerate() {
        let chunk = unpack_spectrum_word(*word);
        let base = i * 4;
        bins[base..base + 4].copy_from_slice(&chunk);
    }
    bins
}

/// Split `m_knockSpectrumChannelCyl` into (channel, cylinder).
#[inline]
pub fn unpack_channel_cyl(packed: u16) -> (u8, u8) {
    (((packed >> 8) & 0xff) as u8, (packed & 0xff) as u8)
}

/// Build a frame from OCH values already decoded as f64 by the realtime path.
///
/// Words are taken from `spectrum_words[0]` = `m_knockSpectrum1`, etc.
/// Non-finite or out-of-range values are treated as zero.
pub fn frame_from_och_f64(
    spectrum_words: &[f64; SPECTRUM_WORD_COUNT],
    freq_start_hz: f64,
    freq_step_hz: f64,
    channel_cyl: f64,
) -> KnockSpectrumFrame {
    let mut words = [0u32; SPECTRUM_WORD_COUNT];
    for (i, v) in spectrum_words.iter().enumerate() {
        words[i] = if v.is_finite() && *v >= 0.0 {
            v.min(u32::MAX as f64) as u32
        } else {
            0
        };
    }
    let packed = if channel_cyl.is_finite() && channel_cyl >= 0.0 {
        channel_cyl.min(u16::MAX as f64) as u16
    } else {
        0
    };
    let (channel, cylinder) = unpack_channel_cyl(packed);
    KnockSpectrumFrame {
        bins: unpack_spectrum_words(&words),
        freq_start_hz: if freq_start_hz.is_finite() {
            freq_start_hz
        } else {
            0.0
        },
        freq_step_hz: if freq_step_hz.is_finite() {
            freq_step_hz
        } else {
            0.0
        },
        channel,
        cylinder,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpack_word_msb_first() {
        assert_eq!(unpack_spectrum_word(0x01020304), [0x01, 0x02, 0x03, 0x04]);
    }

    #[test]
    fn unpack_all_words_fills_64_bins() {
        let mut words = [0u32; SPECTRUM_WORD_COUNT];
        words[0] = 0xAABBCCDD;
        words[15] = 0x11223344;
        let bins = unpack_spectrum_words(&words);
        assert_eq!(&bins[0..4], &[0xAA, 0xBB, 0xCC, 0xDD]);
        assert_eq!(&bins[60..64], &[0x11, 0x22, 0x33, 0x44]);
        assert_eq!(bins[4], 0);
    }

    #[test]
    fn channel_cyl_split() {
        assert_eq!(unpack_channel_cyl(0x0205), (2, 5));
        assert_eq!(unpack_channel_cyl(0x0000), (0, 0));
    }

    #[test]
    fn frame_peak_and_frequency() {
        let mut words = [0.0f64; SPECTRUM_WORD_COUNT];
        // Word 2 covers bins 8..11; put peak at bin 9 = second byte of word.
        words[2] = f64::from(0x00_F0_00_00u32);
        let frame = frame_from_och_f64(&words, 4000.0, 100.0, f64::from(0x0103u16));
        assert_eq!(frame.channel, 1);
        assert_eq!(frame.cylinder, 3);
        assert_eq!(frame.peak(), (9, 0xF0));
        assert!((frame.frequency_hz(9) - 4900.0).abs() < 1e-9);
    }
}
