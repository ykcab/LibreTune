//! Update project INI command (extracted from lib.rs).

use crate::{with_settings, AppState};
use libretune_core::ini::EcuDefinition;
use libretune_core::tune::{TuneCache, TuneFile};
use tauri::Emitter;

/// Update the project's INI file and optionally force re-sync
#[tauri::command]
pub async fn update_project_ini(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    ini_path: String,
    force_resync: bool,
) -> Result<(), String> {
    // Load the new INI definition
    let new_def = EcuDefinition::from_file(&ini_path)
        .map_err(|e| format!("Failed to parse INI file: {}", e))?;

    // Update the project config if we have a project open
    let mut project_ini_path_str: Option<String> = None;
    let mut proj_guard = state.current_project.lock().await;
    if let Some(ref mut project) = *proj_guard {
        // Copy the new INI to the project directory
        let project_ini_path = project.ini_path();
        std::fs::copy(&ini_path, &project_ini_path)
            .map_err(|e| format!("Failed to copy INI to project: {}", e))?;

        // Update project signature
        project.config.signature = new_def.signature.clone();
        project
            .save_config()
            .map_err(|e| format!("Failed to save project config: {}", e))?;

        // Stamp CurrentTune.msq with the new signature so the next load/connect
        // does not treat the old MSQ signature as another mismatch.
        let tune_path = project.current_tune_path();
        if tune_path.exists() {
            match TuneFile::load(&tune_path) {
                Ok(mut tune) => {
                    tune.signature = new_def.signature.clone();
                    if let Err(e) = tune.save(&tune_path) {
                        eprintln!(
                            "[WARN] update_project_ini: failed to update tune signature: {}",
                            e
                        );
                    } else if let Some(ref mut project_tune) = project.current_tune {
                        project_tune.signature = new_def.signature.clone();
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[WARN] update_project_ini: failed to load tune for signature stamp: {}",
                        e
                    );
                }
            }
        }

        project_ini_path_str = Some(project_ini_path.to_string_lossy().to_string());
    }
    drop(proj_guard);

    // Update the loaded definition
    let mut def_guard = state.definition.lock().await;
    let def_clone = new_def.clone();
    *def_guard = Some(new_def);
    drop(def_guard);
    crate::commands::data_logging::stop_recording_on_definition_change(&state).await;
    crate::commands::realtime_stream::stop_streaming_on_definition_change(&state).await;

    // Prefer the project copy so reconnects always use the persisted INI.
    with_settings(&app, |settings| {
        settings.last_ini_path = project_ini_path_str.or(Some(ini_path));
    });

    // Keep in-memory current tune signature in sync
    {
        let mut tune_guard = state.current_tune.lock().await;
        if let Some(tune) = tune_guard.as_mut() {
            tune.signature = def_clone.signature.clone();
        }
    }

    // Re-initialize cache with new definition and re-apply project tune constants
    let project_tune = {
        let proj_guard = state.current_project.lock().await;
        proj_guard
            .as_ref()
            .and_then(|p| p.current_tune.as_ref().cloned())
    };

    // Create new cache from updated definition
    let cache = TuneCache::from_definition(&def_clone);
    let mut cache_guard = state.tune_cache.lock().await;
    *cache_guard = Some(cache);

    // Re-apply project tune constants with new definition
    if let Some(tune) = project_tune {
        if let Some(cache) = cache_guard.as_mut() {
            // Load any raw page data first
            for (page_num, page_data) in &tune.pages {
                cache.load_page(*page_num, page_data.clone());
            }

            // Apply constants from tune file to cache (same logic as open_project)
            use libretune_core::tune::TuneValue;

            let mut applied_count = 0;
            let mut skipped_count = 0;
            let mut failed_count = 0;

            for (name, tune_value) in &tune.constants {
                if let Some(constant) = def_clone.constants.get(name) {
                    // PC variables are stored locally
                    if constant.is_pc_variable {
                        match tune_value {
                            TuneValue::Scalar(v) => {
                                cache.local_values.insert(name.clone(), *v);
                                applied_count += 1;
                            }
                            TuneValue::Array(arr) if !arr.is_empty() => {
                                cache.local_values.insert(name.clone(), arr[0]);
                                applied_count += 1;
                            }
                            _ => {
                                skipped_count += 1;
                            }
                        }
                        continue;
                    }

                    let length = constant.size_bytes() as u16;
                    if length == 0 {
                        skipped_count += 1;
                        continue;
                    }

                    let element_size = constant.data_type.size_bytes();
                    let element_count = constant.shape.element_count();
                    let mut raw_data = vec![0u8; length as usize];

                    match tune_value {
                        TuneValue::Scalar(v) => {
                            let raw_val = constant.display_to_raw(*v);
                            constant.data_type.write_to_bytes(
                                &mut raw_data,
                                0,
                                raw_val,
                                def_clone.endianness,
                            );
                            if cache.write_bytes(constant.page, constant.offset, &raw_data) {
                                applied_count += 1;
                            } else {
                                failed_count += 1;
                            }
                        }
                        TuneValue::Array(arr) => {
                            // Handle size mismatches
                            let last_value = arr.last().copied().unwrap_or(0.0);

                            for i in 0..element_count {
                                let val = if i < arr.len() { arr[i] } else { last_value };
                                let raw_val = constant.display_to_raw(val);
                                let offset = i * element_size;
                                constant.data_type.write_to_bytes(
                                    &mut raw_data,
                                    offset,
                                    raw_val,
                                    def_clone.endianness,
                                );
                            }

                            if cache.write_bytes(constant.page, constant.offset, &raw_data) {
                                applied_count += 1;
                            } else {
                                failed_count += 1;
                            }
                        }
                        TuneValue::String(_) | TuneValue::Bool(_) => {
                            skipped_count += 1;
                        }
                    }
                } else {
                    skipped_count += 1;
                }
            }

            eprintln!("[DEBUG] update_project_ini: Re-applied tune constants - applied: {}, failed: {}, skipped: {}, total: {}", 
                applied_count, failed_count, skipped_count, tune.constants.len());

            // Emit event to notify UI that tune data was re-applied
            let _ = app.emit("tune:loaded", "ini_updated");
        }
    }
    drop(cache_guard);

    // If force_resync is requested and we're connected, trigger re-sync
    if force_resync {
        let conn_guard = state.connection.lock().await;
        if conn_guard.is_some() {
            drop(conn_guard);
            // Emit event to notify frontend to re-sync
            let _ = app.emit("ini:changed", "resync_required");
        }
    }

    Ok(())
}
