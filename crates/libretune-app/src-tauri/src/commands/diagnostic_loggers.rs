//! Diagnostic logger Tauri commands (tooth + composite loggers).

use serde::Serialize;
use tauri::Emitter;

use crate::state::AppState;
use libretune_core::ini::EcuType;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoggerEcuKind {
    Speeduino,
    RusEfiFamily,
    MegaSquirt,
    Unknown,
}

#[derive(Debug, Clone, Copy)]
struct TriggerLogRecord {
    flags: u8,
    time_us: u32,
}

const RUSEFI_TRIGGER_START: [u8; 2] = [b'l', 0x01];
const RUSEFI_TRIGGER_STOP: [u8; 2] = [b'l', 0x02];
const RUSEFI_TRIGGER_READ: [u8; 2] = [b'l', 0x03];

fn detect_logger_ecu_kind(def_type: EcuType, signature: &str) -> LoggerEcuKind {
    match def_type {
        EcuType::Speeduino => return LoggerEcuKind::Speeduino,
        EcuType::RusEFI | EcuType::FOME | EcuType::EpicEFI => return LoggerEcuKind::RusEfiFamily,
        EcuType::MS2 | EcuType::MS3 => return LoggerEcuKind::MegaSquirt,
        EcuType::Unknown => {}
    }

    let sig = signature.to_lowercase();
    if sig.contains("speeduino") {
        LoggerEcuKind::Speeduino
    } else if sig.contains("rusefi")
        || sig.contains("fome")
        || sig.contains("epicefi")
        || sig.contains("epicecu")
    {
        LoggerEcuKind::RusEfiFamily
    } else if sig.contains("ms2")
        || sig.contains("ms3")
        || sig.contains("mega")
        || sig.contains("megasquirt")
    {
        LoggerEcuKind::MegaSquirt
    } else {
        LoggerEcuKind::Unknown
    }
}

fn monotonic_score(samples: &[u32]) -> i64 {
    if samples.len() < 2 {
        return 0;
    }
    let mut score: i64 = 0;
    for pair in samples.windows(2) {
        let prev = pair[0];
        let curr = pair[1];
        if curr > prev {
            score += 2;
            let delta = curr - prev;
            if delta <= 5_000_000 {
                score += 1;
            }
        } else if curr == prev {
            score += 0;
        } else {
            score -= 3;
        }
    }
    score
}

fn decode_trigger_timestamps(raw_times: &[[u8; 4]]) -> Vec<u32> {
    let be: Vec<u32> = raw_times.iter().map(|b| u32::from_be_bytes(*b)).collect();
    let le: Vec<u32> = raw_times.iter().map(|b| u32::from_le_bytes(*b)).collect();
    let be_score = monotonic_score(&be);
    let le_score = monotonic_score(&le);
    if le_score > be_score {
        le
    } else {
        be
    }
}

fn choose_entry_count(be_count: usize, le_count: usize, available: usize) -> usize {
    if available == 0 {
        return 0;
    }
    match (be_count, le_count) {
        (0, 0) => 0,
        (0, le) => le.min(available),
        (be, 0) => be.min(available),
        (be, le) => {
            let be_diff = be.abs_diff(available);
            let le_diff = le.abs_diff(available);
            if le_diff < be_diff {
                le.min(available)
            } else {
                be.min(available)
            }
        }
    }
}

fn parse_rusefi_trigger_records(response: &[u8]) -> Result<Vec<TriggerLogRecord>, String> {
    if response.len() < 2 {
        return Err("Trigger logger returned no data".to_string());
    }

    let be_count = u16::from_be_bytes([response[0], response[1]]) as usize;
    let le_count = u16::from_le_bytes([response[0], response[1]]) as usize;
    let available = (response.len().saturating_sub(2)) / 5;
    let parse_count = choose_entry_count(be_count, le_count, available);
    if parse_count == 0 {
        return Err(format!(
            "Trigger logger response had 0 records (reported be={}, le={}, bytes {})",
            be_count,
            le_count,
            response.len()
        ));
    }

    let mut raw_times = Vec::with_capacity(parse_count);
    let mut flags = Vec::with_capacity(parse_count);
    for i in 0..parse_count {
        let offset = 2 + i * 5;
        flags.push(response[offset]);
        raw_times.push([
            response[offset + 1],
            response[offset + 2],
            response[offset + 3],
            response[offset + 4],
        ]);
    }

    let decoded_times = decode_trigger_timestamps(&raw_times);
    let out: Vec<TriggerLogRecord> = flags
        .into_iter()
        .zip(decoded_times)
        .map(|(flags, time_us)| TriggerLogRecord { flags, time_us })
        .collect();
    Ok(out)
}

fn wait_for_condition<F>(timeout_ms: u64, poll_ms: u64, mut check: F) -> Result<bool, String>
where
    F: FnMut() -> Result<bool, String>,
{
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    while std::time::Instant::now() < deadline {
        if check()? {
            return Ok(true);
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_ms));
    }
    Ok(false)
}

fn read_rusefi_trigger_records<F>(
    mut read_once: F,
    timeout_ms: u64,
) -> Result<Vec<TriggerLogRecord>, String>
where
    F: FnMut() -> Result<Vec<u8>, String>,
{
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    let mut last_err = String::new();

    while std::time::Instant::now() < deadline {
        let response = read_once()?;

        match parse_rusefi_trigger_records(&response) {
            Ok(records) if !records.is_empty() => return Ok(records),
            Ok(_) => {
                last_err = "Trigger logger returned empty record list".to_string();
            }
            Err(e) => {
                last_err = e;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(120));
    }

    Err(format!(
        "Timed out waiting for trigger logger data: {}",
        if last_err.is_empty() {
            "no data received"
        } else {
            &last_err
        }
    ))
}

/// Tooth log entry (single tooth timing)
#[derive(Debug, Clone, Serialize)]
pub struct ToothLogEntry {
    /// Tooth number (0-indexed)
    tooth_number: u16,
    /// Time since last tooth in microseconds
    tooth_time_us: u32,
    /// Crank angle at this tooth (if available)
    crank_angle: Option<f32>,
}

/// Composite log entry (combined tooth + sync)
#[derive(Debug, Clone, Serialize)]
pub struct CompositeLogEntry {
    /// Time in microseconds since start
    time_us: u32,
    /// Primary trigger state (high/low)
    primary: bool,
    /// Secondary trigger state (high/low)  
    secondary: bool,
    /// Sync status
    sync: bool,
    /// Composite voltage (if analog)
    voltage: Option<f32>,
}

/// Tooth logger result
#[derive(Serialize)]
pub struct ToothLogResult {
    /// All captured tooth entries
    teeth: Vec<ToothLogEntry>,
    /// Total capture time in milliseconds
    capture_time_ms: u32,
    /// Detected RPM (if calculable)
    detected_rpm: Option<f32>,
    /// Number of teeth per revolution (if detected)
    teeth_per_rev: Option<u16>,
}

/// Composite logger result  
#[derive(Serialize)]
pub struct CompositeLogResult {
    /// All captured entries
    entries: Vec<CompositeLogEntry>,
    /// Total capture time in milliseconds
    capture_time_ms: u32,
    /// Sample rate in Hz
    sample_rate_hz: u32,
}

/// Start the tooth logger and capture data
///
/// ECU Protocol Commands:
/// - Speeduino: 'H' to get tooth log (blocking), 'T' for timing pattern, 'h' for tooth times
/// - rusEFI: 'l\x01' start tooth logger, 'l\x02' get data, 'l\x03' stop
/// - MS2/MS3: Page 0xf0-0xf1 fetch tooth log data
#[tauri::command]
pub async fn start_tooth_logger(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<ToothLogResult, String> {
    let mut conn_guard = state.connection.lock().await;
    let def_guard = state.definition.lock().await;

    let conn = conn_guard.as_mut().ok_or("Not connected to ECU")?;
    let def = def_guard.as_ref().ok_or("Definition not loaded")?;

    // Detect ECU type from signature
    let signature = conn.signature().unwrap_or_default().to_lowercase();
    let ecu_kind = detect_logger_ecu_kind(def.ecu_type, &signature);

    let teeth: Vec<ToothLogEntry>;

    if ecu_kind == LoggerEcuKind::Speeduino {
        // Speeduino protocol: Send 'H' command for tooth log
        // Response format: 2-byte count (little-endian) + (count * 4-byte entries)
        // Each entry: 2 bytes tooth number (LE) + 2 bytes time in 0.5µs units (LE)
        eprintln!("[Tooth Logger] Starting Speeduino tooth capture...");

        let response = conn
            .send_raw_bytes_with_response(b"H", std::time::Duration::from_millis(2000))
            .map_err(|e| format!("Failed to get tooth log data: {}", e))?;

        if response.len() < 2 {
            return Err("Tooth logger returned no data (ECU may not support this command)".into());
        }

        // Parse 2-byte tooth count
        let tooth_count = u16::from_le_bytes([response[0], response[1]]) as usize;
        eprintln!("[Tooth Logger] ECU reports {} teeth", tooth_count);

        let expected_len = 2 + tooth_count * 4;
        if response.len() < expected_len {
            eprintln!(
                "[Tooth Logger] Warning: expected {} bytes but got {}. Parsing available data.",
                expected_len,
                response.len()
            );
        }

        let available_teeth = (response.len().saturating_sub(2)) / 4;
        let parse_count = available_teeth.min(tooth_count);

        teeth = (0..parse_count)
            .map(|i| {
                let offset = 2 + i * 4;
                let tooth_num = u16::from_le_bytes([response[offset], response[offset + 1]]);
                // Time is in 0.5µs units, convert to µs
                let raw_time = u16::from_le_bytes([response[offset + 2], response[offset + 3]]);
                let tooth_time_us = raw_time as u32 / 2;
                ToothLogEntry {
                    tooth_number: tooth_num,
                    tooth_time_us,
                    crank_angle: None, // Speeduino doesn't provide angle in this response
                }
            })
            .collect();

        eprintln!("[Tooth Logger] Parsed {} teeth from response", teeth.len());
    } else if ecu_kind == LoggerEcuKind::RusEfiFamily {
        // rusEFI/epicEFI/FOME trigger logger definition (from INI):
        // startCommand=l1, stopCommand=l2, dataReadCommand=l3
        // record: 1-byte flags + 4-byte timestamp (µs)
        eprintln!("[Tooth Logger] Starting rusEFI tooth capture...");

        // Start logger
        conn.send_raw_bytes(&RUSEFI_TRIGGER_START)
            .map_err(|e| format!("Failed to start tooth logger: {}", e))?;

        // Wait for INI-defined readiness signal when available; fallback to a
        // short capture window if channel is absent.
        if let Some(ready_ch) = def.output_channels.get("toothLogReady") {
            let _ = wait_for_condition(2200, 80, || {
                let raw = conn
                    .get_realtime_data()
                    .map_err(|e| format!("Failed to poll trigger readiness: {}", e))?;
                Ok(ready_ch.parse(&raw, def.endianness).unwrap_or(0.0) > 0.5)
            })?;
        } else {
            std::thread::sleep(std::time::Duration::from_millis(700));
        }

        // Stop before read so ECU finalizes buffer
        conn.send_raw_bytes(&RUSEFI_TRIGGER_STOP)
            .map_err(|e| format!("Failed to stop tooth logger: {}", e))?;

        let records = read_rusefi_trigger_records(
            || {
                conn.send_raw_bytes_with_response(
                    &RUSEFI_TRIGGER_READ,
                    std::time::Duration::from_millis(1200),
                )
                .map_err(|e| format!("Failed to get tooth data: {}", e))
            },
            3500,
        )?;
        eprintln!("[Tooth Logger] Parsed {} trigger records", records.len());

        // Derive tooth intervals from successive trigger timestamps.
        let mut derived = Vec::new();
        for i in 1..records.len() {
            let prev = records[i - 1].time_us;
            let curr = records[i].time_us;
            let delta = curr.wrapping_sub(prev);
            if delta > 0 && delta < 5_000_000 {
                derived.push(ToothLogEntry {
                    tooth_number: (derived.len() as u16),
                    tooth_time_us: delta,
                    crank_angle: None,
                });
            }
        }
        if derived.is_empty() {
            return Err(format!(
                "Trigger logger returned {} records but no valid tooth intervals",
                records.len()
            ));
        }
        teeth = derived;

        eprintln!("[Tooth Logger] Parsed {} teeth from response", teeth.len());
    } else if ecu_kind == LoggerEcuKind::MegaSquirt {
        // Megasquirt protocol: Read tooth log page
        // MS2/MS3 uses page 0xF0 for tooth log data
        // Response: raw bytes, each 2-byte pair is tooth time in µs (big-endian)
        eprintln!("[Tooth Logger] Starting Megasquirt tooth capture...");

        let response = conn
            .read_page(0xF0)
            .map_err(|e| format!("Failed to read tooth log page: {}", e))?;

        if response.is_empty() {
            return Err("Tooth logger returned no data".into());
        }

        // MS tooth log: each entry is 2 bytes (big-endian), tooth time in µs
        let tooth_count = response.len() / 2;
        teeth = (0..tooth_count)
            .filter_map(|i| {
                let offset = i * 2;
                let raw_time = u16::from_be_bytes([response[offset], response[offset + 1]]);
                // Skip zero entries (unused slots)
                if raw_time == 0 {
                    return None;
                }
                Some(ToothLogEntry {
                    tooth_number: i as u16,
                    tooth_time_us: raw_time as u32,
                    crank_angle: None,
                })
            })
            .collect();

        eprintln!("[Tooth Logger] Parsed {} teeth from response", teeth.len());
    } else {
        // Unknown ECU - return placeholder indicating feature not available
        return Err(format!(
            "Tooth logger not supported for this ECU type (signature: {})",
            signature
        ));
    }

    // Calculate RPM from tooth times (if we have enough data)
    let detected_rpm = if teeth.len() >= 2 {
        let total_time: u32 = teeth.iter().map(|t| t.tooth_time_us).sum();
        let avg_tooth_time_us = total_time as f32 / teeth.len() as f32;
        // Assuming standard trigger wheel (36-1 teeth = 35 actual teeth per rev)
        let teeth_per_rev = if teeth.len() > 30 {
            36
        } else {
            teeth.len() as u16
        };
        let rev_time_us = avg_tooth_time_us * teeth_per_rev as f32;
        let rpm = 60_000_000.0 / rev_time_us;
        Some(rpm)
    } else {
        None
    };

    // Emit event to frontend
    let _ = app.emit("tooth_logger:data", &teeth);

    Ok(ToothLogResult {
        teeth,
        capture_time_ms: 500,
        detected_rpm,
        teeth_per_rev: Some(36),
    })
}

/// Stops the tooth logger capture.
///
/// Sends the appropriate stop command based on ECU type.
///
/// Returns: Nothing on success
#[tauri::command]
pub async fn stop_tooth_logger(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut conn_guard = state.connection.lock().await;
    let def_guard = state.definition.lock().await;

    if let Some(conn) = conn_guard.as_mut() {
        let signature = conn.signature().unwrap_or_default().to_lowercase();
        let def_type = def_guard
            .as_ref()
            .map(|d| d.ecu_type)
            .unwrap_or(EcuType::Unknown);
        let ecu_kind = detect_logger_ecu_kind(def_type, &signature);

        if ecu_kind == LoggerEcuKind::RusEfiFamily {
            // rusEFI: Send stop command
            conn.send_raw_bytes(&RUSEFI_TRIGGER_STOP)
                .map_err(|e| format!("Failed to stop tooth logger: {}", e))?;
        }
        // Speeduino and MS don't need explicit stop
    }

    Ok(())
}

/// Start the composite logger and capture data
#[tauri::command]
pub async fn start_composite_logger(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<CompositeLogResult, String> {
    let mut conn_guard = state.connection.lock().await;
    let def_guard = state.definition.lock().await;

    let conn = conn_guard.as_mut().ok_or("Not connected to ECU")?;
    let def = def_guard.as_ref().ok_or("Definition not loaded")?;

    let signature = conn.signature().unwrap_or_default().to_lowercase();
    let ecu_kind = detect_logger_ecu_kind(def.ecu_type, &signature);

    let entries: Vec<CompositeLogEntry>;

    if ecu_kind == LoggerEcuKind::Speeduino {
        // Speeduino composite logger commands:
        // 'J' = Start composite logger
        // 'O' = Get composite data
        // 'X' = Stop composite logger
        // Response to 'O': Raw bytes, each entry is 1 byte of packed flags:
        //   bit 0: primary trigger state
        //   bit 1: secondary trigger state
        //   bit 2: sync status
        // Entries are captured at ~10kHz (100µs intervals)
        eprintln!("[Composite Logger] Starting Speeduino composite capture...");

        conn.send_raw_bytes(b"J")
            .map_err(|e| format!("Failed to start composite logger: {}", e))?;

        std::thread::sleep(std::time::Duration::from_millis(650));

        let response = conn
            .send_raw_bytes_with_response(b"O", std::time::Duration::from_millis(2000))
            .map_err(|e| format!("Failed to get composite data: {}", e))?;

        if response.is_empty() {
            return Err("Composite logger returned no data".into());
        }

        // Each byte is a packed status entry at ~100µs intervals
        entries = response
            .iter()
            .enumerate()
            .map(|(i, &byte)| CompositeLogEntry {
                time_us: (i as u32) * 100, // 100µs per sample = 10kHz
                primary: (byte & 0x01) != 0,
                secondary: (byte & 0x02) != 0,
                sync: (byte & 0x04) != 0,
                voltage: None,
            })
            .collect();

        // Send stop
        let _ = conn.send_raw_bytes(b"X");

        eprintln!(
            "[Composite Logger] Parsed {} entries from response",
            entries.len()
        );
    } else if ecu_kind == LoggerEcuKind::RusEfiFamily {
        // Use trigger logger records (same source as TS Trigger Logger):
        // start=l1, stop=l2, read=l3
        eprintln!("[Composite Logger] Starting rusEFI composite capture...");

        conn.send_raw_bytes(&RUSEFI_TRIGGER_START)
            .map_err(|e| format!("Failed to start composite logger: {}", e))?;

        if let Some(ready_ch) = def.output_channels.get("toothLogReady") {
            let _ = wait_for_condition(2200, 80, || {
                let raw = conn
                    .get_realtime_data()
                    .map_err(|e| format!("Failed to poll trigger readiness: {}", e))?;
                Ok(ready_ch.parse(&raw, def.endianness).unwrap_or(0.0) > 0.5)
            })?;
        } else {
            std::thread::sleep(std::time::Duration::from_millis(700));
        }

        conn.send_raw_bytes(&RUSEFI_TRIGGER_STOP)
            .map_err(|e| format!("Failed to stop composite logger: {}", e))?;

        let records = read_rusefi_trigger_records(
            || {
                conn.send_raw_bytes_with_response(
                    &RUSEFI_TRIGGER_READ,
                    std::time::Duration::from_millis(1200),
                )
                .map_err(|e| format!("Failed to get composite data: {}", e))
            },
            3500,
        )?;
        let base_time = records.first().map(|r| r.time_us).unwrap_or(0);
        entries = records
            .into_iter()
            .map(|r| CompositeLogEntry {
                time_us: r.time_us.wrapping_sub(base_time),
                primary: (r.flags & 0x01) != 0,
                secondary: (r.flags & 0x02) != 0,
                // INI recordField has sync on bit 3.
                sync: (r.flags & 0x08) != 0,
                voltage: None,
            })
            .collect();

        eprintln!(
            "[Composite Logger] Parsed {} entries from response",
            entries.len()
        );
    } else if ecu_kind == LoggerEcuKind::MegaSquirt {
        // Megasquirt: Page 0xF2 for composite log data
        // Response: raw bytes, each entry is 6 bytes:
        //   4 bytes time_us (BE u32), 1 byte flags, 1 byte voltage (0-255 mapped to 0-5V)
        eprintln!("[Composite Logger] Starting Megasquirt composite capture...");

        let response = conn
            .read_page(0xF2)
            .map_err(|e| format!("Failed to read composite log page: {}", e))?;

        if response.is_empty() {
            return Err("Composite logger returned no data".into());
        }

        let entry_count = response.len() / 6;
        entries = (0..entry_count)
            .filter_map(|i| {
                let offset = i * 6;
                if offset + 5 >= response.len() {
                    return None;
                }
                let time_us = u32::from_be_bytes([
                    response[offset],
                    response[offset + 1],
                    response[offset + 2],
                    response[offset + 3],
                ]);
                // Skip zero-time entries (unused)
                if time_us == 0 {
                    return None;
                }
                let flags = response[offset + 4];
                let raw_voltage = response[offset + 5];
                Some(CompositeLogEntry {
                    time_us,
                    primary: (flags & 0x01) != 0,
                    secondary: (flags & 0x02) != 0,
                    sync: (flags & 0x04) != 0,
                    voltage: Some(raw_voltage as f32 * 5.0 / 255.0),
                })
            })
            .collect();

        eprintln!(
            "[Composite Logger] Parsed {} entries from response",
            entries.len()
        );
    } else {
        return Err(format!(
            "Composite logger not supported for this ECU type (signature: {})",
            signature
        ));
    }

    let _ = app.emit("composite_logger:data", &entries);

    let sample_rate_hz = if entries.len() > 1 {
        let mut deltas = Vec::with_capacity(entries.len() - 1);
        for i in 1..entries.len() {
            let dt = entries[i].time_us.saturating_sub(entries[i - 1].time_us);
            if dt > 0 {
                deltas.push(dt);
            }
        }
        if deltas.is_empty() {
            10_000
        } else {
            let avg = deltas.iter().copied().sum::<u32>() as f32 / deltas.len() as f32;
            (1_000_000.0 / avg).round().clamp(1.0, 200_000.0) as u32
        }
    } else {
        10_000
    };

    Ok(CompositeLogResult {
        entries,
        capture_time_ms: 500,
        sample_rate_hz,
    })
}

/// Stops the composite logger capture.
///
/// Sends the appropriate stop command based on ECU type.
///
/// Returns: Nothing on success
#[tauri::command]
pub async fn stop_composite_logger(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut conn_guard = state.connection.lock().await;
    let def_guard = state.definition.lock().await;

    if let Some(conn) = conn_guard.as_mut() {
        let signature = conn.signature().unwrap_or_default().to_lowercase();
        let def_type = def_guard
            .as_ref()
            .map(|d| d.ecu_type)
            .unwrap_or(EcuType::Unknown);
        let ecu_kind = detect_logger_ecu_kind(def_type, &signature);

        if ecu_kind == LoggerEcuKind::RusEfiFamily {
            conn.send_raw_bytes(&RUSEFI_TRIGGER_STOP)
                .map_err(|e| format!("Failed to stop composite logger: {}", e))?;
        }
    }

    Ok(())
}
