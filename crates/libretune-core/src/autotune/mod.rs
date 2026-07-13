//! AutoTune Module
//!
//! Implements automatic VE table tuning based on real-time AFR data.
//! Features:
//! - Auto-tuning with recommendations based on AFR data
//! - Authority limits to restrict changes
//! - Data filtering (RPM ranges, coolant temp, custom expressions)
//! - Cell locking functionality
//! - Reference tables (Lambda Delay, AFR Target)
//!
//! AI Analysis submodules:
//! - Predictive cell filling for zero-hit VE table cells
//! - Anomaly detection for identifying suspect data and tune problems
//! - Tune health scoring with per-region quality assessment

pub mod anomaly;
pub mod health;
pub mod predictor;

use evalexpr::{eval_with_context, ContextWithMutableVariables, HashMapContext, Value};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single cell recommendation in the VE table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTuneRecommendation {
    pub cell_x: usize,
    pub cell_y: usize,
    pub beginning_value: f64,
    pub recommended_value: f64,
    pub hit_count: u32,
    pub hit_weighting: f64,
    pub target_afr: f64,
    pub hit_percentage: f64,
}

/// AutoTune settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AutoTuneSettings {
    pub target_afr: f64,
    /// `"simple"` | `"weighted"` | `"pid"`
    pub algorithm: String,
    pub update_rate_ms: u32,
}

impl Default for AutoTuneSettings {
    fn default() -> Self {
        Self {
            target_afr: 14.7,
            algorithm: "simple".to_string(),
            update_rate_ms: 100,
        }
    }
}

impl AutoTuneSettings {
    /// Normalized algorithm id.
    pub fn algorithm_kind(&self) -> AutotuneAlgorithm {
        match self.algorithm.to_ascii_lowercase().as_str() {
            "weighted" | "weighted_average" | "weighted-average" => AutotuneAlgorithm::Weighted,
            "pid" => AutotuneAlgorithm::Pid,
            _ => AutotuneAlgorithm::Simple,
        }
    }
}

/// AutoTune correction algorithm.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutotuneAlgorithm {
    /// Uniform running average of sample corrections
    Simple,
    /// Weight samples by bin-center proximity and TPS stability
    Weighted,
    /// Proportional–integral correction on AFR error ratio
    Pid,
}

/// Per-cell accumulators for weighted / PID algorithms
#[derive(Debug, Clone, Default)]
struct CellTuneAccum {
    /// Sum of (required_ve * weight)
    weighted_required_sum: f64,
    /// Sum of weights
    weight_sum: f64,
    /// Integrated AFR error ratio for PID (`actual/target - 1`)
    integral_error: f64,
}

/// Authority limits to restrict VE changes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AutoTuneAuthorityLimits {
    #[serde(alias = "max_change_per_cell")]
    pub max_cell_value_change: f64,
    #[serde(alias = "max_total_change")]
    pub max_cell_percentage_change: f64,
}

impl Default for AutoTuneAuthorityLimits {
    fn default() -> Self {
        Self {
            max_cell_value_change: 10.0,
            max_cell_percentage_change: 20.0,
        }
    }
}

/// Data filters for VE Analyze
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AutoTuneFilters {
    pub min_rpm: f64,
    pub max_rpm: f64,
    pub min_y_axis: Option<String>,
    pub max_y_axis: Option<String>,
    pub min_clt: f64,
    pub custom_filter: Option<String>,
    // Transient filtering
    pub max_tps_rate: f64, // Max TPS change rate (%/sec) before filtering
    pub exclude_accel_enrich: bool, // Exclude data when accel enrichment active
}

impl Default for AutoTuneFilters {
    fn default() -> Self {
        Self {
            min_rpm: 1000.0,
            max_rpm: 7000.0,
            min_y_axis: None,
            max_y_axis: None,
            // Coolant minimum in °C (matches UI default). Users on °F should raise this.
            min_clt: 60.0,
            custom_filter: None,
            max_tps_rate: 10.0,         // 10%/sec threshold
            exclude_accel_enrich: true, // Exclude accel enrichment by default
        }
    }
}

/// Reference tables used by VE Analyze
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTuneReferenceTables {
    pub lambda_delay_table: Vec<Vec<f64>>,
    pub target_afr_table: Vec<Vec<f64>>,
}

/// VE Analyze runtime state
#[derive(Debug)]
pub struct AutoTuneState {
    pub is_running: bool,
    pub locked_cells: Vec<(usize, usize)>,
    pub recommendations: HashMap<(usize, usize), AutoTuneRecommendation>,
    /// Current VE table values `[y][x]` — preferred source for beginning_value
    ve_table: Option<Vec<Vec<f64>>>,
    /// Optional AFR/lambda target table `[y][x]` (values may be AFR or lambda)
    target_afr_table: Option<Vec<Vec<f64>>>,
    /// Per-cell weighted / PID accumulators
    cell_accum: HashMap<(usize, usize), CellTuneAccum>,
    // Lambda delay buffer - stores recent data points for delayed correlation
    data_buffer: std::collections::VecDeque<VEDataPoint>,
    buffer_max_age_ms: u64, // How long to keep data points (default 500ms)
}

impl Default for AutoTuneState {
    fn default() -> Self {
        Self {
            is_running: false,
            locked_cells: Vec::new(),
            recommendations: HashMap::new(),
            ve_table: None,
            target_afr_table: None,
            cell_accum: HashMap::new(),
            data_buffer: std::collections::VecDeque::new(),
            buffer_max_age_ms: 500, // Keep 500ms of data for lambda delay correlation
        }
    }
}

/// Data point from ECU for VE analysis
#[derive(Debug, Clone)]
pub struct VEDataPoint {
    pub rpm: f64,
    pub map: f64,
    pub maf: f64,
    pub load: f64,
    pub afr: f64,
    pub ve: f64,
    pub clt: f64,
    // Transient detection fields
    pub tps: f64,                          // Current TPS value (%)
    pub tps_rate: f64,                     // TPS change rate (%/sec)
    pub accel_enrich_active: Option<bool>, // ECU accel enrichment flag (if available)
    // Lambda delay correlation
    pub timestamp_ms: u64, // Timestamp for delay correlation
    /// False when no real AFR/lambda channel was available for this sample
    pub afr_valid: bool,
}

impl Default for VEDataPoint {
    fn default() -> Self {
        Self {
            rpm: 0.0,
            map: 0.0,
            maf: 0.0,
            load: 0.0,
            afr: 0.0,
            ve: 0.0,
            clt: 0.0,
            tps: 0.0,
            tps_rate: 0.0,
            accel_enrich_active: None,
            timestamp_ms: 0,
            afr_valid: false,
        }
    }
}

/// Normalize AFR or lambda reading to AFR (gasoline stoich 14.7).
pub fn reading_to_afr(value: f64) -> f64 {
    if value > 0.0 && value < 5.0 {
        value * 14.7
    } else {
        value
    }
}

impl AutoTuneState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start(&mut self) {
        self.is_running = true;
        self.recommendations.clear();
        self.cell_accum.clear();
        self.data_buffer.clear();
    }

    pub fn stop(&mut self) {
        self.is_running = false;
    }

    /// Attach the VE table snapshot used as beginning_value for each cell.
    pub fn set_ve_table(&mut self, values: Vec<Vec<f64>>) {
        self.ve_table = Some(values);
    }

    /// Attach an AFR/lambda target table (optional; falls back to settings.target_afr).
    pub fn set_target_afr_table(&mut self, values: Option<Vec<Vec<f64>>>) {
        self.target_afr_table = values;
    }

    pub fn is_cell_locked(&self, x: usize, y: usize) -> bool {
        self.locked_cells.contains(&(x, y))
    }

    pub fn lock_cells(&mut self, cells: Vec<(usize, usize)>) {
        self.locked_cells.extend(cells);
    }

    pub fn unlock_cells(&mut self, cells: Vec<(usize, usize)>) {
        for cell in cells {
            if let Some(pos) = self.locked_cells.iter().position(|c| c == &cell) {
                self.locked_cells.remove(pos);
            }
        }
    }

    /// Calculate lambda sensor delay based on RPM
    /// Higher RPM = faster exhaust flow = less delay
    /// Returns delay in milliseconds
    fn get_lambda_delay_ms(&self, rpm: f64) -> u64 {
        // Default delay curve:
        // - At idle (800 RPM): ~200ms delay
        // - At redline (6000 RPM): ~50ms delay
        // Linear interpolation between these points
        const IDLE_RPM: f64 = 800.0;
        const REDLINE_RPM: f64 = 6000.0;
        const IDLE_DELAY_MS: f64 = 200.0;
        const REDLINE_DELAY_MS: f64 = 50.0;

        let clamped_rpm = rpm.clamp(IDLE_RPM, REDLINE_RPM);
        let rpm_ratio = (clamped_rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM);
        let delay = IDLE_DELAY_MS - (rpm_ratio * (IDLE_DELAY_MS - REDLINE_DELAY_MS));

        delay as u64
    }

    /// Prune old entries from the data buffer
    fn prune_data_buffer(&mut self, current_timestamp_ms: u64) {
        let cutoff = current_timestamp_ms.saturating_sub(self.buffer_max_age_ms);
        while let Some(front) = self.data_buffer.front() {
            if front.timestamp_ms < cutoff {
                self.data_buffer.pop_front();
            } else {
                break;
            }
        }
    }

    /// Find the data point from the buffer that best matches the lambda delay
    fn find_delayed_data_point(
        &self,
        current_timestamp_ms: u64,
        delay_ms: u64,
    ) -> Option<VEDataPoint> {
        let target_time = current_timestamp_ms.saturating_sub(delay_ms);

        // Find the closest data point to the target time
        let mut best_match: Option<&VEDataPoint> = None;
        let mut best_diff = u64::MAX;

        for point in self.data_buffer.iter() {
            let diff = point.timestamp_ms.abs_diff(target_time);

            if diff < best_diff {
                best_diff = diff;
                best_match = Some(point);
            }
        }

        // Only use if within 50ms of target time
        if best_diff < 50 {
            best_match.cloned()
        } else {
            None
        }
    }

    pub fn add_data_point(
        &mut self,
        point: VEDataPoint,
        table_x_bins: &[f64],
        table_y_bins: &[f64],
        settings: &AutoTuneSettings,
        filters: &AutoTuneFilters,
        authority: &AutoTuneAuthorityLimits,
    ) {
        if !self.is_running {
            return;
        }

        // Always add to buffer for lambda delay correlation
        self.data_buffer.push_back(point.clone());
        self.prune_data_buffer(point.timestamp_ms);

        if !point.afr_valid {
            return;
        }

        if !self.passes_filters(&point, filters) {
            return;
        }

        // Calculate lambda delay based on current RPM
        let delay_ms = self.get_lambda_delay_ms(point.rpm);

        // Find the data point from when the current AFR reading was actually generated
        // The current AFR corresponds to conditions from delay_ms ago
        let historical_point = if delay_ms > 0 && point.timestamp_ms > delay_ms {
            self.find_delayed_data_point(point.timestamp_ms, delay_ms)
        } else {
            None
        };

        // Use historical cell location if available, otherwise use current
        let (cell_rpm, cell_load, channel_ve) = if let Some(ref hist) = historical_point {
            // Use the historical RPM/load to find the correct cell
            // but use current AFR (which corresponds to that historical moment)
            (hist.rpm, hist.load, hist.ve)
        } else {
            // No historical data available, use current (less accurate but better than nothing)
            (point.rpm, point.load, point.ve)
        };

        let x_idx = self.find_bin_index(cell_rpm, table_x_bins);
        let y_idx = self.find_bin_index(cell_load, table_y_bins);

        if x_idx.is_none() || y_idx.is_none() {
            return;
        }

        let cell_x_idx = x_idx.unwrap();
        let cell_y_idx = y_idx.unwrap();

        if self.is_cell_locked(cell_x_idx, cell_y_idx) {
            return;
        }

        // Prefer the tune table cell as beginning VE; fall back to live VE channel.
        let table_ve = self
            .ve_table
            .as_ref()
            .and_then(|t| t.get(cell_y_idx))
            .and_then(|row| row.get(cell_x_idx))
            .copied()
            .filter(|v| v.is_finite() && *v > 0.0);
        let cell_ve = table_ve.unwrap_or(channel_ve);
        if cell_ve <= 0.0 || !cell_ve.is_finite() {
            return;
        }

        let target_from_table = self
            .target_afr_table
            .as_ref()
            .and_then(|t| t.get(cell_y_idx))
            .and_then(|row| row.get(cell_x_idx))
            .copied()
            .filter(|v| v.is_finite() && *v > 0.1);
        let target_afr = reading_to_afr(target_from_table.unwrap_or(settings.target_afr));
        let actual_afr = reading_to_afr(point.afr);

        let instantaneous_required =
            self.calculate_required_ve(cell_ve, actual_afr, target_afr);

        let sample_weight = match settings.algorithm_kind() {
            AutotuneAlgorithm::Simple => 1.0,
            AutotuneAlgorithm::Weighted => {
                self.bin_proximity_weight(cell_rpm, cell_x_idx, table_x_bins)
                    * self.bin_proximity_weight(cell_load, cell_y_idx, table_y_bins)
                    * self.tps_stability_weight(point.tps_rate)
            }
            AutotuneAlgorithm::Pid => 1.0,
        };

        // Seed recommendation shell (beginning_value) before accumulators borrow state
        let beginning = {
            let rec = self
                .recommendations
                .entry((cell_x_idx, cell_y_idx))
                .or_insert_with(|| AutoTuneRecommendation {
                    cell_x: cell_x_idx,
                    cell_y: cell_y_idx,
                    beginning_value: cell_ve,
                    recommended_value: cell_ve,
                    hit_count: 0,
                    hit_weighting: 0.0,
                    target_afr,
                    hit_percentage: 0.0,
                });
            if rec.hit_count == 0 {
                rec.beginning_value = cell_ve;
            }
            rec.beginning_value
        };

        let required_ve = match settings.algorithm_kind() {
            AutotuneAlgorithm::Simple => {
                let accum = self
                    .cell_accum
                    .entry((cell_x_idx, cell_y_idx))
                    .or_default();
                accum.weight_sum += 1.0;
                accum.weighted_required_sum += instantaneous_required;
                accum.weighted_required_sum / accum.weight_sum
            }
            AutotuneAlgorithm::Weighted => {
                let w = sample_weight.max(0.05);
                let accum = self
                    .cell_accum
                    .entry((cell_x_idx, cell_y_idx))
                    .or_default();
                accum.weight_sum += w;
                accum.weighted_required_sum += instantaneous_required * w;
                accum.weighted_required_sum / accum.weight_sum
            }
            AutotuneAlgorithm::Pid => {
                // error > 0 ⇒ lean (need more fuel); < 0 ⇒ rich
                let error_ratio = if target_afr > 0.1 {
                    actual_afr / target_afr - 1.0
                } else {
                    0.0
                };
                const KP: f64 = 0.55;
                const KI: f64 = 0.08;
                const DT: f64 = 0.1; // ~10 Hz sample assumption
                const INTEGRAL_LIMIT: f64 = 0.35;

                let accum = self
                    .cell_accum
                    .entry((cell_x_idx, cell_y_idx))
                    .or_default();
                accum.integral_error =
                    (accum.integral_error + error_ratio * DT).clamp(-INTEGRAL_LIMIT, INTEGRAL_LIMIT);
                let correction = 1.0 + KP * error_ratio + KI * accum.integral_error;
                beginning * correction.clamp(0.5, 1.5)
            }
        };

        let clamped_ve = Self::apply_authority_limits(beginning, required_ve, authority);

        if let Some(rec) = self.recommendations.get_mut(&(cell_x_idx, cell_y_idx)) {
            rec.target_afr = target_afr;
            rec.hit_count += 1;
            rec.recommended_value = clamped_ve;
            rec.hit_weighting += sample_weight;
            rec.hit_percentage = 100.0;
        }
    }

    /// Weight higher when the operating point is near the bin center.
    fn bin_proximity_weight(&self, value: f64, bin_idx: usize, bins: &[f64]) -> f64 {
        if bins.is_empty() || bin_idx >= bins.len() {
            return 1.0;
        }
        let center = bins[bin_idx];
        let half_span = if bins.len() == 1 {
            (center.abs() * 0.1).max(50.0)
        } else if bin_idx == 0 {
            ((bins[1] - bins[0]) / 2.0).abs().max(1.0)
        } else if bin_idx + 1 >= bins.len() {
            ((bins[bin_idx] - bins[bin_idx - 1]) / 2.0).abs().max(1.0)
        } else {
            let left = (bins[bin_idx] - bins[bin_idx - 1]) / 2.0;
            let right = (bins[bin_idx + 1] - bins[bin_idx]) / 2.0;
            left.abs().max(right.abs()).max(1.0)
        };
        let dist = (value - center).abs() / half_span;
        // 1.0 at center → 0.25 at / beyond bin edge
        (1.0 - 0.75 * dist.clamp(0.0, 1.0)).clamp(0.25, 1.0)
    }

    /// Down-weight samples during fast throttle changes.
    fn tps_stability_weight(&self, tps_rate: f64) -> f64 {
        let rate = tps_rate.abs();
        if rate < 2.0 {
            1.0
        } else if rate < 8.0 {
            0.6
        } else {
            0.25
        }
    }

    /// Apply authority limits to clamp the recommended VE change
    fn apply_authority_limits(
        beginning_value: f64,
        recommended_value: f64,
        authority: &AutoTuneAuthorityLimits,
    ) -> f64 {
        let delta = recommended_value - beginning_value;

        // Clamp by absolute value change
        let clamped_delta = delta.clamp(
            -authority.max_cell_value_change,
            authority.max_cell_value_change,
        );

        // Clamp by percentage change
        let max_pct_delta = beginning_value * (authority.max_cell_percentage_change / 100.0);
        let final_delta = clamped_delta.clamp(-max_pct_delta, max_pct_delta);

        beginning_value + final_delta
    }

    fn find_bin_index(&self, value: f64, bins: &[f64]) -> Option<usize> {
        if bins.is_empty() {
            return None;
        }

        if let Some((i, _)) = bins
            .iter()
            .enumerate()
            .find(|&(_, bin)| (bin - value).abs() < 0.1)
        {
            return Some(i);
        }

        bins.iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                let da = (*a - value).abs();
                let db = (*b - value).abs();
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i)
    }

    fn evaluate_custom_filter(&self, expr: &str, point: &VEDataPoint) -> Result<bool, String> {
        let mut ctx = HashMapContext::new();

        let set_value = |ctx: &mut HashMapContext, name: &str, value: Value| {
            ctx.set_value(name.to_string(), value)
                .map_err(|e| format!("Failed to set {name}: {e}"))
        };

        set_value(&mut ctx, "rpm", point.rpm.into())?;
        set_value(&mut ctx, "map", point.map.into())?;
        set_value(&mut ctx, "maf", point.maf.into())?;
        set_value(&mut ctx, "load", point.load.into())?;
        set_value(&mut ctx, "afr", point.afr.into())?;
        set_value(&mut ctx, "ve", point.ve.into())?;
        set_value(&mut ctx, "clt", point.clt.into())?;
        set_value(&mut ctx, "tps", point.tps.into())?;
        set_value(&mut ctx, "tps_rate", point.tps_rate.into())?;

        let accel_enrich = point.accel_enrich_active.unwrap_or(false);
        set_value(&mut ctx, "accel_enrich", accel_enrich.into())?;
        set_value(&mut ctx, "accel_enrich_active", accel_enrich.into())?;

        match eval_with_context(expr, &ctx) {
            Ok(Value::Boolean(val)) => Ok(val),
            Ok(Value::Int(val)) => Ok(val != 0),
            Ok(Value::Float(val)) => Ok(val != 0.0),
            Ok(other) => Err(format!(
                "Custom filter must return boolean or number, got {other:?}"
            )),
            Err(e) => Err(format!("Custom filter eval error: {e}")),
        }
    }

    fn passes_filters(&self, point: &VEDataPoint, filters: &AutoTuneFilters) -> bool {
        // Basic RPM and CLT filters
        if point.rpm < filters.min_rpm || point.rpm > filters.max_rpm {
            return false;
        }
        if point.clt < filters.min_clt {
            return false;
        }

        // Transient filtering: reject if TPS is changing too fast
        if point.tps_rate.abs() > filters.max_tps_rate {
            return false;
        }

        // Transient filtering: reject if accel enrichment is active (if flag available)
        if filters.exclude_accel_enrich {
            if let Some(true) = point.accel_enrich_active {
                return false;
            }
        }

        if let Some(ref expr) = filters.custom_filter {
            let trimmed = expr.trim();
            if !trimmed.is_empty() {
                match self.evaluate_custom_filter(trimmed, point) {
                    Ok(true) => {}
                    Ok(false) => return false,
                    Err(e) => {
                        tracing::warn!("AutoTune custom filter rejected data: {e}");
                        return false;
                    }
                }
            }
        }

        true
    }

    fn calculate_required_ve(&self, current_ve: f64, actual_afr: f64, target_afr: f64) -> f64 {
        if actual_afr < 0.1 || target_afr < 0.1 {
            return current_ve;
        }

        // Lean (actual > target) → raise VE; rich (actual < target) → lower VE
        current_ve * (actual_afr / target_afr)
    }

    pub fn get_recommendations(&self) -> Vec<AutoTuneRecommendation> {
        self.recommendations.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::field_reassign_with_default)]
    use super::*;

    #[test]
    fn weighted_favors_bin_center_samples() {
        let mut state = AutoTuneState::default();
        state.start();
        state.set_ve_table(vec![vec![100.0]]);

        let settings = AutoTuneSettings {
            target_afr: 14.7,
            algorithm: "weighted".into(),
            ..AutoTuneSettings::default()
        };
        let filters = AutoTuneFilters {
            min_rpm: 0.0,
            max_rpm: 9000.0,
            min_clt: 0.0,
            max_tps_rate: 1000.0,
            exclude_accel_enrich: false,
            ..AutoTuneFilters::default()
        };
        let authority = AutoTuneAuthorityLimits {
            max_cell_value_change: 50.0,
            max_cell_percentage_change: 100.0,
        };
        let bins_x = [2000.0];
        let bins_y = [50.0];

        // Far from center, very lean reading
        state.add_data_point(
            VEDataPoint {
                rpm: 2800.0,
                load: 50.0,
                afr: 16.0,
                ve: 100.0,
                clt: 80.0,
                tps_rate: 20.0,
                afr_valid: true,
                timestamp_ms: 100,
                ..VEDataPoint::default()
            },
            &bins_x,
            &bins_y,
            &settings,
            &filters,
            &authority,
        );
        // On center, mild lean
        state.add_data_point(
            VEDataPoint {
                rpm: 2000.0,
                load: 50.0,
                afr: 15.0,
                ve: 100.0,
                clt: 80.0,
                tps_rate: 0.0,
                afr_valid: true,
                timestamp_ms: 200,
                ..VEDataPoint::default()
            },
            &bins_x,
            &bins_y,
            &settings,
            &filters,
            &authority,
        );

        let rec = &state.get_recommendations()[0];
        // Centered mild-lean sample should dominate over edge+transient lean spike
        let expected_mild = 100.0 * (15.0 / 14.7);
        assert!(
            (rec.recommended_value - expected_mild).abs() < (rec.recommended_value - 100.0 * 16.0 / 14.7).abs(),
            "weighted rec {} should be closer to mild correction {}",
            rec.recommended_value,
            expected_mild
        );
        assert!(rec.hit_weighting > 1.0);
    }

    #[test]
    fn pid_moves_ve_for_lean_error() {
        let mut state = AutoTuneState::default();
        state.start();
        state.set_ve_table(vec![vec![100.0]]);

        let settings = AutoTuneSettings {
            target_afr: 14.7,
            algorithm: "pid".into(),
            ..AutoTuneSettings::default()
        };
        let filters = AutoTuneFilters {
            min_rpm: 0.0,
            max_rpm: 9000.0,
            min_clt: 0.0,
            max_tps_rate: 1000.0,
            exclude_accel_enrich: false,
            ..AutoTuneFilters::default()
        };
        let authority = AutoTuneAuthorityLimits {
            max_cell_value_change: 50.0,
            max_cell_percentage_change: 100.0,
        };

        for i in 0..5 {
            state.add_data_point(
                VEDataPoint {
                    rpm: 2000.0,
                    load: 50.0,
                    afr: 15.5,
                    ve: 100.0,
                    clt: 80.0,
                    afr_valid: true,
                    timestamp_ms: 100 * (i + 1),
                    ..VEDataPoint::default()
                },
                &[2000.0],
                &[50.0],
                &settings,
                &filters,
                &authority,
            );
        }

        let rec = &state.get_recommendations()[0];
        assert!(rec.recommended_value > 100.0, "PID should raise VE when lean");
    }

    #[test]
    fn algorithm_kind_parses() {
        assert_eq!(
            AutoTuneSettings {
                algorithm: "WeIgHtEd".into(),
                ..Default::default()
            }
            .algorithm_kind(),
            AutotuneAlgorithm::Weighted
        );
        assert_eq!(
            AutoTuneSettings {
                algorithm: "pid".into(),
                ..Default::default()
            }
            .algorithm_kind(),
            AutotuneAlgorithm::Pid
        );
        assert_eq!(
            AutoTuneSettings::default().algorithm_kind(),
            AutotuneAlgorithm::Simple
        );
    }

    #[test]
    fn reading_to_afr_converts_lambda() {
        assert!((reading_to_afr(1.0) - 14.7).abs() < 1e-9);
        assert!((reading_to_afr(14.7) - 14.7).abs() < 1e-9);
    }

    #[test]
    fn required_ve_uses_target_not_stoich() {
        let state = AutoTuneState::default();
        // Actual leaner than target 12.5 → need more fuel
        let ve = state.calculate_required_ve(100.0, 13.5, 12.5);
        assert!(ve > 100.0);
        assert!((ve - 108.0).abs() < 0.01);

        // Actual richer than target → need less fuel
        let ve_rich = state.calculate_required_ve(100.0, 11.5, 12.5);
        assert!(ve_rich < 100.0);
    }

    #[test]
    fn add_data_point_uses_settings_target_and_table_ve() {
        let mut state = AutoTuneState::default();
        state.start();
        state.set_ve_table(vec![vec![50.0, 60.0], vec![70.0, 80.0]]);

        let settings = AutoTuneSettings {
            target_afr: 12.5,
            ..AutoTuneSettings::default()
        };
        let filters = AutoTuneFilters {
            min_rpm: 0.0,
            max_rpm: 9000.0,
            min_clt: 0.0,
            max_tps_rate: 1000.0,
            exclude_accel_enrich: false,
            ..AutoTuneFilters::default()
        };
        let authority = AutoTuneAuthorityLimits {
            max_cell_value_change: 50.0,
            max_cell_percentage_change: 100.0,
        };

        let point = VEDataPoint {
            rpm: 1000.0,
            load: 20.0,
            map: 20.0,
            afr: 14.7, // lean vs 12.5 target
            ve: 0.0,   // channel missing — must use table
            clt: 80.0,
            afr_valid: true,
            timestamp_ms: 1000,
            ..VEDataPoint::default()
        };

        state.add_data_point(
            point,
            &[500.0, 1000.0],
            &[20.0, 40.0],
            &settings,
            &filters,
            &authority,
        );

        let recs = state.get_recommendations();
        assert_eq!(recs.len(), 1);
        assert!((recs[0].beginning_value - 60.0).abs() < 1e-6); // table[0][1] nearest
        assert!((recs[0].target_afr - 12.5).abs() < 1e-6);
        assert!(recs[0].recommended_value > recs[0].beginning_value);
    }

    #[test]
    fn invalid_afr_is_ignored() {
        let mut state = AutoTuneState::default();
        state.start();
        state.set_ve_table(vec![vec![50.0]]);

        let settings = AutoTuneSettings::default();
        let filters = AutoTuneFilters {
            min_rpm: 0.0,
            max_rpm: 9000.0,
            min_clt: 0.0,
            max_tps_rate: 1000.0,
            exclude_accel_enrich: false,
            ..AutoTuneFilters::default()
        };
        let authority = AutoTuneAuthorityLimits::default();

        let point = VEDataPoint {
            rpm: 2000.0,
            load: 50.0,
            afr: 0.0,
            ve: 50.0,
            clt: 80.0,
            afr_valid: false,
            timestamp_ms: 100,
            ..VEDataPoint::default()
        };

        state.add_data_point(
            point,
            &[2000.0],
            &[50.0],
            &settings,
            &filters,
            &authority,
        );
        assert!(state.get_recommendations().is_empty());
    }

    #[test]
    fn custom_filter_allows_matching_point() {
        let state = AutoTuneState::default();
        let mut filters = AutoTuneFilters::default();
        filters.custom_filter = Some("rpm > 2000 && tps < 50 && clt > 70".to_string());
        filters.min_clt = 70.0;

        let point = VEDataPoint {
            rpm: 2500.0,
            tps: 25.0,
            clt: 85.0,
            ..VEDataPoint::default()
        };

        assert!(state.passes_filters(&point, &filters));
    }

    #[test]
    fn custom_filter_rejects_non_matching_point() {
        let state = AutoTuneState::default();
        let mut filters = AutoTuneFilters::default();
        filters.custom_filter = Some("rpm > 2000 && tps < 50".to_string());
        filters.min_clt = 0.0;

        let point = VEDataPoint {
            rpm: 1500.0,
            tps: 25.0,
            clt: 85.0,
            ..VEDataPoint::default()
        };

        assert!(!state.passes_filters(&point, &filters));
    }

    #[test]
    fn custom_filter_handles_accel_enrich_flag() {
        let state = AutoTuneState::default();
        let mut filters = AutoTuneFilters::default();
        filters.custom_filter = Some("!accel_enrich".to_string());
        filters.min_clt = 0.0;
        filters.exclude_accel_enrich = false;

        let mut point = VEDataPoint {
            rpm: 2500.0,
            clt: 85.0,
            accel_enrich_active: Some(false),
            ..VEDataPoint::default()
        };
        assert!(state.passes_filters(&point, &filters));

        point.accel_enrich_active = Some(true);
        assert!(!state.passes_filters(&point, &filters));
    }

    #[test]
    fn custom_filter_invalid_expression_rejects_point() {
        let state = AutoTuneState::default();
        let mut filters = AutoTuneFilters::default();
        filters.custom_filter = Some("rpm >".to_string());
        filters.min_clt = 0.0;

        let point = VEDataPoint {
            rpm: 2500.0,
            ..VEDataPoint::default()
        };

        assert!(!state.passes_filters(&point, &filters));
    }
}
