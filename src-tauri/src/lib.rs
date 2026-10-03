mod commands;
mod db;

use std::sync::Mutex;

use tauri::Manager;

/// Shared application state, available to every Tauri command.
pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub db_path: std::path::PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join(db::DB_FILE_NAME);
            let conn = db::open(&db_path)?;
            app.manage(AppState {
                db: Mutex::new(conn),
                db_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::system::app_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
