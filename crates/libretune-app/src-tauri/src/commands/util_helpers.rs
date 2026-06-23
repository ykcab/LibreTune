//! Small helper functions extracted from lib.rs.

use crate::commands::constant_values::read_constant_from_cache_or_tune;
use libretune_core::ini::{DataType, EcuDefinition};
use libretune_core::tune::{TuneCache, TuneFile};

/// Parse a runtime packet mode string into enum
pub(crate) fn parse_runtime_packet_mode(mode: &str) -> libretune_core::protocol::RuntimePacketMode {
    use libretune_core::protocol::RuntimePacketMode as Rpm;
    match mode {
        "ForceBurst" => Rpm::ForceBurst,
        "ForceOCH" => Rpm::ForceOCH,
        "Disabled" => Rpm::Disabled,
        _ => Rpm::Auto,
    }
}

/// Returns 0xFF if bits >= 8, otherwise (1u8 << bits) - 1.
#[allow(dead_code)]
#[inline]
pub(crate) fn bit_mask_u8(bits: u8) -> u8 {
    if bits >= 8 {
        0xFF
    } else {
        (1u8 << bits) - 1
    }
}

/// Clean up INI expression labels for display
/// Converts expressions like `{bitStringValue(pwmAxisLabels, gppwm1_loadAxis)}`
/// to a readable fallback like `gppwm1_loadAxis`
pub(crate) fn clean_axis_label(label: &str) -> String {
    let trimmed = label.trim();

    // If it's an expression (starts with {), try to extract meaningful part
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        // Extract content inside braces
        let inner = &trimmed[1..trimmed.len() - 1];

        // Check for bitStringValue(list, index) pattern
        if inner.starts_with("bitStringValue(") {
            // Extract the second parameter (the index variable name)
            if let Some(comma_pos) = inner.find(',') {
                let second_part = inner[comma_pos + 1..].trim();
                // Remove trailing ) if present
                let name = second_part.trim_end_matches(')').trim();
                if !name.is_empty() {
                    return name.to_string();
                }
            }
        }

        // Fallback: just return the inner content without braces
        return inner.to_string();
    }

    // Not an expression, return as-is
    trimmed.to_string()
}

/// Resolve a table axis label expression using tune constant values.
///
/// Evaluates `bitStringValue(optionList, indexConstant)` against the loaded tune
/// (e.g. `{bitStringValue(pwmAxisLabels, gppwm1_rpmAxis)}` → `"RPM"`).
pub(crate) fn resolve_table_axis_label(
    label: &str,
    def: &EcuDefinition,
    tune: Option<&TuneFile>,
    cache: Option<&TuneCache>,
) -> String {
    let trimmed = label.trim();

    if trimmed.starts_with('"') && trimmed.ends_with('"') {
        return trimmed.trim_matches('"').to_string();
    }

    let inner = if trimmed.starts_with('{') && trimmed.ends_with('}') {
        trimmed[1..trimmed.len() - 1].trim()
    } else {
        trimmed
    };

    if let Some(resolved) = try_resolve_bit_string_value(inner, def, tune, cache) {
        return resolved;
    }

    clean_axis_label(label)
}

fn try_resolve_bit_string_value(
    inner: &str,
    def: &EcuDefinition,
    tune: Option<&TuneFile>,
    cache: Option<&TuneCache>,
) -> Option<String> {
    let rest = inner.strip_prefix("bitStringValue(")?;
    let rest = rest.strip_suffix(')')?;
    let comma = rest.find(',')?;
    let list_name = rest[..comma].trim();
    let index_var = rest[comma + 1..].trim();

    let list_const = def.constants.get(list_name)?;
    let index_const = def.constants.get(index_var)?;
    let index = read_constant_from_cache_or_tune(
        index_var,
        index_const,
        def.endianness,
        tune,
        cache,
    ) as usize;

    let option = list_const.bit_options.get(index)?;
    let opt = option.trim();
    if opt.is_empty() || opt.eq_ignore_ascii_case("INVALID") {
        return None;
    }
    Some(opt.to_string())
}

#[cfg(test)]
mod axis_label_tests {
    use super::*;
    use libretune_core::ini::{Constant, DataType, EcuDefinition, Shape};
    use libretune_core::tune::{TuneFile, TuneValue};

    fn sample_def() -> EcuDefinition {
        let mut def = EcuDefinition::default();
        def.constants.insert(
            "pwmAxisLabels".to_string(),
            Constant {
                name: "pwmAxisLabels".to_string(),
                data_type: DataType::Bits,
                bit_options: vec![
                    "Zero".into(),
                    "TPS %".into(),
                    "MAP kPa".into(),
                    "RPM".into(),
                ],
                ..Default::default()
            },
        );
        def.constants.insert(
            "gppwm1_rpmAxis".to_string(),
            Constant {
                name: "gppwm1_rpmAxis".to_string(),
                data_type: DataType::Bits,
                shape: Shape::Scalar,
                ..Default::default()
            },
        );
        def
    }

    #[test]
    fn resolve_bit_string_value_axis_label() {
        let def = sample_def();
        let mut tune = TuneFile::default();
        tune.constants
            .insert("gppwm1_rpmAxis".to_string(), TuneValue::Scalar(3.0));

        let label = "{bitStringValue(pwmAxisLabels, gppwm1_rpmAxis)}";
        assert_eq!(
            resolve_table_axis_label(label, &def, Some(&tune), None),
            "RPM"
        );
    }

    #[test]
    fn resolve_quoted_literal_axis_label() {
        let def = EcuDefinition::default();
        assert_eq!(
            resolve_table_axis_label("\"MAP\"", &def, None, None),
            "MAP"
        );
    }

    #[test]
    fn infer_z_output_channel_maps_gppwm_and_user_tables() {
        assert_eq!(
            infer_z_output_channel(&Some("gppwmXAxis1".to_string())),
            Some("gppwmOutput1".to_string())
        );
        assert_eq!(
            infer_z_output_channel(&Some("utXAxis2".to_string())),
            Some("utOutput2".to_string())
        );
        assert_eq!(
            infer_z_output_channel(&Some("userTableXAxis3".to_string())),
            Some("userTableOutput3".to_string())
        );
        assert_eq!(infer_z_output_channel(&None), None);
    }
}

/// Infer the Z/output channel for a table from its X live channel name.
/// e.g. gppwmXAxis1 -> gppwmOutput1, utXAxis2 -> utOutput2
pub(crate) fn infer_z_output_channel(x_output_channel: &Option<String>) -> Option<String> {
    let x = x_output_channel.as_ref()?;
    for prefix in ["gppwmXAxis", "utXAxis", "userTableXAxis"] {
        if let Some(suffix) = x.strip_prefix(prefix) {
            let out_prefix = match prefix {
                "gppwmXAxis" => "gppwmOutput",
                "utXAxis" => "utOutput",
                "userTableXAxis" => "userTableOutput",
                _ => return None,
            };
            return Some(format!("{out_prefix}{suffix}"));
        }
    }
    None
}

/// Helper to write stream diagnostic logs to /tmp/libretune-stream.log
pub(crate) fn stream_log(msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/libretune-stream.log")
    {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let _ = writeln!(f, "[{:.3}] {}", now.as_secs_f64(), msg);
    }
}

/// Global tracker for who currently holds the connection lock.
/// Used for diagnostics only — helps identify which command is blocking the stream.
static CONN_LOCK_HOLDER: std::sync::Mutex<&str> = std::sync::Mutex::new("(none)");

pub(crate) fn set_conn_lock_holder(who: &'static str) {
    if let Ok(mut guard) = CONN_LOCK_HOLDER.lock() {
        *guard = who;
    }
}

pub(crate) fn get_conn_lock_holder() -> String {
    CONN_LOCK_HOLDER
        .lock()
        .map(|g| g.to_string())
        .unwrap_or_else(|_| "(poisoned)".to_string())
}

/// Read a raw numeric value from bytes based on data type
pub(crate) fn read_raw_value(bytes: &[u8], data_type: &DataType) -> Result<f64, String> {
    use byteorder::{BigEndian, ByteOrder};

    Ok(match data_type {
        DataType::U08 => bytes.first().map(|b| *b as f64).ok_or("No data")?,
        DataType::S08 => bytes.first().map(|b| *b as i8 as f64).ok_or("No data")?,
        DataType::U16 => {
            if bytes.len() >= 2 {
                BigEndian::read_u16(bytes) as f64
            } else {
                return Err("Insufficient data for U16".to_string());
            }
        }
        DataType::S16 => {
            if bytes.len() >= 2 {
                BigEndian::read_i16(bytes) as f64
            } else {
                return Err("Insufficient data for S16".to_string());
            }
        }
        DataType::U32 => {
            if bytes.len() >= 4 {
                BigEndian::read_u32(bytes) as f64
            } else {
                return Err("Insufficient data for U32".to_string());
            }
        }
        DataType::S32 => {
            if bytes.len() >= 4 {
                BigEndian::read_i32(bytes) as f64
            } else {
                return Err("Insufficient data for S32".to_string());
            }
        }
        DataType::F32 => {
            if bytes.len() >= 4 {
                BigEndian::read_f32(bytes) as f64
            } else {
                return Err("Insufficient data for F32".to_string());
            }
        }
        DataType::F64 => {
            if bytes.len() >= 8 {
                BigEndian::read_f64(bytes)
            } else {
                return Err("Insufficient data for F64".to_string());
            }
        }
        DataType::Bits => bytes.first().map(|b| *b as f64).ok_or("No data")?,
        DataType::String => 0.0, // Strings don't have numeric values
    })
}
