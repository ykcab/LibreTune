//! sync_ecu_data command (extracted from lib.rs).

use crate::state::TuneMismatchSnapshot;
use crate::{set_conn_lock_holder, AppState, SyncProgress, SyncResult};
use libretune_core::ini::{Constant, DataType, Endianness};
use libretune_core::tune::TuneFile;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use tauri::Emitter;

async fn snapshot_baseline_pages(state: &AppState) -> HashMap<u8, Vec<u8>> {
    let cache_guard = state.tune_cache.lock().await;
    if let Some(cache) = cache_guard.as_ref() {
        let mut snapshot = HashMap::new();
        for page in 0..cache.page_count() {
            if let Some(data) = cache.get_page(page) {
                snapshot.insert(page, data.to_vec());
            }
        }
        return snapshot;
    }
    HashMap::new()
}

/// Compare only non-empty pages that were successfully read from the ECU.
fn pages_with_differences(
    baseline: &HashMap<u8, Vec<u8>>,
    ecu: &HashMap<u8, Vec<u8>>,
    n_pages: u8,
    page_sizes: &[u32],
) -> Vec<u8> {
    let mut diff_pages = Vec::new();
    for page_num in 0..n_pages {
        let page_size = page_sizes.get(page_num as usize).copied().unwrap_or(0);
        if page_size == 0 {
            continue;
        }
        match (baseline.get(&page_num), ecu.get(&page_num)) {
            (Some(b), Some(e)) if b != e => diff_pages.push(page_num),
            (None, Some(_)) => diff_pages.push(page_num),
            // Missing ECU page (read failure) is not treated as a diff.
            _ => {}
        }
    }
    diff_pages
}

async fn restore_baseline_pages(state: &AppState, baseline: &HashMap<u8, Vec<u8>>) {
    {
        let mut cache_guard = state.tune_cache.lock().await;
        if let Some(cache) = cache_guard.as_mut() {
            for (page_num, data) in baseline {
                cache.load_page(*page_num, data.clone());
            }
        }
    }

    let signature = {
        let def_guard = state.definition.lock().await;
        def_guard
            .as_ref()
            .map(|d| d.signature.clone())
            .unwrap_or_default()
    };

    if !signature.is_empty() {
        let mut tune = TuneFile::new(&signature);
        for (page_num, data) in baseline {
            tune.pages.insert(*page_num, data.clone());
        }
        let mut tune_guard = state.current_tune.lock().await;
        *tune_guard = Some(tune);
    }
}

#[derive(Serialize)]
pub struct TuneMismatchByteDiff {
    pub offset: u32,
    pub project_value: u8,
    pub ecu_value: u8,
}

#[derive(Serialize)]
pub struct TuneMismatchPageDiff {
    pub page: u8,
    pub page_size: u32,
    pub total_differences: u32,
    pub returned_differences: u32,
    pub differences: Vec<TuneMismatchByteDiff>,
}

#[derive(Serialize)]
pub struct TuneMismatchReadableEntry {
    pub name: String,
    pub label: String,
    pub kind: String,
    pub context: Option<String>,
    pub project_value: String,
    pub ecu_value: String,
    pub units: String,
    pub changed_bytes: u32,
}

#[derive(Serialize)]
pub struct TuneMismatchReadablePageDiff {
    pub page: u8,
    pub total_entries: u32,
    pub returned_entries: u32,
    pub entries: Vec<TuneMismatchReadableEntry>,
}

fn constant_size_for_diff(constant: &Constant) -> usize {
    match constant.data_type {
        DataType::Bits => 1,
        DataType::String => constant.shape.element_count(),
        _ => constant.size_bytes(),
    }
}

fn read_const_byte(data: Option<&Vec<u8>>, idx: usize) -> u8 {
    data.and_then(|v| v.get(idx)).copied().unwrap_or(0)
}

fn count_changed_bytes(
    project: Option<&Vec<u8>>,
    ecu: Option<&Vec<u8>>,
    offset: usize,
    length: usize,
) -> u32 {
    let mut changed = 0u32;
    for i in 0..length {
        if read_const_byte(project, offset + i) != read_const_byte(ecu, offset + i) {
            changed += 1;
        }
    }
    changed
}

fn format_numeric(value: f64, digits: u8) -> String {
    let d = usize::from(digits.min(6));
    if d == 0 {
        format!("{:.0}", value)
    } else {
        format!("{:.*}", d, value)
    }
}

fn decode_string_value(data: Option<&Vec<u8>>, offset: usize, length: usize) -> String {
    let mut bytes = Vec::with_capacity(length);
    for i in 0..length {
        bytes.push(read_const_byte(data, offset + i));
    }
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    let s = String::from_utf8_lossy(&bytes[..end]).trim().to_string();
    if s.is_empty() { "(empty)".to_string() } else { s }
}

fn decode_bits_value(data: Option<&Vec<u8>>, offset: usize, constant: &Constant) -> String {
    let raw = read_const_byte(data, offset);
    let bit_pos = usize::from(constant.bit_position.unwrap_or(0).min(7));
    let bit_spec = constant.bit_size.unwrap_or(constant.bit_position.unwrap_or(0));
    let bit_hi = usize::from(bit_spec.min(7));
    let width = if bit_hi >= bit_pos {
        (bit_hi - bit_pos + 1).min(8)
    } else {
        1
    };
    let mask = if width >= 8 {
        0xFFu16
    } else {
        ((1u16 << width) - 1) << bit_pos
    };
    let mut value = (((raw as u16) & mask) >> bit_pos) as i32;
    value += i32::from(constant.display_offset);
    if !constant.bit_options.is_empty() && value >= 0 {
        if let Some(option) = constant.bit_options.get(value as usize) {
            return format!("{} ({})", option, value);
        }
    }
    value.to_string()
}

fn decode_scalar_value(
    data: Option<&Vec<u8>>,
    offset: usize,
    constant: &Constant,
    default_endian: Endianness,
) -> String {
    let endian = constant.endianness_override.unwrap_or(default_endian);
    let mut bytes = Vec::with_capacity(constant.data_type.size_bytes());
    for i in 0..constant.data_type.size_bytes() {
        bytes.push(read_const_byte(data, offset + i));
    }
    match constant.data_type.read_from_bytes(&bytes, 0, endian) {
        Some(raw) => format_numeric(constant.raw_to_display(raw), constant.digits),
        None => "?".to_string(),
    }
}

#[tauri::command]
pub async fn sync_ecu_data(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SyncResult, String> {
    // Get definition to know page sizes
    let def_guard = state.definition.lock().await;
    let def = def_guard.as_ref().ok_or("Definition not loaded")?;

    let signature = def.signature.clone();
    let n_pages = def.n_pages;
    let page_sizes: Vec<u32> = def.protocol.page_sizes.clone();
    let total_bytes: usize = page_sizes.iter().map(|&s| s as usize).sum();
    drop(def_guard);

    let was_modified = *state.tune_modified.lock().await;

    // Compare against the in-memory tune cache (authoritative editing state),
    // not the raw TuneFile which may have empty pages for MSQ-based projects.
    let baseline_pages = snapshot_baseline_pages(state.inner()).await;

    // Create new tune file
    let mut tune = TuneFile::new(&signature);
    let mut bytes_read: usize = 0;
    let mut pages_synced: u8 = 0;
    let mut pages_failed: u8 = 0;
    let mut errors: Vec<String> = Vec::new();

    for page in 0..n_pages {
        let page_size = page_sizes.get(page as usize).copied().unwrap_or(0);

        // Emit progress
        let progress = SyncProgress {
            current_page: page,
            total_pages: n_pages,
            bytes_read,
            total_bytes,
            complete: false,
            failed_page: None,
        };
        let _ = app.emit("sync:progress", &progress);

        if page_size == 0 {
            pages_synced += 1;
            tune.pages.insert(page, vec![]);
            {
                let mut cache_guard = state.tune_cache.lock().await;
                if let Some(cache) = cache_guard.as_mut() {
                    cache.load_page(page, vec![]);
                }
            }
            continue;
        }

        // Read page data - wrapped in error handling for resilience
        let page_num = page;
        set_conn_lock_holder("sync_ecu_data");
        let mut conn_guard = state.connection.lock().await;
        let conn = match conn_guard.as_mut() {
            Some(c) => c,
            None => {
                set_conn_lock_holder("(none)");
                errors.push(format!("Page {}: Not connected", page_num));
                pages_failed += 1;
                continue;
            }
        };

        // Try to read page - continue on failure
        match conn.read_page(page_num) {
            Ok(page_data) => {
                bytes_read += page_data.len();
                pages_synced += 1;

                // Store in TuneFile
                tune.pages.insert(page_num, page_data.clone());

                // Also populate TuneCache
                {
                    let mut cache_guard = state.tune_cache.lock().await;
                    if let Some(cache) = cache_guard.as_mut() {
                        cache.load_page(page_num, page_data);
                    }
                }
            }
            Err(e) => {
                let error_msg = format!("Page {}: {}", page_num, e);
                eprintln!("[WARN] sync_ecu_data: {}", error_msg);
                errors.push(error_msg);
                pages_failed += 1;

                // Emit progress with failed page indicator
                let progress = SyncProgress {
                    current_page: page,
                    total_pages: n_pages,
                    bytes_read,
                    total_bytes,
                    complete: false,
                    failed_page: Some(page_num),
                };
                let _ = app.emit("sync:progress", &progress);
            }
        }

        drop(conn_guard);
        set_conn_lock_holder("(none)");
    }

    // Store tune file in state (even if partial)
    let ecu_tune = tune.clone();
    {
        let mut tune_guard = state.current_tune.lock().await;
        *tune_guard = Some(tune);
    }

    // Emit complete
    let progress = SyncProgress {
        current_page: n_pages,
        total_pages: n_pages,
        bytes_read,
        total_bytes,
        complete: true,
        failed_page: None,
    };
    let _ = app.emit("sync:progress", &progress);

    // Compare baseline (pre-sync cache) with ECU read.
    // This must detect external ECU edits (e.g., made in another tool) even when
    // LibreTune itself has no local pending changes.
    let diff_pages = pages_with_differences(&baseline_pages, &ecu_tune.pages, n_pages, &page_sizes);
    let should_emit_mismatch = pages_failed == 0 && !diff_pages.is_empty();

    if should_emit_mismatch {
        let baseline_page_nums: Vec<u8> = baseline_pages.keys().copied().collect();
        let ecu_page_nums: Vec<u8> = ecu_tune.pages.keys().copied().collect();
        {
            let mut snapshot_guard = state.tune_mismatch_snapshot.lock().await;
            *snapshot_guard = Some(TuneMismatchSnapshot {
                project_pages: baseline_pages.clone(),
                ecu_pages: ecu_tune.pages.clone(),
                diff_pages: diff_pages.clone(),
            });
        }
        let _ = app.emit(
            "tune:mismatch",
            &serde_json::json!({
                "ecu_pages": ecu_page_nums,
                "project_pages": baseline_page_nums,
                "diff_pages": diff_pages,
            }),
        );
    } else if pages_failed > 0 && !was_modified {
        // Partial read with no local edits — restore pre-sync cache instead of leaving drift.
        restore_baseline_pages(state.inner(), &baseline_pages).await;
        *state.tune_mismatch_snapshot.lock().await = None;
    } else if pages_failed == 0 {
        *state.tune_modified.lock().await = false;
        *state.tune_mismatch_snapshot.lock().await = None;
    }

    // Log detailed errors for debugging
    if !errors.is_empty() {
        eprintln!(
            "[WARN] sync_ecu_data completed with {} errors:",
            errors.len()
        );
        for err in &errors {
            eprintln!("  - {}", err);
        }
    }

    Ok(SyncResult {
        success: pages_failed == 0,
        pages_synced,
        pages_failed,
        total_pages: n_pages,
        errors,
    })
}

#[tauri::command]
pub async fn get_tune_mismatch_page_diff(
    state: tauri::State<'_, AppState>,
    page: u8,
    start_offset: Option<u32>,
    max_rows: Option<u32>,
) -> Result<TuneMismatchPageDiff, String> {
    let snapshot_guard = state.tune_mismatch_snapshot.lock().await;
    let snapshot = snapshot_guard
        .as_ref()
        .ok_or("No tune mismatch snapshot available. Re-sync ECU first.")?;

    if !snapshot.diff_pages.contains(&page) {
        return Err(format!("Page {} is not marked as mismatched", page));
    }

    let project = snapshot.project_pages.get(&page);
    let ecu = snapshot.ecu_pages.get(&page);
    let page_size = std::cmp::max(
        project.map(|v| v.len()).unwrap_or(0),
        ecu.map(|v| v.len()).unwrap_or(0),
    ) as u32;

    if page_size == 0 {
        return Ok(TuneMismatchPageDiff {
            page,
            page_size: 0,
            total_differences: 0,
            returned_differences: 0,
            differences: Vec::new(),
        });
    }

    let start = start_offset.unwrap_or(0) as usize;
    let limit = max_rows.unwrap_or(400) as usize;
    let mut seen = 0usize;
    let mut out = Vec::with_capacity(limit);

    for idx in 0..page_size as usize {
        let p = project.and_then(|v| v.get(idx)).copied().unwrap_or(0);
        let e = ecu.and_then(|v| v.get(idx)).copied().unwrap_or(0);
        if p != e {
            if seen >= start && out.len() < limit {
                out.push(TuneMismatchByteDiff {
                    offset: idx as u32,
                    project_value: p,
                    ecu_value: e,
                });
            }
            seen += 1;
        }
    }

    Ok(TuneMismatchPageDiff {
        page,
        page_size,
        total_differences: seen as u32,
        returned_differences: out.len() as u32,
        differences: out,
    })
}

#[tauri::command]
pub async fn get_tune_mismatch_page_readable_diff(
    state: tauri::State<'_, AppState>,
    page: u8,
    start_index: Option<u32>,
    max_rows: Option<u32>,
) -> Result<TuneMismatchReadablePageDiff, String> {
    let snapshot_guard = state.tune_mismatch_snapshot.lock().await;
    let snapshot = snapshot_guard
        .as_ref()
        .ok_or("No tune mismatch snapshot available. Re-sync ECU first.")?;
    if !snapshot.diff_pages.contains(&page) {
        return Err(format!("Page {} is not marked as mismatched", page));
    }

    let def_guard = state.definition.lock().await;
    let def = def_guard.as_ref().ok_or("Definition not loaded")?;
    let default_endian = def.endianness;

    let mut table_context_by_constant: BTreeMap<String, String> = BTreeMap::new();
    for table in def.tables.values() {
        table_context_by_constant
            .entry(table.map.clone())
            .or_insert_with(|| format!("Table: {}", table.title));
    }

    let project_page = snapshot.project_pages.get(&page);
    let ecu_page = snapshot.ecu_pages.get(&page);
    let start = start_index.unwrap_or(0) as usize;
    let limit = max_rows.unwrap_or(300) as usize;

    let mut entries = Vec::new();
    for constant in def.constants.values() {
        if constant.is_pc_variable || constant.page != page {
            continue;
        }
        let size = constant_size_for_diff(constant);
        if size == 0 {
            continue;
        }
        let offset = usize::from(constant.offset);
        let changed_bytes = count_changed_bytes(project_page, ecu_page, offset, size);
        if changed_bytes == 0 {
            continue;
        }

        let kind = if constant.shape.element_count() > 1 {
            if table_context_by_constant.contains_key(&constant.name) {
                "table".to_string()
            } else {
                "array".to_string()
            }
        } else {
            match constant.data_type {
                DataType::String => "string".to_string(),
                DataType::Bits => "bits".to_string(),
                _ => "scalar".to_string(),
            }
        };

        let project_value = if kind == "array" || kind == "table" {
            format!("{} byte(s) changed", changed_bytes)
        } else if constant.data_type == DataType::String {
            decode_string_value(project_page, offset, size)
        } else if constant.data_type == DataType::Bits {
            decode_bits_value(project_page, offset, constant)
        } else {
            decode_scalar_value(project_page, offset, constant, default_endian)
        };

        let ecu_value = if kind == "array" || kind == "table" {
            format!("{} byte(s) changed", changed_bytes)
        } else if constant.data_type == DataType::String {
            decode_string_value(ecu_page, offset, size)
        } else if constant.data_type == DataType::Bits {
            decode_bits_value(ecu_page, offset, constant)
        } else {
            decode_scalar_value(ecu_page, offset, constant, default_endian)
        };

        entries.push(TuneMismatchReadableEntry {
            name: constant.name.clone(),
            label: constant
                .label
                .clone()
                .unwrap_or_else(|| constant.name.clone()),
            kind,
            context: table_context_by_constant.get(&constant.name).cloned(),
            project_value,
            ecu_value,
            units: constant.units.clone(),
            changed_bytes,
        });
    }

    entries.sort_by(|a, b| a.label.cmp(&b.label).then(a.name.cmp(&b.name)));
    let total = entries.len();
    let paged = entries.into_iter().skip(start).take(limit).collect::<Vec<_>>();

    Ok(TuneMismatchReadablePageDiff {
        page,
        total_entries: total as u32,
        returned_entries: paged.len() as u32,
        entries: paged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_with_differences_detects_mismatch() {
        let mut baseline = HashMap::new();
        baseline.insert(0, vec![1, 2, 3]);
        let mut ecu = HashMap::new();
        ecu.insert(0, vec![1, 2, 4]);
        assert_eq!(pages_with_differences(&baseline, &ecu, 2, &[3, 0]), vec![0]);
    }

    #[test]
    fn pages_with_differences_ignores_matching_pages() {
        let mut baseline = HashMap::new();
        baseline.insert(0, vec![1, 2, 3]);
        baseline.insert(1, vec![9, 9]);
        let mut ecu = HashMap::new();
        ecu.insert(0, vec![1, 2, 3]);
        ecu.insert(1, vec![9, 9]);
        assert!(pages_with_differences(&baseline, &ecu, 2, &[3, 2]).is_empty());
    }

    #[test]
    fn pages_with_differences_ignores_failed_ecu_reads() {
        let mut baseline = HashMap::new();
        baseline.insert(0, vec![1, 2, 3]);
        baseline.insert(1, vec![9, 9]);
        let mut ecu = HashMap::new();
        ecu.insert(0, vec![1, 2, 3]);
        assert!(pages_with_differences(&baseline, &ecu, 2, &[3, 2]).is_empty());
    }

    #[test]
    fn pages_with_differences_skips_zero_size_pages() {
        let mut baseline = HashMap::new();
        baseline.insert(0, vec![]);
        baseline.insert(1, vec![1]);
        let mut ecu = HashMap::new();
        ecu.insert(1, vec![2]);
        assert_eq!(pages_with_differences(&baseline, &ecu, 2, &[0, 1]), vec![1]);
    }
}
