//! Data logger / recorder
//!
//! Records real-time data from the ECU.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use super::LogEntry;

/// Hard ceiling on entries kept in memory. Once reached, the oldest entries
/// are discarded (and counted — see `discarded`).
///
/// The old ceiling was 10,000 samples. At the ~8 Hz the legacy read path
/// managed that was ~21 minutes, and an ordinary 28-minute drive silently
/// lost its first ~7 minutes (D7). Raising the realtime read rate (the
/// expected-length read exit) makes this far worse: at 50 Hz, 10,000 samples
/// is only ~3.3 minutes. This ceiling gives ~66 min at 50 Hz / ~5.5 h at
/// 10 Hz. At ~77 f64 channels/entry that is roughly 120 MB worst case, which
/// is acceptable for a desktop tool; streaming straight to disk removes the
/// ceiling entirely and is the longer-term fix.
const MAX_BUFFER_SIZE: usize = 200_000;

/// Data logger state
pub struct DataLogger {
    /// Channel names
    channels: Vec<String>,
    /// In-memory log buffer
    buffer: VecDeque<LogEntry>,
    /// Start time of logging
    start_time: Option<Instant>,
    /// Whether logging is active
    is_recording: bool,
    /// Target sample rate in Hz
    sample_rate: f64,
    /// Next scheduled sample time (fixed cadence, avoids jitter drift)
    next_sample_due: Option<Instant>,
    /// Oldest entries discarded because the buffer hit `max_buffer_size`.
    /// Nonzero means the saved log is missing its earliest samples — surfaced
    /// so the truncation is never silent (the failure mode behind D7).
    discarded: u64,
    /// Hard ceiling on retained entries. Defaults to `MAX_BUFFER_SIZE`; a
    /// field (rather than the const directly) so tests can exercise the
    /// discard path without pushing hundreds of thousands of samples.
    max_buffer_size: usize,
}

impl DataLogger {
    /// Create a new data logger with the given channels
    pub fn new(channels: Vec<String>) -> Self {
        Self {
            channels,
            buffer: VecDeque::with_capacity(MAX_BUFFER_SIZE),
            start_time: None,
            is_recording: false,
            sample_rate: 10.0, // Default 10 Hz
            next_sample_due: None,
            discarded: 0,
            max_buffer_size: MAX_BUFFER_SIZE,
        }
    }

    /// Override the buffer ceiling. Test-only: lets the discard/counter path
    /// be exercised without pushing `MAX_BUFFER_SIZE` samples through the
    /// real-time rate limiter.
    #[cfg(test)]
    fn set_max_buffer_size(&mut self, n: usize) {
        self.max_buffer_size = n;
    }

    /// Set the target sample rate in Hz
    pub fn set_sample_rate(&mut self, rate: f64) {
        self.sample_rate = rate.clamp(1.0, 200.0);
    }

    /// Get the sample rate
    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
    }

    /// Start (or resume) recording.
    ///
    /// Recording appends to the existing buffer: the timeline continues from
    /// the last recorded entry, so stop/start cycles produce one continuous
    /// log with no gaps. Use [`clear`](Self::clear) to begin a fresh log.
    pub fn start(&mut self) {
        let now = Instant::now();
        let elapsed = self.duration();
        self.start_time = now.checked_sub(elapsed).or(Some(now));
        self.is_recording = true;
        self.next_sample_due = Some(now);
    }

    /// Stop recording
    pub fn stop(&mut self) {
        self.is_recording = false;
    }

    /// Check if recording is active
    pub fn is_recording(&self) -> bool {
        self.is_recording
    }

    /// Record a sample
    pub fn record(&mut self, values: Vec<f64>) {
        if !self.is_recording {
            return;
        }

        let now = Instant::now();

        // Check sample rate
        let min_interval = Duration::from_secs_f64(1.0 / self.sample_rate);
        let sample_instant = if let Some(due) = self.next_sample_due {
            if now < due {
                return;
            }
            due
        } else {
            now
        };

        let timestamp = self
            .start_time
            .map(|start| sample_instant.duration_since(start))
            .unwrap_or_default();

        let entry = LogEntry::new(timestamp, values);

        // Manage buffer size. Discarding the oldest entry means the saved log
        // will be missing its start; count it (and warn the first time) so the
        // loss is visible rather than silent (D7).
        if self.buffer.len() >= self.max_buffer_size {
            self.buffer.pop_front();
            if self.discarded == 0 {
                tracing::warn!(
                    "Data log hit the {}-sample memory ceiling; oldest samples are now \
                     being discarded. Save more often, or lower the sample rate, to keep \
                     the whole session.",
                    self.max_buffer_size
                );
            }
            self.discarded += 1;
        }

        self.buffer.push_back(entry);

        // Keep a fixed cadence anchored to the schedule rather than "now", so
        // occasional stream jitter does not accumulate timeline drift.
        let mut next_due = sample_instant + min_interval;
        while next_due <= now {
            next_due += min_interval;
        }
        self.next_sample_due = Some(next_due);
    }

    /// Number of oldest samples discarded because the buffer hit its memory
    /// ceiling. Nonzero means the log no longer covers the whole session.
    pub fn discarded_count(&self) -> u64 {
        self.discarded
    }

    /// Get the number of recorded entries
    pub fn entry_count(&self) -> usize {
        self.buffer.len()
    }

    /// Get all entries
    pub fn entries(&self) -> impl Iterator<Item = &LogEntry> {
        self.buffer.iter()
    }

    /// Get the channel names
    pub fn channels(&self) -> &[String] {
        &self.channels
    }

    /// Clear all recorded data
    pub fn clear(&mut self) {
        self.buffer.clear();
        self.start_time = None;
        self.next_sample_due = None;
        self.discarded = 0;
    }

    /// Get the duration of the log
    pub fn duration(&self) -> Duration {
        self.buffer.back().map(|e| e.timestamp).unwrap_or_default()
    }
}

impl Default for DataLogger {
    fn default() -> Self {
        Self::new(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_logger_basic() {
        let mut logger = DataLogger::new(vec!["rpm".into(), "map".into()]);

        assert!(!logger.is_recording());

        logger.start();
        assert!(logger.is_recording());

        logger.record(vec![1000.0, 100.0]);
        assert_eq!(logger.entry_count(), 1);

        logger.stop();
        assert!(!logger.is_recording());
    }

    #[test]
    fn test_restart_appends_with_continuous_timeline() {
        let mut logger = DataLogger::new(vec!["rpm".into()]);
        logger.set_sample_rate(200.0);

        logger.start();
        logger.record(vec![1000.0]);
        logger.stop();
        assert_eq!(logger.entry_count(), 1);
        let first_ts = logger.duration();

        // Restarting must keep the previous entries and continue the timeline
        logger.start();
        std::thread::sleep(Duration::from_millis(10));
        logger.record(vec![2000.0]);
        assert_eq!(logger.entry_count(), 2);
        assert!(logger.duration() >= first_ts);

        // Only clear() wipes the log
        logger.clear();
        assert_eq!(logger.entry_count(), 0);
        logger.start();
        logger.record(vec![3000.0]);
        assert_eq!(logger.entry_count(), 1);
    }

    #[test]
    fn discards_oldest_past_ceiling_and_counts_them() {
        let mut logger = DataLogger::new(vec!["rpm".into()]);
        logger.set_max_buffer_size(3);
        logger.set_sample_rate(200.0); // 5 ms min interval
        logger.start();

        // Push 5 samples spaced past the rate-limit interval so each is kept.
        for i in 0..5 {
            logger.record(vec![i as f64]);
            std::thread::sleep(Duration::from_millis(7));
        }

        // Buffer holds only the last 3; the 2 oldest were discarded and counted.
        assert_eq!(logger.entry_count(), 3);
        assert_eq!(logger.discarded_count(), 2);

        // clear() resets the discard counter for a fresh session.
        logger.clear();
        assert_eq!(logger.discarded_count(), 0);
    }
}
