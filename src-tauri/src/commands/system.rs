use serde::Serialize;
use tauri::State;

use super::CommandError;
use crate::{db, AppState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub app_version: String,
    pub db_path: String,
    pub sqlite_version: String,
    pub schema_version: u32,
    pub latest_schema_version: u32,
    pub tables: Vec<String>,
}

/// Health check used by the skeleton UI: confirms the Rust core is reachable
/// and the SQLite catalog was opened and migrated.
#[tauri::command]
pub fn app_status(state: State<'_, AppState>) -> Result<AppStatus, CommandError> {
    let conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
    Ok(AppStatus {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        db_path: state.db_path.display().to_string(),
        sqlite_version: rusqlite::version().to_string(),
        schema_version: db::schema_version(&conn)?,
        latest_schema_version: db::latest_version(),
        tables: db::list_tables(&conn)?,
    })
}
