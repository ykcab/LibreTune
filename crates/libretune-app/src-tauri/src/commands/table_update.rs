//! Table z-values update command.

use crate::AppState;
use crate::update_table_z_values_internal;

#[tauri::command]
pub async fn update_table_data(
    state: tauri::State<'_, AppState>,
    table_name: String,
    z_values: Vec<Vec<f64>>,
) -> Result<(), String> {
    update_table_z_values_internal(&state, &table_name, z_values).await
}
