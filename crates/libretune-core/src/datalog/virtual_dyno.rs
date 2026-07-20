//! Virtual dynamometer — estimate HP/torque from acceleration pulls.
//!
//! Uses vehicle mass, aerodynamic drag, rolling resistance, and gearing to
//! convert measured speed/RPM into a power curve. Requires a working VSS.

use super::dyno::{DynoDataPoint, DynoRun};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const AIR_DENSITY_KG_M3: f64 = 1.225;
const ROLLING_RESISTANCE: f64 = 0.015;
const GRAVITY: f64 = 9.81;
const HP_PER_WATT: f64 = 1.0 / 745.7;
const NM_TO_FT_LB: f64 = 0.737_562;
const KPH_TO_MS: f64 = 1.0 / 3.6;

/// (rpm, hp, torque_ftlb, afr, map_kpa)
type PowerSample = (f64, f64, f64, Option<f64>, Option<f64>);

/// Known INI constant names that indicate VSS hardware is assigned.
const VSS_PIN_CONSTANTS: &[&str] = &[
    "vehicleSpeedSensorInputPin",
    "vssPin",
    "speedoPin",
    "vssInputPin",
];

/// Output channel names that carry vehicle speed (kph unless noted).
const SPEED_CHANNEL_NAMES: &[&str] = &[
    "vehicleSpeedKph",
    "speed",
    "Speed",
    "wheelSpeed",
    "vss",
    "VSS",
    "vehicleSpeed",
];

/// Vehicle parameters used for virtual dyno calculations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualDynoProfile {
    /// Vehicle curb weight (kg)
    pub weight_kg: f64,
    /// Passenger + cargo mass (kg)
    pub cargo_kg: f64,
    /// Aerodynamic drag coefficient
    pub drag_coefficient: f64,
    /// Frontal area (m²)
    pub frontal_area_m2: f64,
    /// Tire rolling diameter (m)
    pub tire_diameter_m: f64,
    /// Selected transmission gear ratio
    pub gear_ratio: f64,
    /// Final drive ratio
    pub final_drive: f64,
    /// Primary reduction (motorcycle / transfer case), 1.0 for most cars
    pub primary_reduction: f64,
    /// Drivetrain loss (%), e.g. 15.0
    pub drivetrain_loss_pct: f64,
}

impl Default for VirtualDynoProfile {
    fn default() -> Self {
        Self {
            weight_kg: 1500.0,
            cargo_kg: 80.0,
            drag_coefficient: 0.30,
            frontal_area_m2: 2.2,
            tire_diameter_m: 0.65,
            gear_ratio: 1.0,
            final_drive: 3.73,
            primary_reduction: 1.0,
            drivetrain_loss_pct: 15.0,
        }
    }
}

/// Single realtime sample captured during a pull.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualDynoSample {
    /// Seconds from pull start
    pub time_secs: f64,
    /// Engine RPM
    pub rpm: f64,
    /// Vehicle speed (kph)
    pub speed_kph: f64,
    /// Throttle position (%) if available
    pub tps: Option<f64>,
    /// AFR if available
    pub afr: Option<f64>,
    /// MAP / boost (kPa) if available
    pub map_kpa: Option<f64>,
}

/// VSS readiness assessment for gating virtual dyno.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VssReadiness {
    /// ECU is not connected — no live speed data
    NotConnected,
    /// VSS input pin / source is not configured in the tune
    NotConfigured,
    /// No speed output channel in the ECU definition
    NoSpeedChannel,
    /// Speed channel exists but reads fault / stuck (e.g. always zero under load)
    Fault,
    /// VSS appears functional
    Ready,
}

impl VssReadiness {
    /// Human-readable explanation for the UI.
    pub fn message(&self) -> &'static str {
        match self {
            Self::NotConnected => {
                "Connect to the ECU to use Virtual Dyno. Live vehicle speed is required."
            }
            Self::NotConfigured => {
                "Vehicle speed sensor (VSS) is not configured in your tune. \
                 Assign a VSS input pin or CAN speed source before using Virtual Dyno."
            }
            Self::NoSpeedChannel => {
                "This ECU definition has no vehicle speed output channel. \
                 Virtual Dyno cannot run without speed data."
            }
            Self::Fault => {
                "Vehicle speed reads zero or invalid during the pull while RPM is rising. \
                 Check VSS wiring, tooth count, and gear ratio settings."
            }
            Self::Ready => "Vehicle speed sensor is configured and reporting data.",
        }
    }

    /// Whether virtual dyno operations are allowed.
    pub fn is_ready(&self) -> bool {
        matches!(self, Self::Ready)
    }
}

/// Result of processing a virtual dyno pull.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualDynoResult {
    /// Computed power curve as a standard dyno run
    pub run: DynoRun,
    /// Whether measured speed matched the selected gear within tolerance
    pub gear_verified: bool,
    /// Non-fatal warnings (e.g. gear mismatch, short pull)
    pub warnings: Vec<String>,
}

/// Assess whether virtual dyno can run given tune constants and channel list.
pub fn assess_vss_readiness(
    constants: &HashMap<String, f64>,
    output_channels: &[String],
    connected: bool,
) -> VssReadiness {
    if !connected {
        return VssReadiness::NotConnected;
    }

    if !is_vss_configured(constants) {
        return VssReadiness::NotConfigured;
    }

    if resolve_speed_channel(output_channels).is_none() {
        return VssReadiness::NoSpeedChannel;
    }

    VssReadiness::Ready
}

/// Validate pull samples — detect stuck / faulted VSS during acceleration.
pub fn validate_pull_samples(samples: &[VirtualDynoSample]) -> VssReadiness {
    if samples.len() < 5 {
        return VssReadiness::Fault;
    }

    let max_rpm = samples.iter().map(|s| s.rpm).fold(0.0_f64, f64::max);
    let max_speed = samples.iter().map(|s| s.speed_kph).fold(0.0_f64, f64::max);
    let min_speed = samples
        .iter()
        .map(|s| s.speed_kph)
        .fold(f64::INFINITY, f64::min);
    let speed_range = max_speed - min_speed;

    // RPM rose but speed never moved — classic VSS fault
    if max_rpm > 2000.0 && max_speed < 1.0 {
        return VssReadiness::Fault;
    }

    // Pull too short / no meaningful acceleration
    if max_rpm > 1500.0 && speed_range < 3.0 {
        return VssReadiness::Fault;
    }

    VssReadiness::Ready
}

/// Compute HP/torque curve from a recorded pull.
pub fn compute_virtual_dyno(
    samples: &[VirtualDynoSample],
    profile: &VirtualDynoProfile,
    smoothing: u8,
) -> Result<VirtualDynoResult, String> {
    if samples.len() < 10 {
        return Err("Pull too short — need at least 10 samples.".into());
    }

    if validate_pull_samples(samples) != VssReadiness::Ready {
        return Err("Vehicle speed data is invalid for this pull. \
             Virtual Dyno requires a working VSS."
            .into());
    }

    let mass_kg = (profile.weight_kg + profile.cargo_kg).max(1.0);
    let loss_factor = 1.0 - (profile.drivetrain_loss_pct / 100.0).clamp(0.0, 0.5);
    let window = smoothing_window(smoothing, samples.len());

    let smoothed_speed: Vec<f64> = smooth_speed(samples, window);
    let accelerations = compute_accelerations(samples, &smoothed_speed);

    let mut warnings = Vec::new();
    let gear_ok = verify_gear(samples, profile, &mut warnings);

    // Collect instantaneous power estimates during positive acceleration
    let mut raw_points: Vec<PowerSample> = Vec::new();

    for (i, sample) in samples.iter().enumerate() {
        let a = accelerations[i];
        if a <= 0.05 || sample.rpm < 500.0 {
            continue;
        }

        let v_ms = smoothed_speed[i] * KPH_TO_MS;
        if v_ms < 0.5 {
            continue;
        }

        let drag = 0.5
            * AIR_DENSITY_KG_M3
            * v_ms
            * v_ms
            * profile.drag_coefficient
            * profile.frontal_area_m2;
        let rolling = ROLLING_RESISTANCE * mass_kg * GRAVITY;
        let force = mass_kg * a + drag + rolling;
        let wheel_watts = force * v_ms;
        let engine_watts = wheel_watts / loss_factor.max(0.5);
        let hp = engine_watts * HP_PER_WATT;

        let omega = 2.0 * std::f64::consts::PI * sample.rpm / 60.0;
        let torque_ftlb = if omega > 0.0 {
            (engine_watts / omega) * NM_TO_FT_LB
        } else {
            0.0
        };

        if hp.is_finite() && hp > 0.0 && hp < 5000.0 {
            raw_points.push((sample.rpm, hp, torque_ftlb, sample.afr, sample.map_kpa));
        }
    }

    if raw_points.len() < 5 {
        return Err("Not enough acceleration data in this pull. \
             Try a longer WOT pull in the selected gear."
            .into());
    }

    let data = bin_by_rpm(&raw_points, 50.0);
    if data.is_empty() {
        return Err("Could not build a power curve from this pull.".into());
    }

    let mut run = DynoRun::new("Virtual Pull", "#66bb6a");
    run.data = data;
    run.compute_peaks();

    if !gear_ok {
        warnings.push(
            "Measured speed does not match the selected gear ratio. \
             Verify gear selection and tire diameter."
                .into(),
        );
    }

    Ok(VirtualDynoResult {
        run,
        gear_verified: gear_ok,
        warnings,
    })
}

/// Build tire diameter (m) from wheel specs.
pub fn tire_diameter_from_specs(wheel_dia_in: f64, aspect_ratio: f64, width_mm: f64) -> f64 {
    let sidewall_mm = width_mm * (aspect_ratio / 100.0);
    let total_mm = wheel_dia_in * 25.4 + 2.0 * sidewall_mm;
    total_mm / 1000.0
}

fn is_vss_configured(constants: &HashMap<String, f64>) -> bool {
    // If any known VSS pin constant exists and is non-zero, configured
    for name in VSS_PIN_CONSTANTS {
        if let Some(&val) = constants.get(*name) {
            return val > 0.0;
        }
    }

    // CAN VSS fallback (rusEFI)
    if constants.get("enableCanVss").copied().unwrap_or(0.0) > 0.0 {
        return true;
    }

    // No known VSS constant in INI — allow if speed channel exists at runtime
    // (Speeduino and others may not expose a pin constant name we know)
    !constants
        .keys()
        .any(|k| VSS_PIN_CONSTANTS.contains(&k.as_str()))
}

/// Resolve the first matching speed channel name from available outputs.
pub fn resolve_speed_channel(channels: &[String]) -> Option<String> {
    for candidate in SPEED_CHANNEL_NAMES {
        if channels.iter().any(|c| c.eq_ignore_ascii_case(candidate)) {
            return Some((*candidate).to_string());
        }
    }
    channels
        .iter()
        .find(|c| {
            let l = c.to_lowercase();
            l.contains("speed") && !l.contains("wheel") || l == "vss"
        })
        .cloned()
}

fn smoothing_window(smoothing: u8, sample_count: usize) -> usize {
    let base = 3usize;
    let extra = (smoothing as usize).min(20);
    (base + extra).min(sample_count.max(1) / 4).max(1)
}

fn smooth_speed(samples: &[VirtualDynoSample], window: usize) -> Vec<f64> {
    let n = samples.len();
    let half = window / 2;

    (0..n)
        .map(|i| {
            let start = i.saturating_sub(half);
            let end = (i + half + 1).min(n);
            let slice = &samples[start..end];
            slice.iter().map(|s| s.speed_kph).sum::<f64>() / slice.len() as f64
        })
        .collect()
}

fn compute_accelerations(samples: &[VirtualDynoSample], smoothed_speed: &[f64]) -> Vec<f64> {
    let n = samples.len();
    let mut acc = vec![0.0; n];

    for i in 0..n {
        let (v1, t1, v2, t2) = if i == 0 {
            (
                smoothed_speed[0] * KPH_TO_MS,
                samples[0].time_secs,
                smoothed_speed[1] * KPH_TO_MS,
                samples[1].time_secs,
            )
        } else if i == n - 1 {
            (
                smoothed_speed[n - 2] * KPH_TO_MS,
                samples[n - 2].time_secs,
                smoothed_speed[n - 1] * KPH_TO_MS,
                samples[n - 1].time_secs,
            )
        } else {
            (
                smoothed_speed[i - 1] * KPH_TO_MS,
                samples[i - 1].time_secs,
                smoothed_speed[i + 1] * KPH_TO_MS,
                samples[i + 1].time_secs,
            )
        };

        let dt = t2 - t1;
        acc[i] = if dt > 1e-6 { (v2 - v1) / dt } else { 0.0 };
    }
    acc
}

fn expected_speed_kph(rpm: f64, profile: &VirtualDynoProfile) -> f64 {
    let total_ratio = profile.gear_ratio * profile.final_drive * profile.primary_reduction;
    if total_ratio <= 0.0 || profile.tire_diameter_m <= 0.0 {
        return 0.0;
    }
    // wheel rpm = engine rpm / total_ratio
    // speed m/s = wheel_rpm * circumference / 60
    let circumference = std::f64::consts::PI * profile.tire_diameter_m;
    let wheel_rpm = rpm / total_ratio;
    let speed_ms = wheel_rpm * circumference / 60.0;
    speed_ms * 3.6
}

fn verify_gear(
    samples: &[VirtualDynoSample],
    profile: &VirtualDynoProfile,
    warnings: &mut Vec<String>,
) -> bool {
    let mut checks = 0;
    let mut passes = 0;

    for sample in samples {
        if sample.rpm < 2000.0 || sample.speed_kph < 10.0 {
            continue;
        }
        let expected = expected_speed_kph(sample.rpm, profile);
        if expected < 1.0 {
            continue;
        }
        let error_pct = ((sample.speed_kph - expected) / expected).abs() * 100.0;
        checks += 1;
        if error_pct <= 15.0 {
            passes += 1;
        }
    }

    if checks < 3 {
        warnings.push("Not enough mid-range data to verify gear ratio.".into());
        return true;
    }

    passes * 2 >= checks
}

fn bin_by_rpm(points: &[PowerSample], bin_width: f64) -> Vec<DynoDataPoint> {
    if points.is_empty() {
        return Vec::new();
    }

    let min_rpm = points.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let max_rpm = points.iter().map(|p| p.0).fold(0.0_f64, f64::max);
    let start = (min_rpm / bin_width).floor() * bin_width;
    let end = (max_rpm / bin_width).ceil() * bin_width;

    let mut bins: Vec<DynoDataPoint> = Vec::new();
    let mut rpm = start;
    while rpm <= end {
        let next = rpm + bin_width;
        let in_bin: Vec<_> = points.iter().filter(|p| p.0 >= rpm && p.0 < next).collect();

        if !in_bin.is_empty() {
            let n = in_bin.len() as f64;
            let avg_hp = in_bin.iter().map(|p| p.1).sum::<f64>() / n;
            let avg_tq = in_bin.iter().map(|p| p.2).sum::<f64>() / n;
            let avg_afr = average_optional(in_bin.iter().filter_map(|p| p.3));
            let avg_map = average_optional(in_bin.iter().filter_map(|p| p.4));

            bins.push(DynoDataPoint {
                rpm: rpm + bin_width / 2.0,
                hp: Some(avg_hp),
                torque: Some(avg_tq),
                afr: avg_afr,
                boost: avg_map,
                time: None,
            });
        }
        rpm = next;
    }

    bins
}

fn average_optional(values: impl Iterator<Item = f64>) -> Option<f64> {
    let mut sum = 0.0;
    let mut count = 0usize;
    for v in values {
        sum += v;
        count += 1;
    }
    if count > 0 {
        Some(sum / count as f64)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_pull() -> Vec<VirtualDynoSample> {
        let profile = VirtualDynoProfile::default();
        let mut samples = Vec::new();
        for i in 0..80 {
            let t = i as f64 * 0.1;
            let rpm = 2000.0 + i as f64 * 50.0;
            let speed = expected_speed_kph(rpm, &profile) * (0.95 + (i as f64 / 200.0));
            samples.push(VirtualDynoSample {
                time_secs: t,
                rpm,
                speed_kph: speed,
                tps: Some(100.0),
                afr: Some(12.5),
                map_kpa: None,
            });
        }
        samples
    }

    #[test]
    fn test_vss_not_configured_when_pin_zero() {
        let mut constants = HashMap::new();
        constants.insert("vehicleSpeedSensorInputPin".into(), 0.0);
        let channels = vec!["vehicleSpeedKph".into()];
        assert_eq!(
            assess_vss_readiness(&constants, &channels, true),
            VssReadiness::NotConfigured
        );
    }

    #[test]
    fn test_vss_ready_when_pin_set() {
        let mut constants = HashMap::new();
        constants.insert("vehicleSpeedSensorInputPin".into(), 42.0);
        let channels = vec!["vehicleSpeedKph".into()];
        assert_eq!(
            assess_vss_readiness(&constants, &channels, true),
            VssReadiness::Ready
        );
    }

    #[test]
    fn test_vss_fault_when_speed_stuck() {
        let samples: Vec<_> = (0..30)
            .map(|i| VirtualDynoSample {
                time_secs: i as f64 * 0.1,
                rpm: 3000.0 + i as f64 * 100.0,
                speed_kph: 0.0,
                tps: Some(100.0),
                afr: None,
                map_kpa: None,
            })
            .collect();
        assert_eq!(validate_pull_samples(&samples), VssReadiness::Fault);
    }

    #[test]
    fn test_compute_virtual_dyno_produces_curve() {
        let samples = sample_pull();
        let profile = VirtualDynoProfile::default();
        let result = compute_virtual_dyno(&samples, &profile, 5).unwrap();
        assert!(!result.run.data.is_empty());
        assert!(result.run.peak_hp.is_some());
        assert!(result.run.peak_torque.is_some());
        let peak_hp = result.run.peak_hp.unwrap().0;
        assert!(peak_hp > 10.0 && peak_hp < 2000.0);
    }

    #[test]
    fn test_expected_speed_formula() {
        let profile = VirtualDynoProfile {
            tire_diameter_m: 0.65,
            gear_ratio: 1.0,
            final_drive: 3.0,
            primary_reduction: 1.0,
            ..VirtualDynoProfile::default()
        };
        let speed = expected_speed_kph(3000.0, &profile);
        assert!(speed > 50.0 && speed < 250.0);
    }
}
