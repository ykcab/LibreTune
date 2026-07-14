//! Dashboard discovery, templates, conflict-checking, and import commands.

use crate::paths::get_dashboards_dir;
use libretune_core::dash::{
    self, create_startup_dashboard, create_telemetry_live_dashboard, create_tuning_dashboard,
    STARTUP_TEMPLATE_VERSION,
};
use serde::Serialize;
use std::path::Path;

/// Info about an available dashboard file
#[derive(Serialize)]
pub struct DashFileInfo {
    pub name: String,
    pub path: String,
    pub category: String, // "User", "Reference", etc.
}

/// Helper to scan a directory for .dash and .ltdash.xml files
fn scan_dash_directory(dir: &Path, _category: &str, dashes: &mut Vec<DashFileInfo>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            if let Some(name) = path.file_name() {
                if file_name.ends_with(".ltdash.xml") {
                    dashes.push(DashFileInfo {
                        name: name.to_string_lossy().to_string(),
                        path: path.to_string_lossy().to_string(),
                        category: "LibreTune".to_string(),
                    });
                } else if file_name.ends_with(".dash") {
                    dashes.push(DashFileInfo {
                        name: name.to_string_lossy().to_string(),
                        path: path.to_string_lossy().to_string(),
                        category: "Legacy (TunerStudio)".to_string(),
                    });
                } else if file_name.ends_with(".gauge") {
                    dashes.push(DashFileInfo {
                        name: name.to_string_lossy().to_string(),
                        path: path.to_string_lossy().to_string(),
                        category: "Legacy Gauges".to_string(),
                    });
                }
            }
        }
    }
}

/// List all available dashboard files (.ltdash.xml and .dash for import)
/// List all available dashboard files from the user dashboards directory.
/// Ensures every built-in default dashboard exists, creating any that are
/// missing (fresh install or upgrade) without touching existing files.
#[tauri::command]
pub async fn list_available_dashes(app: tauri::AppHandle) -> Result<Vec<DashFileInfo>, String> {
    let dash_dir = get_dashboards_dir(&app);

    // Create directory if it doesn't exist
    if !dash_dir.exists() {
        std::fs::create_dir_all(&dash_dir)
            .map_err(|e| format!("Failed to create dashboards directory: {}", e))?;
    }

    // Drop retired built-in leftovers (e.g. Telemetry Compact), then ensure
    // every current built-in default exists. Existing user files for current
    // templates are left alone unless they need a versioned refresh.
    remove_obsolete_default_dashboards(&dash_dir);
    ensure_missing_default_dashboards(&dash_dir)?;

    let mut dashes = Vec::new();

    // Scan only the user dashboards directory (imported or created by user)
    scan_dash_directory(&dash_dir, "User", &mut dashes);

    // Sort by name
    dashes.sort_by(|a, b| a.name.cmp(&b.name));

    println!("[list_available_dashes] Found {} dashboards", dashes.len());
    Ok(dashes)
}

/// Result of checking for dashboard file conflicts
#[derive(Serialize)]
pub struct DashConflictInfo {
    /// The filename that would conflict
    pub file_name: String,
    /// Whether a conflict exists
    pub has_conflict: bool,
    /// Suggested alternative name if conflict exists
    pub suggested_name: Option<String>,
}

/// Reset dashboards to defaults - removes all user dashboards and recreates built-ins
#[tauri::command]
pub async fn reset_dashboards_to_defaults(app: tauri::AppHandle) -> Result<(), String> {
    let dash_dir = get_dashboards_dir(&app);

    println!(
        "[reset_dashboards_to_defaults] Clearing dashboards directory: {:?}",
        dash_dir
    );

    // Remove the entire dashboards directory
    if dash_dir.exists() {
        std::fs::remove_dir_all(&dash_dir)
            .map_err(|e| format!("Failed to remove dashboards directory: {}", e))?;
    }

    // Recreate it
    std::fs::create_dir_all(&dash_dir)
        .map_err(|e| format!("Failed to create dashboards directory: {}", e))?;

    create_default_dashboard_files(&dash_dir)?;

    println!(
        "[reset_dashboards_to_defaults] Reset complete - {} default dashboards created",
        default_dashboard_specs().len()
    );
    Ok(())
}

/// Check if a dashboard file with the given name already exists
#[tauri::command]
pub async fn check_dash_conflict(
    app: tauri::AppHandle,
    file_name: String,
) -> Result<DashConflictInfo, String> {
    let dash_dir = get_dashboards_dir(&app);
    let target_path = dash_dir.join(&file_name);

    if target_path.exists() {
        // Generate a suggested alternative name
        let suggested = generate_unique_filename(&dash_dir, &file_name);
        Ok(DashConflictInfo {
            file_name,
            has_conflict: true,
            suggested_name: Some(suggested),
        })
    } else {
        Ok(DashConflictInfo {
            file_name,
            has_conflict: false,
            suggested_name: None,
        })
    }
}

/// Generate a unique filename by appending _2, _3, etc.
pub(crate) fn generate_unique_filename(dir: &Path, original_name: &str) -> String {
    // Split into base and extension(s)
    // Handle .ltdash.xml specially
    let (base, ext) = if original_name.ends_with(".ltdash.xml") {
        let base = original_name.trim_end_matches(".ltdash.xml");
        (base.to_string(), ".ltdash.xml".to_string())
    } else if let Some(dot_pos) = original_name.rfind('.') {
        (
            original_name[..dot_pos].to_string(),
            original_name[dot_pos..].to_string(),
        )
    } else {
        (original_name.to_string(), String::new())
    };

    let mut counter = 2;
    loop {
        let candidate = format!("{}_{}{}", base, counter, ext);
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        counter += 1;
        if counter > 1000 {
            // Safety limit
            return format!("{}_{}{}", base, chrono::Utc::now().timestamp(), ext);
        }
    }
}

/// Import result for a single dashboard file
#[derive(Serialize)]
pub struct DashImportResult {
    /// Original source path
    pub source_path: String,
    /// Whether import succeeded
    pub success: bool,
    /// Error message if failed
    pub error: Option<String>,
    /// The imported file info if successful
    pub file_info: Option<DashFileInfo>,
}

/// Import a dashboard file from an external location
/// If rename_to is provided, the file will be saved with that name instead
#[tauri::command]
pub async fn import_dash_file(
    app: tauri::AppHandle,
    source_path: String,
    rename_to: Option<String>,
    overwrite: bool,
) -> Result<DashImportResult, String> {
    let dash_dir = get_dashboards_dir(&app);

    // Ensure dashboards directory exists
    std::fs::create_dir_all(&dash_dir)
        .map_err(|e| format!("Failed to create dashboards directory: {}", e))?;

    let source = Path::new(&source_path);

    // Check source file exists
    if !source.exists() {
        return Ok(DashImportResult {
            source_path: source_path.clone(),
            success: false,
            error: Some("Source file does not exist".to_string()),
            file_info: None,
        });
    }

    // Validate it's a parseable dash or gauge file
    let lower = source_path.to_lowercase();
    if lower.ends_with(".gauge") {
        if let Err(e) = dash::load_gauge_file(source) {
            return Ok(DashImportResult {
                source_path: source_path.clone(),
                success: false,
                error: Some(format!("Invalid gauge file: {}", e)),
                file_info: None,
            });
        }
    } else {
        let content =
            std::fs::read_to_string(source).map_err(|e| format!("Failed to read file: {}", e))?;

        if let Err(e) = dash::parse_dash_file(&content) {
            return Ok(DashImportResult {
                source_path: source_path.clone(),
                success: false,
                error: Some(format!("Invalid dashboard file: {}", e)),
                file_info: None,
            });
        }
    }

    // Determine target filename
    let file_name = if let Some(ref new_name) = rename_to {
        new_name.clone()
    } else {
        source
            .file_name()
            .ok_or_else(|| "Invalid file path".to_string())?
            .to_string_lossy()
            .to_string()
    };

    let dest_path = dash_dir.join(&file_name);

    // Check for conflict
    if dest_path.exists() && !overwrite {
        return Ok(DashImportResult {
            source_path: source_path.clone(),
            success: false,
            error: Some(format!("File '{}' already exists", file_name)),
            file_info: None,
        });
    }

    // Copy file to dashboards directory
    std::fs::copy(source, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    println!(
        "[import_dash_file] Imported {} -> {:?}",
        source_path, dest_path
    );

    Ok(DashImportResult {
        source_path,
        success: true,
        error: None,
        file_info: Some(DashFileInfo {
            name: file_name,
            path: dest_path.to_string_lossy().to_string(),
            category: "User".to_string(),
        }),
    })
}

/// Builder function for a built-in default dashboard template.
type DefaultDashBuilder = fn() -> dash::DashFile;

/// (file name, builder) pairs for every built-in default dashboard. Adding a
/// new built-in template only requires appending a row here.
fn default_dashboard_specs() -> Vec<(&'static str, DefaultDashBuilder)> {
    vec![
        ("Startup.ltdash.xml", create_startup_dashboard),
        ("Tuning.ltdash.xml", create_tuning_dashboard),
        ("Telemetry Live.ltdash.xml", create_telemetry_live_dashboard),
    ]
}

/// Write a single default dashboard file, overwriting any existing copy.
fn write_default_dashboard(
    dir: &Path,
    file_name: &str,
    dash_file: &dash::DashFile,
) -> Result<(), String> {
    let xml = dash::write_dash_file(dash_file)
        .map_err(|e| format!("Failed to serialize {}: {}", file_name, e))?;
    std::fs::write(dir.join(file_name), xml)
        .map_err(|e| format!("Failed to write {}: {}", file_name, e))
}

/// Create (overwrite) all built-in default dashboard XML files in the given
/// directory. Used for fresh installs and "Reset to Defaults".
pub(crate) fn create_default_dashboard_files(dir: &Path) -> Result<(), String> {
    for (file_name, builder) in default_dashboard_specs() {
        write_default_dashboard(dir, file_name, &builder())?;
    }
    println!(
        "[create_default_dashboard_files] Created {} default dashboards",
        default_dashboard_specs().len()
    );
    Ok(())
}

/// Retired built-in dashboards that should be deleted from the user dash folder
/// on upgrade so they no longer appear in the selector.
const OBSOLETE_DEFAULT_DASHBOARDS: &[&str] = &[
    "Telemetry Compact.ltdash.xml",
    "Basic.ltdash.xml",
    "Racing.ltdash.xml",
    "Command Center.ltdash.xml",
];

fn remove_obsolete_default_dashboards(dir: &Path) {
    for file_name in OBSOLETE_DEFAULT_DASHBOARDS {
        let path = dir.join(file_name);
        if !path.exists() {
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(()) => println!(
                "[remove_obsolete_default_dashboards] Removed obsolete dashboard {:?}",
                path
            ),
            Err(e) => eprintln!(
                "[remove_obsolete_default_dashboards] Failed to remove {:?}: {}",
                path, e
            ),
        }
    }
}

/// Additive default seeding: writes missing built-ins and refreshes versioned
/// templates when the layout changes.
pub(crate) fn ensure_missing_default_dashboards(dir: &Path) -> Result<(), String> {
    let mut created = 0;
    let mut refreshed = 0;
    for (file_name, builder) in default_dashboard_specs() {
        let path = dir.join(file_name);
        if path.exists() && !built_in_dashboard_needs_refresh(file_name, &path) {
            continue;
        }
        let existed = path.exists();
        write_default_dashboard(dir, file_name, &builder())?;
        if existed {
            refreshed += 1;
        } else {
            created += 1;
        }
    }
    if created > 0 || refreshed > 0 {
        println!(
            "[ensure_missing_default_dashboards] Added {} / refreshed {} default dashboard(s) in {:?}",
            created, refreshed, dir
        );
    }
    Ok(())
}

fn built_in_dashboard_needs_refresh(file_name: &str, path: &Path) -> bool {
    let expected = match file_name {
        "Startup.ltdash.xml" => Some(STARTUP_TEMPLATE_VERSION),
        _ => None,
    };
    let Some(version) = expected else {
        return false;
    };
    match dash::load_dash_file(path) {
        Ok(existing) => {
            existing
                .gauge_cluster
                .extra_attrs
                .get("lt_template_version")
                .map(|s| s.as_str())
                != Some(version)
        }
        Err(_) => true,
    }
}

/// Get list of available dashboard templates
#[tauri::command]
pub async fn get_dashboard_templates() -> Result<Vec<DashboardTemplateInfo>, String> {
    Ok(vec![
        DashboardTemplateInfo {
            id: "startup".to_string(),
            name: "Startup".to_string(),
            description:
                "Fixed live telemetry monitor: primary RPM/TPS/MAP/λ, secondary grid, strip chart, status LEDs"
                    .to_string(),
        },
        DashboardTemplateInfo {
            id: "tuning".to_string(),
            name: "Tuning Dashboard".to_string(),
            description: "AFR, VE, Spark advance, and correction factors".to_string(),
        },
        DashboardTemplateInfo {
            id: "telemetry_live".to_string(),
            name: "Telemetry Live".to_string(),
            description:
                "Dense Grafana-style live view: 22 stat tiles, 4 multi-series charts, 16 sparklines"
                    .to_string(),
        },
    ])
}

#[derive(Serialize)]
pub struct DashboardTemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}
