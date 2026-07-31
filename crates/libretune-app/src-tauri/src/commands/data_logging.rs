//! Data logging Tauri commands.

use libretune_core::datalog::DataLogger;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

use crate::state::AppState;

#[derive(Serialize)]
pub struct LoggingStatus {
    is_recording: bool,
    entry_count: usize,
    duration_ms: u64,
    channel_count: usize,
}

#[derive(Serialize)]
pub struct LogEntryData {
    timestamp_ms: u64,
    values: HashMap<String, f64>,
}

#[tauri::command]
pub async fn start_logging(
    state: tauri::State<'_, AppState>,
    sample_rate: Option<f64>,
    channels: Option<Vec<String>>,
) -> Result<(), String> {
    let channels = {
        let def_guard = state.definition.lock().await;
        let def = def_guard.as_ref().ok_or("Definition not loaded")?;

        let mut available_channels: Vec<String> = def.output_channels.keys().cloned().collect();
        let mut probe: HashMap<String, f64> = available_channels
            .iter()
            .map(|c| (c.clone(), 0.0))
            .collect();
        super::realtime_stream::apply_channel_aliases(&mut probe);
        for name in probe.keys() {
            if !available_channels.iter().any(|c| c == name) {
                available_channels.push(name.clone());
            }
        }
        let available_set: HashSet<&str> = available_channels.iter().map(|s| s.as_str()).collect();

        if let Some(requested) = channels {
            let mut out = Vec::new();
            let mut seen_groups = HashSet::new();
            for name in requested {
                push_unique_log_channel(&mut out, &mut seen_groups, &name, &available_set);
            }
            if out.is_empty() {
                default_log_channels(&available_set)
            } else {
                out
            }
        } else {
            default_log_channels(&available_set)
        }
    };

    let mut logger = state.data_logger.lock().await;

    let mut existing: Vec<&String> = logger.channels().iter().collect();
    let mut incoming: Vec<&String> = channels.iter().collect();
    existing.sort();
    incoming.sort();
    if existing != incoming {
        *logger = DataLogger::new(channels);
    }

    if let Some(rate) = sample_rate {
        logger.set_sample_rate(rate);
    }
    logger.start();

    Ok(())
}

fn push_unique_log_channel(
    out: &mut Vec<String>,
    seen_groups: &mut HashSet<String>,
    preferred: &str,
    available: &HashSet<&str>,
) {
    let key = super::realtime_stream::channel_canonical_key(preferred).to_string();
    if !seen_groups.insert(key) {
        return;
    }
    if let Some(name) = super::realtime_stream::resolve_log_channel_name(preferred, available) {
        out.push(name);
    }
}

fn default_log_channels(available: &HashSet<&str>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen_groups = HashSet::new();
    for name in PRIORITY_CHANNELS {
        push_unique_log_channel(&mut out, &mut seen_groups, name, available);
    }
    if out.is_empty() {
        available.iter().take(16).map(|s| (*s).to_string()).collect()
    } else {
        out
    }
}

/// Default datalog channels for rusEFI / Epic family ECUs.
///
/// Use canonical alias names where possible (`rpm`, `map`, `tps`, …). Members of the
/// same alias group are deduplicated so CSVs do not contain identical columns like
/// `rpm` + `RPMValue` or `dutyCycle` + `injectorDutyCycle`.
const PRIORITY_CHANNELS: &[&str] = &[
    // Core engine
    "rpm",
    "instantRpm",
    "map",
    "instantMAPValue",
    "tps",
    "throttlePedalPosition",
    "DriverThrottleIntent",
    "coolant",
    "iat",
    "battery",
    // Spark
    "advance",
    "runningAdvance",
    "rpmForIgnitionIdleTableDot",
    // Fuel
    "actualLastInjection",
    "dutyCycle",
    "injectionOffset",
    "correction",
    "targetLambda",
    "RealLambdaValue1",
    "stftCorrection1",
    "sync",
    "baro",
    "isCranking",
    "crankingFuel_fuel",
    "running_fuel",
    "running_baseFuel",
    "running_postCrankingFuelCorrection",
    "revolutionCounterSinceStart",
    "fuelFlowRate",
    "injectorState1",
    "coilState1",
    "ve",
    "fuelingLoad",
    "veTableYAxis",
    "firmwareVersion",
    // AE / cuts / idle / ETB diagnostics
    "fuelCutReason",
    "sparkCutReason",
    "isAboveAccelThreshold",
    "deltaTps",
    "smoothedDeltaTps",
    "tpsAccelFuel",
    "belowEpsilon",
    "dfcoActive",
    "totalFuelCut",
    "totalSparkCut",
    "isIdling",
    "idleTarget",
    "idleTargetError",
    "etb1etbCurrentTarget",
    "etb1targetWithIdlePosition",
];

#[tauri::command]
pub async fn stop_logging(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut logger = state.data_logger.lock().await;
    logger.stop();
    Ok(())
}

#[tauri::command]
pub async fn get_logging_status(
    state: tauri::State<'_, AppState>,
) -> Result<LoggingStatus, String> {
    let logger = state.data_logger.lock().await;
    Ok(LoggingStatus {
        is_recording: logger.is_recording(),
        entry_count: logger.entry_count(),
        duration_ms: logger.duration().as_millis() as u64,
        channel_count: logger.channels().len(),
    })
}

#[tauri::command]
pub async fn get_log_entries(
    state: tauri::State<'_, AppState>,
    start_index: Option<usize>,
    count: Option<usize>,
    channels: Option<Vec<String>>,
) -> Result<Vec<LogEntryData>, String> {
    let logger = state.data_logger.lock().await;
    let all_channels = logger.channels();
    let selected: Vec<(usize, &String)> = match &channels {
        Some(filter) => {
            let wanted: std::collections::HashSet<&str> =
                filter.iter().map(|s| s.as_str()).collect();
            all_channels
                .iter()
                .enumerate()
                .filter(|(_, name)| wanted.contains(name.as_str()))
                .collect()
        }
        None => all_channels.iter().enumerate().collect(),
    };

    let start = start_index.unwrap_or(0);
    let max_count = count.unwrap_or(1000);

    let entries: Vec<LogEntryData> = logger
        .entries()
        .skip(start)
        .take(max_count)
        .map(|entry| {
            let mut values = HashMap::with_capacity(selected.len());
            for (i, channel) in &selected {
                if let Some(&val) = entry.values.get(*i) {
                    values.insert((*channel).clone(), val);
                }
            }
            LogEntryData {
                timestamp_ms: entry.timestamp.as_millis() as u64,
                values,
            }
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn clear_log(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut logger = state.data_logger.lock().await;
    logger.clear();
    Ok(())
}

#[tauri::command]
pub async fn save_log(state: tauri::State<'_, AppState>, path: String) -> Result<(), String> {
    let logger = state.data_logger.lock().await;
    let channels = logger.channels();
    let mut has_data = vec![false; channels.len()];
    for entry in logger.entries() {
        for (i, &val) in entry.values.iter().enumerate() {
            if val != 0.0 {
                has_data[i] = true;
            }
        }
    }

    let mut csv = String::new();
    csv.push_str("Time (ms)");
    for (i, channel) in channels.iter().enumerate() {
        if has_data[i] {
            csv.push(',');
            csv.push_str(channel);
        }
    }
    csv.push('\n');

    for entry in logger.entries() {
        csv.push_str(&format!("{}", entry.timestamp.as_millis()));
        for (i, val) in entry.values.iter().enumerate() {
            if has_data[i] {
                csv.push(',');
                csv.push_str(&format!("{:.4}", val));
            }
        }
        csv.push('\n');
    }

    std::fs::write(&path, csv).map_err(|e| format!("Failed to save log: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write file: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::realtime_stream::{channel_canonical_key, resolve_log_channel_name};

    #[test]
    fn canonical_key_groups_rusefi_duplicates() {
        assert_eq!(channel_canonical_key("RPMValue"), "rpm");
        assert_eq!(channel_canonical_key("rpm"), "rpm");
        assert_eq!(channel_canonical_key("injectorDutyCycle"), "dutyCycle");
        assert_eq!(channel_canonical_key("fuelCutReason"), "fuelCutReason");
    }

    #[test]
    fn default_log_channels_deduplicate_alias_groups() {
        let available: HashSet<&str> = [
            "rpm",
            "RPMValue",
            "map",
            "MAPValue",
            "tps",
            "TPSValue",
            "battery",
            "VBatt",
            "dutyCycle",
            "injectorDutyCycle",
            "fuelCutReason",
        ]
        .into_iter()
        .collect();

        let channels = default_log_channels(&available);
        assert!(channels.contains(&"rpm".to_string()));
        assert!(!channels.contains(&"RPMValue".to_string()));
        assert!(channels.contains(&"map".to_string()));
        assert!(!channels.contains(&"MAPValue".to_string()));
        assert!(channels.contains(&"fuelCutReason".to_string()));
    }

    #[test]
    fn resolve_prefers_preferred_then_canonical() {
        let available: HashSet<&str> = ["RPMValue", "MAPValue"].into_iter().collect();
        assert_eq!(
            resolve_log_channel_name("rpm", &available),
            Some("RPMValue".to_string())
        );
        assert_eq!(
            resolve_log_channel_name("RPMValue", &available),
            Some("RPMValue".to_string())
        );
    }
}
