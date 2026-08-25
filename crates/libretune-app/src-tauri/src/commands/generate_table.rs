//! Per-table generator command.
//!
//! TunerStudio exposes a "generate table" action inside each table editor: with
//! a VE, ignition, or AFR/lambda table open you can (re)seed it from basic
//! engine parameters. LibreTune already had these generators, but only behind
//! the one-shot base-map wizard ([`super::base_map`] / [`super::apply_base_map`]).
//!
//! This command lets the table editor regenerate values for a **single** open
//! table, over that table's **current axes** (the frontend passes the live
//! `rpm_bins`/`load_bins`), and returns the new Z grid. The frontend then
//! applies the grid through the normal edit pipeline (undo history + explicit
//! burn), so nothing is written to the ECU behind the user's back.

use crate::AppState;
use libretune_core::ini::TableRole;

/// The kinds of table this command can generate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GeneratableKind {
    Ve,
    Ignition,
    Afr,
}

impl GeneratableKind {
    fn as_str(self) -> &'static str {
        match self {
            GeneratableKind::Ve => "ve",
            GeneratableKind::Ignition => "ignition",
            GeneratableKind::Afr => "afr",
        }
    }
}

/// Name-based fallback classifier, mirroring [`super::apply_base_map`]'s lists.
///
/// Used only when the INI-derived [`TableRole`] is unavailable (`Other`). The
/// role is the authoritative source when populated.
fn classify_by_name(name: &str) -> Option<GeneratableKind> {
    const VE: [&str; 4] = ["veTable1Tbl", "veTableTbl", "fuelTable1Tbl", "fuelTableTbl"];
    const IGN: [&str; 5] = [
        "sparkTbl",
        "ignitionTableTbl",
        "advTable1Tbl",
        "ignitionTbl",
        "spark1Tbl",
    ];
    const AFR: [&str; 4] = [
        "afrTable1Tbl",
        "lambdaTableTbl",
        "afrTableTbl",
        "lambdaTable1Tbl",
    ];

    if VE.contains(&name) {
        Some(GeneratableKind::Ve)
    } else if IGN.contains(&name) {
        Some(GeneratableKind::Ignition)
    } else if AFR.contains(&name) {
        Some(GeneratableKind::Afr)
    } else {
        None
    }
}

fn role_to_kind(role: TableRole) -> Option<GeneratableKind> {
    match role {
        TableRole::Ve => Some(GeneratableKind::Ve),
        TableRole::Ignition => Some(GeneratableKind::Ignition),
        TableRole::AfrTarget => Some(GeneratableKind::Afr),
        _ => None,
    }
}

/// Generate a fresh Z grid for a single table from engine specs.
///
/// Returns `{ "table_type": "ve"|"ignition"|"afr", "z_values": [[f64; cols]; rows] }`.
/// `rows == load_bins.len()`, `cols == rpm_bins.len()` (matching the core
/// generators and the table editor's row/column orientation).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn generate_table_values(
    state: tauri::State<'_, AppState>,
    table_name: String,
    rpm_bins: Vec<f64>,
    load_bins: Vec<f64>,
    cylinder_count: u8,
    displacement_cc: f64,
    injector_size_cc: f64,
    fuel_type: String,
    aspiration: String,
    stroke_type: String,
    injection_mode: String,
    ignition_mode: String,
    idle_rpm: u16,
    redline_rpm: u16,
    boost_target_kpa: Option<f64>,
    target_wot_afr: Option<f64>,
    octane: Option<f64>,
    compression_ratio: Option<f64>,
    combustion_chamber: Option<String>,
    rebuild_axes: Option<bool>,
) -> Result<serde_json::Value, String> {
    use libretune_core::basemap::generator::{
        generate_afr_table, generate_ignition_table, generate_load_bins, generate_rpm_bins,
        generate_ve_table,
    };
    use libretune_core::basemap::{
        Aspiration, CombustionChamber, EngineSpec, FuelType, IgnitionMode, InjectionMode,
        StrokeType,
    };

    if rpm_bins.is_empty() || load_bins.is_empty() {
        return Err("Table axes are empty — cannot generate values".to_string());
    }

    // Classify the open table. Prefer the INI-derived role; fall back to
    // name matching (which is what apply_base_map relies on today).
    let kind = {
        let def_guard = state.definition.lock().await;
        let def = def_guard.as_ref().ok_or("No ECU definition loaded")?;
        let table = def
            .get_table_by_name_or_map(&table_name)
            .ok_or_else(|| format!("Table '{}' not found in the loaded definition", table_name))?;

        role_to_kind(table.role)
            .or_else(|| classify_by_name(&table.name))
            .or_else(|| classify_by_name(&table.map))
            .ok_or_else(|| {
                format!(
                    "No generator is available for '{}'. Generation is supported for VE, \
                     ignition and AFR/lambda target tables.",
                    table_name
                )
            })?
    };

    let fuel = match fuel_type.to_lowercase().as_str() {
        "gasoline" | "petrol" => FuelType::Gasoline,
        "e85" => FuelType::E85,
        "e100" => FuelType::E100,
        "methanol" => FuelType::Methanol,
        "lpg" | "propane" => FuelType::LPG,
        _ => return Err(format!("Unknown fuel type: {}", fuel_type)),
    };

    let asp = match aspiration.to_lowercase().as_str() {
        "na" | "naturally_aspirated" => Aspiration::NA,
        "turbo" | "turbocharged" => Aspiration::Turbo,
        "supercharged" => Aspiration::Supercharged,
        _ => return Err(format!("Unknown aspiration: {}", aspiration)),
    };

    let stroke = match stroke_type.to_lowercase().as_str() {
        "four_stroke" | "4stroke" | "4" => StrokeType::FourStroke,
        "two_stroke" | "2stroke" | "2" => StrokeType::TwoStroke,
        _ => return Err(format!("Unknown stroke type: {}", stroke_type)),
    };

    let inj = match injection_mode.to_lowercase().as_str() {
        "sequential" => InjectionMode::Sequential,
        "batch" => InjectionMode::Batch,
        "simultaneous" => InjectionMode::Simultaneous,
        "throttle_body" | "tbi" => InjectionMode::ThrottleBody,
        _ => return Err(format!("Unknown injection mode: {}", injection_mode)),
    };

    let ign = match ignition_mode.to_lowercase().as_str() {
        "wasted_spark" | "wastedspark" => IgnitionMode::WastedSpark,
        "coil_on_plug" | "cop" => IgnitionMode::CoilOnPlug,
        "distributor" => IgnitionMode::Distributor,
        _ => return Err(format!("Unknown ignition mode: {}", ignition_mode)),
    };

    let chamber = match combustion_chamber
        .as_deref()
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("open_chamber") | Some("open") => Some(CombustionChamber::OpenChamber),
        Some("quench_two_valve") | Some("quench") => Some(CombustionChamber::QuenchTwoValve),
        Some("swirl_multi_valve") | Some("swirl") => Some(CombustionChamber::SwirlMultiValve),
        Some(other) if !other.is_empty() => {
            return Err(format!("Unknown combustion chamber: {}", other))
        }
        _ => None,
    };

    let spec = EngineSpec {
        cylinder_count,
        displacement_cc,
        injector_size_cc,
        fuel_type: fuel,
        aspiration: asp,
        stroke_type: stroke,
        injection_mode: inj,
        ignition_mode: ign,
        idle_rpm,
        redline_rpm,
        boost_target_kpa,
        target_wot_afr,
        octane,
        compression_ratio,
        combustion_chamber: chamber,
    };

    // Optionally rebuild the axes from idle/redline (and load range) so the RPM
    // span reflects the engine spec — otherwise generate over the table's
    // existing bins. Bin counts always match the current table dimensions.
    let (x_bins, y_bins) = if rebuild_axes.unwrap_or(false) {
        (
            generate_rpm_bins(spec.idle_rpm, spec.redline_rpm, rpm_bins.len()),
            generate_load_bins(spec.max_load_kpa(), load_bins.len()),
        )
    } else {
        (rpm_bins, load_bins)
    };

    let z_values = match kind {
        GeneratableKind::Ve => generate_ve_table(&spec, &x_bins, &y_bins),
        GeneratableKind::Ignition => generate_ignition_table(&spec, &x_bins, &y_bins),
        GeneratableKind::Afr => generate_afr_table(&spec, &x_bins, &y_bins),
    };

    Ok(serde_json::json!({
        "table_type": kind.as_str(),
        "z_values": z_values,
        "x_bins": x_bins,
        "y_bins": y_bins,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_classifier_matches_known_tables() {
        assert_eq!(classify_by_name("veTable1Tbl"), Some(GeneratableKind::Ve));
        assert_eq!(classify_by_name("veTableTbl"), Some(GeneratableKind::Ve));
        assert_eq!(
            classify_by_name("sparkTbl"),
            Some(GeneratableKind::Ignition)
        );
        assert_eq!(
            classify_by_name("ignitionTableTbl"),
            Some(GeneratableKind::Ignition)
        );
        assert_eq!(classify_by_name("afrTable1Tbl"), Some(GeneratableKind::Afr));
        assert_eq!(
            classify_by_name("lambdaTableTbl"),
            Some(GeneratableKind::Afr)
        );
        assert_eq!(classify_by_name("boostTbl"), None);
    }

    #[test]
    fn role_takes_precedence_over_name() {
        assert_eq!(role_to_kind(TableRole::Ve), Some(GeneratableKind::Ve));
        assert_eq!(
            role_to_kind(TableRole::Ignition),
            Some(GeneratableKind::Ignition)
        );
        assert_eq!(
            role_to_kind(TableRole::AfrTarget),
            Some(GeneratableKind::Afr)
        );
        assert_eq!(role_to_kind(TableRole::WarmupEnrichment), None);
        assert_eq!(role_to_kind(TableRole::Other), None);
    }
}
