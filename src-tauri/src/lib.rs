mod commands;
pub mod db;
pub mod import;
pub mod pipeline;
pub mod raw;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::Manager;

/// Shared application state, available to every Tauri command.
pub struct AppState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub db_path: std::path::PathBuf,
    pub cache: import::CachePaths,
    /// True while an import runs; only one at a time.
    pub importing: Arc<AtomicBool>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&cache_dir)?;
            let db_path = data_dir.join(db::DB_FILE_NAME);
            let conn = db::open(&db_path)?;
            app.manage(AppState {
                db: Arc::new(Mutex::new(conn)),
                db_path,
                cache: import::CachePaths::new(cache_dir),
                importing: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::app_status,
            commands::library::import_folders,
            commands::library::list_folders,
            commands::library::list_photos,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
