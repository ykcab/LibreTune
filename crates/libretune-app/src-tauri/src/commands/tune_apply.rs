//! Apply MSQ constants onto page buffers safely.
//!
//! TunerStudio-style `.msq` files usually store named constants, not full page
//! images. Painting those onto zeroed pages and writing the result to the ECU
//! zeros/corrupts every field the MSQ did not define. Always start from a real
//! ECU page base (or complete `<pageData>`), then overlay constants.

use libretune_core::ini::{DataType, EcuDefinition};
use libretune_core::tune::{TuneCache, TuneFile, TuneValue};
use std::collections::HashMap;

/// Build full page images = `ecu_base` + optional complete MSQ page blobs + MSQ constants.
pub fn materialize_project_pages(
    def: &EcuDefinition,
    project_tune: &TuneFile,
    ecu_base: &HashMap<u8, Vec<u8>>,
) -> HashMap<u8, Vec<u8>> {
    let mut cache = TuneCache::from_definition(def);

    for page in 0..def.n_pages {
        if let Some(data) = ecu_base.get(&page) {
            cache.load_page(page, data.clone());
        }
    }

    // Complete raw page blobs from the MSQ replace the ECU base for that page.
    for (page_num, page_data) in &project_tune.pages {
        let expected = def
            .page_sizes
            .get(*page_num as usize)
            .copied()
            .unwrap_or(0) as usize;
        if expected > 0 && page_data.len() == expected {
            cache.load_page(*page_num, page_data.clone());
        }
    }

    apply_tune_constants_to_cache(&mut cache, def, project_tune);

    let mut pages = HashMap::new();
    for page in 0..cache.page_count() {
        if let Some(data) = cache.get_page(page) {
            pages.insert(page, data.to_vec());
        }
    }
    pages
}

/// Overlay `tune.constants` onto an existing cache (bits use read-modify-write).
pub fn apply_tune_constants_to_cache(
    cache: &mut TuneCache,
    def: &EcuDefinition,
    tune: &TuneFile,
) {
    for (name, tune_value) in &tune.constants {
        let Some(constant) = def.constants.get(name) else {
            continue;
        };
        if constant.is_pc_variable {
            match tune_value {
                TuneValue::Scalar(v) => {
                    cache.local_values.insert(name.clone(), *v);
                }
                TuneValue::Array(arr) if !arr.is_empty() => {
                    cache.local_values.insert(name.clone(), arr[0]);
                }
                _ => {}
            }
            continue;
        }

        if constant.data_type == DataType::Bits {
            apply_bits_constant(cache, constant, tune_value);
            continue;
        }

        let length = constant.size_bytes() as u16;
        if length == 0 {
            continue;
        }

        let element_size = constant.data_type.size_bytes();
        let element_count = constant.shape.element_count();
        let mut raw_data = vec![0u8; length as usize];

        match tune_value {
            TuneValue::Scalar(v) => {
                let raw_val = constant.display_to_raw(*v);
                constant
                    .data_type
                    .write_to_bytes(&mut raw_data, 0, raw_val, def.endianness);
                let _ = cache.write_bytes(constant.page, constant.offset, &raw_data);
            }
            TuneValue::Array(arr) => {
                let last_value = arr.last().copied().unwrap_or(0.0);
                for i in 0..element_count {
                    let val = if i < arr.len() { arr[i] } else { last_value };
                    let raw_val = constant.display_to_raw(val);
                    let offset = i * element_size;
                    constant.data_type.write_to_bytes(
                        &mut raw_data,
                        offset,
                        raw_val,
                        def.endianness,
                    );
                }
                let _ = cache.write_bytes(constant.page, constant.offset, &raw_data);
            }
            TuneValue::String(s) if constant.data_type == DataType::String => {
                let max_len = length as usize;
                let mut bytes = vec![0u8; max_len];
                let copy_len = s.len().min(max_len);
                bytes[..copy_len].copy_from_slice(&s.as_bytes()[..copy_len]);
                let _ = cache.write_bytes(constant.page, constant.offset, &bytes);
            }
            TuneValue::Bool(_) | TuneValue::String(_) => {}
        }
    }
}

fn apply_bits_constant(
    cache: &mut TuneCache,
    constant: &libretune_core::ini::Constant,
    tune_value: &TuneValue,
) {
    let bit_pos = constant.bit_position.unwrap_or(0);
    let bit_size = constant.bit_size.unwrap_or(1);
    let byte_offset = (bit_pos / 8) as u16;
    let bit_in_byte = bit_pos % 8;
    let bits_remaining_after_first_byte = bit_size.saturating_sub(8 - bit_in_byte);
    let bytes_needed = if bits_remaining_after_first_byte > 0 {
        1 + bits_remaining_after_first_byte.div_ceil(8)
    } else {
        1
    };
    let bytes_needed_usize = bytes_needed as usize;
    let read_offset = constant.offset + byte_offset;

    let mut current_bytes: Vec<u8> = cache
        .read_bytes(constant.page, read_offset, bytes_needed as u16)
        .map(|s| s.to_vec())
        .unwrap_or_else(|| vec![0u8; bytes_needed_usize]);
    while current_bytes.len() < bytes_needed_usize {
        current_bytes.push(0u8);
    }

    let bit_value = match tune_value {
        TuneValue::Scalar(v) => *v as u32,
        TuneValue::Array(arr) if !arr.is_empty() => arr[0] as u32,
        TuneValue::Bool(b) => u32::from(*b),
        TuneValue::String(s) => {
            if let Some(index) = constant.bit_options.iter().position(|opt| opt == s) {
                index as u32
            } else if let Some(index) = constant
                .bit_options
                .iter()
                .position(|opt| opt.eq_ignore_ascii_case(s))
            {
                index as u32
            } else {
                return;
            }
        }
        _ => return,
    };

    let bits_in_first_byte = (8 - bit_in_byte).min(bit_size);
    let mask_first = if bits_in_first_byte >= 8 {
        0xFF
    } else {
        (1u8 << bits_in_first_byte) - 1
    };
    let value_first = (bit_value & mask_first as u32) as u8;
    current_bytes[0] =
        (current_bytes[0] & !(mask_first << bit_in_byte)) | (value_first << bit_in_byte);

    if bits_remaining_after_first_byte > 0 {
        let mut bits_collected = bits_in_first_byte;
        for i in 1..bytes_needed_usize.min(current_bytes.len()) {
            let remaining_bits = bit_size - bits_collected;
            if remaining_bits == 0 {
                break;
            }
            let bits_from_this_byte = remaining_bits.min(8);
            let mask = if bits_from_this_byte >= 8 {
                0xFF
            } else {
                (1u8 << bits_from_this_byte) - 1
            };
            let value_from_bit = ((bit_value >> bits_collected) & mask as u32) as u8;
            current_bytes[i] = (current_bytes[i] & !mask) | value_from_bit;
            bits_collected += bits_from_this_byte;
        }
    }

    let _ = cache.write_bytes(constant.page, read_offset, &current_bytes);
}
