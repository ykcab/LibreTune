//! Virtual dynamometer Tauri commands.

use libretune_core::datalog::{
    assess_vss_readiness, compute_virtual_dyno, VirtualDynoProfile, VirtualDynoResult,
    VirtualDynoSample, VssReadiness,
};
use std::collections::HashMap;

/// Check whether VSS is configured and speed data is available for virtual dyno.
#[tauri::command]
pub async fn check_virtual_dyno_vss(
    constants: HashMap<String, f64>,
    output_channels: Vec<String>,
    connected: bool,
) -> Result<VssReadiness, String> {
    Ok(assess_vss_readiness(
        &constants,
        &output_channels,
        connected,
    ))
}

/// Compute HP/torque curve from a recorded acceleration pull.
#[tauri::command]
pub async fn compute_virtual_dyno_pull(
    samples: Vec<VirtualDynoSample>,
    profile: VirtualDynoProfile,
    smoothing: u8,
) -> Result<VirtualDynoResult, String> {
    compute_virtual_dyno(&samples, &profile, smoothing)
}
