//! Data Logging
//!
//! Records and plays back ECU real-time data.

pub mod dyno;
pub mod format;
pub mod ltlog;
pub mod mlg;
mod playback;
mod recorder;
pub mod virtual_dyno;

pub use format::LogFormat;
pub use playback::LogPlayer;
pub use recorder::DataLogger;
pub use virtual_dyno::{
    assess_vss_readiness, compute_virtual_dyno, resolve_speed_channel, tire_diameter_from_specs,
    VirtualDynoProfile, VirtualDynoResult, VirtualDynoSample, VssReadiness,
};

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// A single log entry with timestamp and values
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    /// Timestamp from start of logging
    pub timestamp: Duration,
    /// Channel values (in order of datalog definition)
    pub values: Vec<f64>,
}

impl LogEntry {
    /// Create a new log entry
    pub fn new(timestamp: Duration, values: Vec<f64>) -> Self {
        Self { timestamp, values }
    }
}
