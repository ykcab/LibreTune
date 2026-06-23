//! Default dashboard templates for LibreTune.
//!
//! This module provides pre-configured dashboard layouts that match
//! common ECU tuning workflows with professional visual design.

use super::{
    BackgroundStyle, Bibliography, DashComponent, DashFile, GaugeCluster, GaugeConfig,
    GaugePainter, TsColor, VersionInfo,
};
use chrono;

// LibreTune brand colors - consistent dark theme with vibrant accents
const LT_DARKER_BG: TsColor = TsColor {
    alpha: 255,
    red: 12,
    green: 14,
    blue: 20,
};
const LT_CARD_BG: TsColor = TsColor {
    alpha: 230,
    red: 24,
    green: 26,
    blue: 36,
};
const LT_ACCENT_BLUE: TsColor = TsColor {
    alpha: 255,
    red: 74,
    green: 158,
    blue: 248,
};
const LT_ACCENT_TEAL: TsColor = TsColor {
    alpha: 255,
    red: 56,
    green: 189,
    blue: 248,
};
const LT_ACCENT_AMBER: TsColor = TsColor {
    alpha: 255,
    red: 251,
    green: 191,
    blue: 36,
};
const LT_ACCENT_GREEN: TsColor = TsColor {
    alpha: 255,
    red: 34,
    green: 197,
    blue: 94,
};
const LT_ACCENT_RED: TsColor = TsColor {
    alpha: 255,
    red: 239,
    green: 68,
    blue: 68,
};
const LT_TEXT_PRIMARY: TsColor = TsColor {
    alpha: 255,
    red: 255,
    green: 255,
    blue: 255,
};
const LT_TEXT_SECONDARY: TsColor = TsColor {
    alpha: 255,
    red: 148,
    green: 163,
    blue: 184,
};
const LT_WARN_COLOR: TsColor = TsColor {
    alpha: 255,
    red: 234,
    green: 179,
    blue: 8,
};
const LT_CRITICAL_COLOR: TsColor = TsColor {
    alpha: 255,
    red: 239,
    green: 68,
    blue: 68,
};

const LT_TRANSPARENT: TsColor = TsColor {
    alpha: 0,
    red: 0,
    green: 0,
    blue: 0,
};

/// Premium stat widget — dark card, large number (modern dashboard).
fn stat_tile(
    id: &str,
    title: &str,
    channel: &str,
    units: &str,
    min: f64,
    max: f64,
    value_digits: i32,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    font_color: TsColor,
) -> DashComponent {
    DashComponent::Gauge(Box::new(GaugeConfig {
        id: id.to_string(),
        title: title.to_string(),
        units: units.to_string(),
        output_channel: channel.to_string(),
        min,
        max,
        value_digits,
        gauge_painter: GaugePainter::BasicReadout,
        gauge_style: "stat".to_string(),
        relative_x: x,
        relative_y: y,
        relative_width: w,
        relative_height: h,
        back_color: LT_CARD_BG,
        font_color,
        trim_color: LT_TEXT_SECONDARY,
        warn_color: LT_WARN_COLOR,
        critical_color: LT_CRITICAL_COLOR,
        ..Default::default()
    }))
}

/// Gradient ring gauge — modern circular progress (reference dashboard style).
fn modern_ring(
    id: &str,
    title: &str,
    channel: &str,
    units: &str,
    min: f64,
    max: f64,
    value_digits: i32,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    accent: TsColor,
    low_warning: Option<f64>,
    high_warning: Option<f64>,
) -> DashComponent {
    DashComponent::Gauge(Box::new(GaugeConfig {
        id: id.to_string(),
        title: title.to_string(),
        units: units.to_string(),
        output_channel: channel.to_string(),
        min,
        max,
        low_warning,
        high_warning,
        value_digits,
        gauge_painter: GaugePainter::RoundGauge,
        gauge_style: "modern".to_string(),
        start_angle: 135,
        sweep_angle: 270,
        relative_x: x,
        relative_y: y,
        relative_width: w,
        relative_height: h,
        back_color: LT_TRANSPARENT,
        font_color: LT_TEXT_PRIMARY,
        needle_color: accent,
        trim_color: LT_TEXT_SECONDARY,
        warn_color: LT_WARN_COLOR,
        critical_color: LT_CRITICAL_COLOR,
        font_size_adjustment: 1,
        ..Default::default()
    }))
}

/// Create a basic dashboard layout - LibreTune default
/// Modern command-center dashboard — gradient rings + stat cards, not TS-style gauges.
pub fn create_basic_dashboard() -> DashFile {
    let mut dash = DashFile {
        bibliography: Bibliography {
            author: "LibreTune".to_string(),
            company: "LibreTune Project".to_string(),
            write_date: chrono::Utc::now().format("%Y-%m-%d").to_string(),
        },
        version_info: VersionInfo {
            file_format: "3.0".to_string(),
            firmware_signature: None,
        },
        gauge_cluster: GaugeCluster {
            anti_aliasing: true,
            force_aspect: false,
            force_aspect_width: 0.0,
            force_aspect_height: 0.0,
            cluster_background_color: LT_DARKER_BG,
            background_dither_color: None,
            cluster_background_image_file_name: None,
            cluster_background_image_style: BackgroundStyle::Stretch,
            embedded_images: Vec::new(),
            components: Vec::new(),
            cluster_layout: None,
            enabled_condition: None,
            extra_attrs: std::collections::BTreeMap::new(),
        },
        additional_clusters: Vec::new(),
        extra_attrs: std::collections::BTreeMap::new(),
    };

    // TOP — live telemetry stat cards
    let top_y = 0.02;
    let top_h = 0.11;
    let top_w = 0.118;
    let mut col = 0.012;
    for (id, title, ch, units, min, max, digits, color) in [
        ("map", "MAP", "map", "kPa", 0.0, 250.0, 0, LT_ACCENT_TEAL),
        ("tps", "TPS", "tps", "%", 0.0, 100.0, 0, LT_ACCENT_AMBER),
        ("coolant", "CLT", "coolant", "°C", -40.0, 120.0, 0, LT_ACCENT_BLUE),
        ("iat", "IAT", "iat", "°C", -40.0, 80.0, 0, LT_ACCENT_AMBER),
        ("oilpres", "OIL P", "oilPressure", "kPa", 0.0, 800.0, 0, LT_ACCENT_AMBER),
        ("oiltemp", "OIL T", "oilTemp", "°C", -40.0, 150.0, 0, LT_ACCENT_AMBER),
        ("lpfp", "LPFP", "lowFuelPressure", "kPa", 0.0, 800.0, 0, LT_ACCENT_TEAL),
        ("hpfp", "HPFP", "highFuelPressure", "bar", 0.0, 300.0, 0, LT_ACCENT_GREEN),
    ] {
        dash.gauge_cluster.components.push(stat_tile(
            id, title, ch, units, min, max, digits, col, top_y, top_w, top_h, color,
        ));
        col += top_w + 0.006;
    }

    // CENTER — hero RPM ring + AFR ring + lambda trend
    dash.gauge_cluster.components.push(modern_ring(
        "rpm", "RPM", "rpm", "rpm", 0.0, 8000.0, 0, 0.03, 0.15, 0.34, 0.58, LT_ACCENT_AMBER,
        None, Some(6500.0),
    ));
    dash.gauge_cluster.components.push(modern_ring(
        "afr", "AFR", "afr", ":1", 10.0, 20.0, 1, 0.39, 0.15, 0.24, 0.42, LT_ACCENT_GREEN,
        Some(11.5), Some(16.0),
    ));
    dash.gauge_cluster
        .components
        .push(DashComponent::Gauge(Box::new(GaugeConfig {
            id: "lambda_trend".to_string(),
            title: "LAMBDA".to_string(),
            units: "λ".to_string(),
            output_channel: "lambda".to_string(),
            min: 0.7,
            max: 1.3,
            value_digits: 3,
            gauge_painter: GaugePainter::LineGraph,
            gauge_style: "modern".to_string(),
            relative_x: 0.65,
            relative_y: 0.15,
            relative_width: 0.34,
            relative_height: 0.58,
            back_color: LT_CARD_BG,
            font_color: LT_ACCENT_TEAL,
            needle_color: LT_ACCENT_TEAL,
            trim_color: LT_TEXT_SECONDARY,
            warn_color: LT_WARN_COLOR,
            critical_color: LT_CRITICAL_COLOR,
            show_history: true,
            ..Default::default()
        })));

    // BOTTOM — engine load / fuel / ignition stats
    let bot_y = 0.76;
    let bot_h = 0.11;
    let bot_w = 0.118;
    col = 0.012;
    for (id, title, ch, units, min, max, digits, color) in [
        ("ve", "VE", "ve", "%", 0.0, 150.0, 0, LT_TEXT_PRIMARY),
        ("advance", "TIMING", "advance", "°", -10.0, 50.0, 1, LT_ACCENT_AMBER),
        ("pw", "PULSE", "pulseWidth", "ms", 0.0, 25.0, 2, LT_ACCENT_BLUE),
        ("duty", "DUTY", "dutyCycle", "%", 0.0, 100.0, 0, LT_ACCENT_TEAL),
        ("boost", "BOOST", "boost", "kPa", 0.0, 300.0, 0, LT_ACCENT_TEAL),
        ("lambda", "LAMBDA", "lambda", "λ", 0.7, 1.3, 3, LT_ACCENT_GREEN),
        ("battery", "BATT", "battery", "V", 10.0, 16.0, 1, LT_TEXT_PRIMARY),
        ("speed", "SPEED", "speed", "km/h", 0.0, 300.0, 0, LT_ACCENT_GREEN),
    ] {
        dash.gauge_cluster.components.push(stat_tile(
            id, title, ch, units, min, max, digits, col, bot_y, bot_w, bot_h, color,
        ));
        col += bot_w + 0.006;
    }

    dash
}

/// Create a racing-focused dashboard — hero RPM ring with critical stat cards
pub fn create_racing_dashboard() -> DashFile {
    let mut dash = DashFile {
        bibliography: Bibliography {
            author: "LibreTune".to_string(),
            company: "LibreTune Project".to_string(),
            write_date: chrono::Utc::now().format("%Y-%m-%d").to_string(),
        },
        version_info: VersionInfo {
            file_format: "3.0".to_string(),
            firmware_signature: None,
        },
        gauge_cluster: GaugeCluster {
            anti_aliasing: true,
            force_aspect: false,
            force_aspect_width: 0.0,
            force_aspect_height: 0.0,
            cluster_background_color: LT_DARKER_BG,
            background_dither_color: None,
            cluster_background_image_file_name: None,
            cluster_background_image_style: BackgroundStyle::Stretch,
            embedded_images: Vec::new(),
            components: Vec::new(),
            cluster_layout: None,
            enabled_condition: None,
            extra_attrs: std::collections::BTreeMap::new(),
        },
        additional_clusters: Vec::new(),
        extra_attrs: std::collections::BTreeMap::new(),
    };

    // Side stat cards — oil / water / fuel pressure
    dash.gauge_cluster.components.push(stat_tile(
        "oilpres", "OIL P", "oilPressure", "kPa", 0.0, 800.0, 0, 0.02, 0.10, 0.14, 0.18,
        LT_ACCENT_AMBER,
    ));
    dash.gauge_cluster.components.push(stat_tile(
        "oiltemp", "OIL T", "oilTemp", "°C", -40.0, 150.0, 0, 0.02, 0.29, 0.14, 0.18,
        LT_ACCENT_AMBER,
    ));
    dash.gauge_cluster.components.push(stat_tile(
        "lpfp", "LPFP", "lowFuelPressure", "kPa", 0.0, 800.0, 0, 0.35, 0.02, 0.14, 0.10,
        LT_ACCENT_TEAL,
    ));
    dash.gauge_cluster.components.push(stat_tile(
        "hpfp", "HPFP", "highFuelPressure", "bar", 0.0, 300.0, 0, 0.51, 0.02, 0.14, 0.10,
        LT_ACCENT_GREEN,
    ));
    dash.gauge_cluster.components.push(stat_tile(
        "coolant", "WATER", "coolant", "°C", 0.0, 130.0, 0, 0.84, 0.10, 0.14, 0.37,
        LT_ACCENT_BLUE,
    ));

    // HERO — massive RPM gradient ring
    dash.gauge_cluster.components.push(modern_ring(
        "rpm", "RPM", "rpm", "rpm", 0.0, 10000.0, 0, 0.18, 0.06, 0.64, 0.68, LT_ACCENT_RED,
        None, Some(8000.0),
    ));

    // Bottom racing readouts
    let bot_y = 0.78;
    let bot_h = 0.18;
    let tile_w = 0.22;
    let mut col = 0.02;
    for (id, title, ch, units, min, max, digits, color) in [
        ("speed", "SPEED", "speed", "km/h", 0.0, 300.0, 0, LT_TEXT_PRIMARY),
        ("afr", "AFR", "afr", ":1", 10.0, 20.0, 1, LT_ACCENT_GREEN),
        ("boost", "BOOST", "boost", "kPa", 0.0, 300.0, 0, LT_ACCENT_TEAL),
        ("fuel", "FUEL", "fuelLevel", "%", 0.0, 100.0, 0, LT_ACCENT_AMBER),
    ] {
        dash.gauge_cluster.components.push(stat_tile(
            id, title, ch, units, min, max, digits, col, bot_y, tile_w, bot_h, color,
        ));
        col += tile_w + 0.02;
    }

    dash
}

/// Tuning command-center dashboard — dense ECU telemetry with frameless RPM dial
/// and lambda trend as the main visual. MAP/TPS/temps are compact numbers, not bars.
pub fn create_tuning_dashboard() -> DashFile {
    let mut dash = DashFile {
        bibliography: Bibliography {
            author: "LibreTune".to_string(),
            company: "LibreTune Project".to_string(),
            write_date: chrono::Utc::now().format("%Y-%m-%d").to_string(),
        },
        version_info: VersionInfo {
            file_format: "3.0".to_string(),
            firmware_signature: None,
        },
        gauge_cluster: GaugeCluster {
            anti_aliasing: true,
            force_aspect: false,
            force_aspect_width: 0.0,
            force_aspect_height: 0.0,
            cluster_background_color: LT_DARKER_BG,
            background_dither_color: None,
            cluster_background_image_file_name: None,
            cluster_background_image_style: BackgroundStyle::Stretch,
            embedded_images: Vec::new(),
            components: Vec::new(),
            cluster_layout: None,
            enabled_condition: None,
            extra_attrs: std::collections::BTreeMap::new(),
        },
        additional_clusters: Vec::new(),
        extra_attrs: std::collections::BTreeMap::new(),
    };

    // TOP TELEMETRY STRIP — stat cards
    let top_y = 0.02;
    let top_h = 0.10;
    let top_w = 0.088;
    let mut col = 0.02;
    for (id, title, ch, units, min, max, digits, color) in [
        ("map", "MAP", "map", "kPa", 0.0, 250.0, 0, LT_ACCENT_TEAL),
        ("tps", "TPS", "tps", "%", 0.0, 100.0, 0, LT_ACCENT_AMBER),
        ("coolant", "CLT", "coolant", "°C", -40.0, 120.0, 0, LT_ACCENT_BLUE),
        ("iat", "IAT", "iat", "°C", -40.0, 80.0, 0, LT_ACCENT_AMBER),
        ("oilpres", "OIL P", "oilPressure", "kPa", 0.0, 800.0, 0, LT_ACCENT_AMBER),
        ("oiltemp", "OIL T", "oilTemp", "°C", -40.0, 150.0, 0, LT_ACCENT_AMBER),
        ("lpfp", "LPFP", "lowFuelPressure", "kPa", 0.0, 800.0, 0, LT_ACCENT_TEAL),
        ("hpfp", "HPFP", "highFuelPressure", "bar", 0.0, 300.0, 0, LT_ACCENT_GREEN),
        ("battery", "BATT", "battery", "V", 10.0, 16.0, 1, LT_TEXT_PRIMARY),
        ("baro", "BARO", "baro", "kPa", 80.0, 110.0, 0, LT_TEXT_SECONDARY),
        ("speed", "SPEED", "speed", "km/h", 0.0, 300.0, 0, LT_ACCENT_GREEN),
    ] {
        dash.gauge_cluster.components.push(stat_tile(
            id, title, ch, units, min, max, digits, col, top_y, top_w, top_h, color,
        ));
        col += top_w + 0.005;
    }

    // PRIMARY — RPM + AFR rings, lambda trend
    dash.gauge_cluster.components.push(modern_ring(
        "rpm", "RPM", "rpm", "rpm", 0.0, 8000.0, 0, 0.02, 0.14, 0.28, 0.58, LT_ACCENT_AMBER,
        None, Some(6500.0),
    ));
    dash.gauge_cluster.components.push(modern_ring(
        "afr", "AFR", "afr", ":1", 10.0, 20.0, 1, 0.32, 0.14, 0.20, 0.42, LT_ACCENT_GREEN,
        Some(11.5), Some(16.0),
    ));

    dash.gauge_cluster
        .components
        .push(DashComponent::Gauge(Box::new(GaugeConfig {
            id: "lambda_hist".to_string(),
            title: "LAMBDA TREND".to_string(),
            units: "λ".to_string(),
            output_channel: "lambda".to_string(),
            min: 0.7,
            max: 1.3,
            low_warning: Some(0.75),
            high_warning: Some(1.1),
            value_digits: 3,
            gauge_painter: GaugePainter::LineGraph,
            gauge_style: "modern".to_string(),
            relative_x: 0.54,
            relative_y: 0.14,
            relative_width: 0.44,
            relative_height: 0.58,
            back_color: LT_CARD_BG,
            font_color: LT_ACCENT_GREEN,
            needle_color: LT_ACCENT_TEAL,
            trim_color: LT_TEXT_SECONDARY,
            warn_color: LT_WARN_COLOR,
            critical_color: LT_CRITICAL_COLOR,
            show_history: true,
            ..Default::default()
        })));

    // BOTTOM ROW 1 — fuel / ignition / engine load
    let row1_y = 0.76;
    let row_h = 0.10;
    let tile_w = 0.115;
    col = 0.02;
    for (id, title, ch, units, min, max, digits, color) in [
        ("ve", "VE", "ve", "%", 0.0, 150.0, 0, LT_TEXT_PRIMARY),
        ("pw", "PULSE", "pulseWidth", "ms", 0.0, 25.0, 2, LT_ACCENT_BLUE),
        ("duty", "DUTY", "dutyCycle", "%", 0.0, 100.0, 0, LT_ACCENT_AMBER),
        ("advance", "TIMING", "advance", "°", -10.0, 50.0, 1, LT_ACCENT_TEAL),
        ("egt", "EGT", "egt", "°C", 0.0, 1000.0, 0, LT_ACCENT_RED),
        ("lambda", "LAMBDA", "lambda", "λ", 0.7, 1.3, 3, LT_ACCENT_GREEN),
        ("boost", "BOOST", "boost", "kPa", 0.0, 300.0, 0, LT_ACCENT_TEAL),
    ] {
        dash.gauge_cluster.components.push(stat_tile(
            id, title, ch, units, min, max, digits, col, row1_y, tile_w, row_h, color,
        ));
        col += tile_w + 0.005;
    }

    // BOTTOM ROW 2 — targets / corrections
    let row2_y = 0.88;
    let row2_h = 0.10;
    col = 0.02;
    for (id, title, ch, units, min, max, digits, color) in [
        ("afrtarget", "AFR TGT", "afrTarget", ":1", 10.0, 20.0, 1, LT_TEXT_SECONDARY),
        ("corr", "CORR", "correction", "%", 0.0, 200.0, 0, LT_TEXT_SECONDARY),
        ("fuel", "FUEL", "fuelLevel", "%", 0.0, 100.0, 0, LT_ACCENT_AMBER),
        ("sync", "SYNC", "sync", "", 0.0, 1.0, 0, LT_ACCENT_GREEN),
    ] {
        dash.gauge_cluster.components.push(stat_tile(
            id, title, ch, units, min, max, digits, col, row2_y, 0.155, row2_h, color,
        ));
        col += 0.16;
    }

    dash
}
