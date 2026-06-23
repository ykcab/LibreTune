//! save_tune and save_tune_as commands (extracted from lib.rs).

use std::path::PathBuf;

use crate::commands::tune_persist::persist_tune_to_path;
use crate::AppState;
use libretune_core::project::Project;

#[tauri::command]
pub async fn save_tune(
    state: tauri::State<'_, AppState>,
    path: Option<String>,
) -> Result<String, String> {
    let path_guard = state.current_tune_path.lock().await;

    let save_path = if let Some(p) = path {
        PathBuf::from(p)
    } else if let Some(p) = path_guard.as_ref() {
        p.clone()
    } else {
        let tune_guard = state.current_tune.lock().await;
        let signature = tune_guard
            .as_ref()
            .map(|t| t.signature.clone())
            .unwrap_or_else(|| "tune".to_string());
        drop(tune_guard);

        let filename = format!("{}.msq", signature.replace(' ', "_"));
        Project::projects_dir()
            .map_err(|e| format!("Failed to get projects directory: {}", e))?
            .join(filename)
    };

    drop(path_guard);

    persist_tune_to_path(&state, save_path.clone()).await?;
    Ok(save_path.to_string_lossy().to_string())
}

/// Saves the current tune to a specified path.
#[tauri::command]
pub async fn save_tune_as(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    save_tune(state, Some(path)).await
}
