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
            let mut seen = HashSet::new();
            for name in requested {
                if available_set.contains(name.as_str()) && seen.insert(name.clone()) {
                    out.push(name);
                }
            }
            if out.is_empty() {
                default_log_channels(&available_channels)
            } else {
                out
            }
        } else {
            default_log_channels(&available_channels)
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

fn default_log_channels(available: &[String]) -> Vec<String> {
    let available_set: HashSet<&str> = available.iter().map(|s| s.as_str()).collect();
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for name in PRIORITY_CHANNELS {
        if available_set.contains(name) && seen.insert(*name) {
            out.push((*name).to_string());
        }
    }
    if out.is_empty() {
        available.iter().take(16).cloned().collect()
    } else {
        out
    }
}

const PRIORITY_CHANNELS: &[&str] = &[
    "Time",
    "time",
    "RPM",
    "rpm",
    "RPMValue",
    "instantRpm",
    "MAP",
    "map",
    "MAPValue",
    "instantMAPValue",
    "TPS",
    "tps",
    "TPSValue",
    "throttle",
    "throttlePedalPosition",
    "AFR",
    "afr",
    "lambda",
    "lambdaValue",
    "coolant",
    "CLT",
    "iat",
    "IAT",
    "battery",
    "VBatt",
    "advance",
    "spark",
    "injPw",
    "PW",
    "fuelPulseWidth",
    "actualLastInjection",
    "dutyCycle",
    "injectorDutyCycle",
    "injectionOffset",
    "egoCorrection",
    "correction",
    "targetAfr",
    "targetLambda",
    "sync",
    "engineSync",
    "triggerSync",
    "vehicleSpeed",
    "vss",
    "baro",
    "baroPressure",
    "isCranking",
    "crankingFuel_fuel",
    "running_fuel",
    "running_baseFuel",
    "running_postCrankingFuelCorrection",
    "revolutionCounterSinceStart",
    "highFuelPressure",
    "lowFuelPressure",
    "fuelFlowRate",
    "injectorState1",
    "coilState1",
    "currentVe",
    "veValue",
    "firmwareVersion",
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
