//! start_autotune command and read_axis_bins helper (extracted from lib.rs).

use crate::get_table_data_internal;
use crate::read_raw_value;
use crate::state::{is_maf_channel_name, AppState, AutoTuneConfig, AutoTuneLoadSource, AxisHint};
use libretune_core::autotune::{AutoTuneAuthorityLimits, AutoTuneFilters, AutoTuneSettings};
use libretune_core::ini::EcuDefinition;
use libretune_core::tune::TuneCache;
use serde::Serialize;

/// Result returned when an AutoTune session starts.
#[derive(Debug, Clone, Serialize)]
pub struct AutoTuneStartResult {
    /// Non-fatal issues the UI should surface (missing AFR, no VeAnalyze, etc.)
    pub warnings: Vec<String>,
    /// True when an AFR/lambda target table was loaded from the INI
    pub using_target_table: bool,
    /// Channel hint used for live AFR/lambda (if known)
    pub afr_channel_hint: Option<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_autotune(
    state: tauri::State<'_, AppState>,
    table_name: String,
    secondary_table_name: Option<String>,
    load_source: Option<AutoTuneLoadSource>,
    settings: AutoTuneSettings,
    filters: AutoTuneFilters,
    authority_limits: AutoTuneAuthorityLimits,
) -> Result<AutoTuneStartResult, String> {
    let mut warnings = Vec::new();

    // Get the table definition to extract bin values
    let def_guard = state.definition.lock().await;
    let def = def_guard.as_ref().ok_or("No ECU definition loaded")?;
    let cache_guard = state.tune_cache.lock().await;
    let cache = cache_guard.as_ref();

    let mut resolved_load_source = load_source.unwrap_or(AutoTuneLoadSource::Map);
    let ve_analyze = def.ve_analyze.clone();
    let afr_channel_hint = ve_analyze
        .as_ref()
        .map(|v| v.lambda_channel.clone())
        .filter(|s| !s.is_empty());
    let target_table_name = ve_analyze.as_ref().and_then(|v| {
        if !v.target_table_name.is_empty() {
            Some(v.target_table_name.clone())
        } else {
            v.lambda_target_tables
                .iter()
                .find(|n| !n.is_empty())
                .cloned()
        }
    });

    if ve_analyze.is_none() {
        warnings.push(
            "This ECU definition has no [VeAnalyze] section — using table-name heuristics and the Target AFR setting."
                .into(),
        );
    }

    // Find the table and extract bins
    let (x_bins, y_bins) = if let Some(table) = def.get_table_by_name_or_map(&table_name) {
        let y_output_channel = table.y_output_channel.clone();
        if resolved_load_source == AutoTuneLoadSource::Map {
            if let Some(ref channel) = y_output_channel {
                if is_maf_channel_name(channel) {
                    resolved_load_source = AutoTuneLoadSource::Maf;
                }
            }
        }

        // Read X bins from the constant
        let x_bins = read_axis_bins(def, cache, &table.x_bins, table.x_size, AxisHint::Rpm)?;

        // Read Y bins from the constant (if it's a 3D table)
        let y_bins = if let Some(ref y_bins_name) = table.y_bins {
            read_axis_bins(
                def,
                cache,
                y_bins_name,
                table.y_size,
                AxisHint::Load(resolved_load_source),
            )?
        } else {
            vec![0.0] // 2D table has single Y bin
        };

        (x_bins, y_bins)
    } else {
        // Use default bins if table not found
        let default_y_bins = match resolved_load_source {
            AutoTuneLoadSource::Maf => {
                vec![0.0, 25.0, 50.0, 75.0, 100.0, 150.0, 200.0, 250.0, 300.0]
            }
            AutoTuneLoadSource::Map => vec![20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0],
        };

        (
            vec![
                500.0, 1000.0, 1500.0, 2000.0, 2500.0, 3000.0, 3500.0, 4000.0, 4500.0, 5000.0,
                5500.0, 6000.0,
            ],
            default_y_bins,
        )
    };

    if resolved_load_source == AutoTuneLoadSource::Maf {
        let has_maf_channel = def
            .output_channels
            .keys()
            .any(|name| is_maf_channel_name(name));
        if !has_maf_channel {
            resolved_load_source = AutoTuneLoadSource::Map;
        }
    }

    let (secondary_x_bins, secondary_y_bins) = if let Some(ref secondary_name) =
        secondary_table_name
    {
        if let Some(table) = def.get_table_by_name_or_map(secondary_name) {
            let x_bins = read_axis_bins(def, cache, &table.x_bins, table.x_size, AxisHint::Rpm)?;
            let y_bins = if let Some(ref y_bins_name) = table.y_bins {
                read_axis_bins(
                    def,
                    cache,
                    y_bins_name,
                    table.y_size,
                    AxisHint::Load(resolved_load_source),
                )?
            } else {
                vec![0.0]
            };

            (Some(x_bins), Some(y_bins))
        } else {
            return Err(format!("Secondary table {} not found", secondary_name));
        }
    } else {
        (None, None)
    };

    drop(cache_guard);
    drop(def_guard);

    // Snapshot VE table cells (preferred beginning_value source)
    let ve_table_values = match get_table_data_internal(&state, &table_name).await {
        Ok(td) => Some(td.z_values),
        Err(e) => {
            warnings.push(format!(
                "Could not snapshot VE table '{table_name}' ({e}); live VE channel will be used if present."
            ));
            None
        }
    };

    let secondary_ve_values = if let Some(ref secondary_name) = secondary_table_name {
        match get_table_data_internal(&state, secondary_name).await {
            Ok(td) => Some(td.z_values),
            Err(e) => {
                warnings.push(format!(
                    "Could not snapshot secondary table '{secondary_name}' ({e})."
                ));
                None
            }
        }
    } else {
        None
    };

    // Optional AFR/lambda target table from VeAnalyze
    let mut using_target_table = false;
    let target_afr_values = if let Some(ref target_name) = target_table_name {
        match get_table_data_internal(&state, target_name).await {
            Ok(td) => {
                using_target_table = true;
                Some(td.z_values)
            }
            Err(e) => {
                warnings.push(format!(
                    "Could not load AFR/lambda target table '{target_name}' ({e}); using Target AFR setting ({:.1}).",
                    settings.target_afr
                ));
                None
            }
        }
    } else {
        None
    };

    // Store the config for realtime stream to use
    let config = AutoTuneConfig {
        table_name: table_name.clone(),
        secondary_table_name: secondary_table_name.clone(),
        settings: settings.clone(),
        filters: filters.clone(),
        authority_limits: authority_limits.clone(),
        load_source: resolved_load_source,
        x_bins,
        y_bins,
        secondary_x_bins,
        secondary_y_bins,
        afr_channel_hint: afr_channel_hint.clone(),
        using_target_table,
        last_tps: None,
        last_timestamp_ms: None,
        saw_valid_afr: false,
        missing_afr_samples: 0,
    };

    *state.autotune_config.lock().await = Some(config);

    let mut guard = state.autotune_state.lock().await;
    guard.start();
    if let Some(values) = ve_table_values {
        guard.set_ve_table(values);
    }
    guard.set_target_afr_table(target_afr_values.clone());
    drop(guard);

    let mut secondary_guard = state.autotune_secondary_state.lock().await;
    if secondary_table_name.is_some() {
        secondary_guard.start();
        if let Some(values) = secondary_ve_values {
            secondary_guard.set_ve_table(values);
        }
        secondary_guard.set_target_afr_table(target_afr_values);
    } else {
        secondary_guard.stop();
    }
    drop(secondary_guard);

    // Warn if definition appears to lack AFR/lambda output channels
    {
        let def_guard = state.definition.lock().await;
        if let Some(def) = def_guard.as_ref() {
            let has_afr_like = def.output_channels.keys().any(|k| {
                let l = k.to_lowercase();
                l.contains("afr") || l.contains("lambda") || l.contains("wbo2")
            });
            if !has_afr_like {
                warnings.push(
                    "No AFR/lambda output channel found in this ECU definition. \
                     AutoTune cannot compute corrections without wideband data."
                        .into(),
                );
            }
        }
    }

    Ok(AutoTuneStartResult {
        warnings,
        using_target_table,
        afr_channel_hint,
    })
}

/// Read axis bin values from a constant definition
pub(crate) fn read_axis_bins(
    def: &EcuDefinition,
    cache: Option<&TuneCache>,
    const_name: &str,
    size: usize,
    axis_hint: AxisHint,
) -> Result<Vec<f64>, String> {
    let fallback_bins = |hint: AxisHint, size: usize| -> Vec<f64> {
        let steps = (size.saturating_sub(1)).max(1) as f64;
        match hint {
            AxisHint::Rpm => (0..size)
                .map(|i| 500.0 + (i as f64 * 6000.0 / steps))
                .collect(),
            AxisHint::Load(AutoTuneLoadSource::Maf) => (0..size)
                .map(|i| 0.0 + (i as f64 * 300.0 / steps))
                .collect(),
            AxisHint::Load(AutoTuneLoadSource::Map) => (0..size)
                .map(|i| 20.0 + (i as f64 * 80.0 / steps))
                .collect(),
            AxisHint::Unknown => {
                if size > 8 {
                    (0..size)
                        .map(|i| 500.0 + (i as f64 * 6000.0 / steps))
                        .collect()
                } else {
                    (0..size)
                        .map(|i| 20.0 + (i as f64 * 80.0 / steps))
                        .collect()
                }
            }
        }
    };

    // Try to get the constant
    let constant = match def.constants.get(const_name) {
        Some(c) => c,
        None => {
            // Constant not found, generate linear bins
            return Ok(fallback_bins(axis_hint, size));
        }
    };

    // If we have cached tune data, read from it
    if let Some(cache) = cache {
        if let Some(page_data) = cache.get_page(constant.page) {
            let elem_size = constant.data_type.size_bytes();
            let mut bins = Vec::with_capacity(size);
            let mut offset = constant.offset as usize;

            for _ in 0..size {
                if offset + elem_size <= page_data.len() {
                    if let Ok(raw) = read_raw_value(&page_data[offset..], &constant.data_type) {
                        bins.push(constant.raw_to_display(raw));
                    }
                    offset += elem_size;
                }
            }

            if !bins.is_empty() {
                return Ok(bins);
            }
        }
    }

    // Last resort: generate linear bins based on axis hint
    Ok(fallback_bins(axis_hint, size))
}
