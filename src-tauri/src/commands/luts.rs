//! LUTs: import a `.cube` (validated and copied to the app data folder), list
//! the imported ones, and read one for the preview.

use std::path::{Path, PathBuf};

use rusqlite::params;
use serde::Serialize;
use tauri::State;

use super::CommandError;
use crate::lut;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LutInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub size: i64,
    pub title: String,
}

pub fn luts_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("luts")
}

/// Ids are content hashes; anything else could escape the LUT folder.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit())
}

#[tauri::command]
pub async fn import_lut(state: State<'_, AppState>, path: String) -> Result<LutInfo, CommandError> {
    let src = PathBuf::from(&path);
    let (id, info) =
        lut::import_file(&src, &luts_dir(&state.data_dir)).map_err(CommandError::Message)?;
    let name = src
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| id.clone());
    let conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
    conn.execute(
        "INSERT INTO luts (id, name, kind, size, title) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name",
        params![id, name, info.kind, info.size as i64, info.title],
    )
    .map_err(crate::db::DbError::from)?;
    Ok(LutInfo {
        id,
        name,
        kind: info.kind,
        size: info.size as i64,
        title: info.title,
    })
}

#[tauri::command]
pub async fn list_luts(state: State<'_, AppState>) -> Result<Vec<LutInfo>, CommandError> {
    let conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
    let mut stmt = conn
        .prepare("SELECT id, name, kind, size, title FROM luts ORDER BY name COLLATE NOCASE")
        .map_err(crate::db::DbError::from)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(LutInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                size: r.get(3)?,
                title: r.get(4)?,
            })
        })
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(crate::db::DbError::from)?;
    Ok(rows)
}

/// The copied `.cube` text (parsed by the interface).
#[tauri::command]
pub async fn read_lut(state: State<'_, AppState>, id: String) -> Result<String, CommandError> {
    if !valid_id(&id) {
        return Err(CommandError::Message("LUT inválida.".into()));
    }
    let path = luts_dir(&state.data_dir).join(format!("{id}.cube"));
    std::fs::read_to_string(&path).map_err(|_| {
        CommandError::Message(
            "A LUT desta foto não foi encontrada na pasta de dados do app.".into(),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::valid_id;

    #[test]
    fn only_hex_ids_are_accepted() {
        assert!(valid_id("0123abcdef"));
        assert!(!valid_id("../etc/passwd"));
        assert!(!valid_id(""));
        assert!(!valid_id("abc.cube"));
    }
}
