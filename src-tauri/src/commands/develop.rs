//! Develop screen: preview bytes, recipe saving, undo/redo and the edited
//! thumbnail. Originals are never touched; everything goes to the catalog
//! and the app cache.

use base64::Engine;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::State;

use super::library::PhotoView;
use super::CommandError;
use crate::db::{catalog, edits, edits::EditState};
use crate::recipe::Recipe;
use crate::AppState;

const MAX_THUMB_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditResult {
    pub state: EditState,
    /// The photo as the library shows it (badge and thumbnail).
    pub photo: Option<PhotoView>,
}

fn photo_view(
    state: &AppState,
    conn: &rusqlite::Connection,
    id: i64,
) -> Result<Option<PhotoView>, CommandError> {
    Ok(catalog::get_photo(conn, id)?.map(|p| PhotoView::new(p, &state.cache)))
}

/// After any change: a photo back to neutral loses its edited thumbnail.
fn finish(
    state: &AppState,
    conn: &rusqlite::Connection,
    st: EditState,
) -> Result<EditResult, CommandError> {
    if !st.edited {
        if let (true, Some(old)) = edits::set_thumb(conn, st.photo_id, st.history_id, None)? {
            let _ = std::fs::remove_file(state.cache.edited(&old));
        }
    }
    let photo = photo_view(state, conn, st.photo_id)?;
    Ok(EditResult { state: st, photo })
}

/// The 2048 px preview JPEG as raw bytes (read into WebGL by the interface).
#[tauri::command]
pub async fn read_preview(
    state: State<'_, AppState>,
    photo_id: i64,
) -> Result<Response, CommandError> {
    let photo = {
        let conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
        catalog::get_photo(&conn, photo_id)?
    };
    let hash = photo
        .filter(|p| p.cache_status == "ready")
        .and_then(|p| p.hash)
        .ok_or_else(|| CommandError::Message("Prévia ainda não disponível.".into()))?;
    let bytes = std::fs::read(state.cache.preview(&hash))
        .map_err(|e| CommandError::Message(format!("Não foi possível ler a prévia: {e}")))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn load_edit(
    state: State<'_, AppState>,
    photo_id: i64,
) -> Result<EditState, CommandError> {
    let conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
    Ok(edits::load(&conn, photo_id)?)
}

#[tauri::command]
pub async fn save_recipe(
    state: State<'_, AppState>,
    photo_id: i64,
    recipe: serde_json::Value,
) -> Result<EditResult, CommandError> {
    let recipe: Recipe = serde_json::from_value(recipe)
        .map_err(|e| CommandError::Message(format!("Receita inválida: {e}")))?;
    let mut conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
    let st = edits::save(&mut conn, photo_id, &recipe)?;
    finish(&state, &conn, st)
}

#[tauri::command]
pub async fn undo_edit(
    state: State<'_, AppState>,
    photo_id: i64,
) -> Result<EditResult, CommandError> {
    let mut conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
    let st = edits::undo(&mut conn, photo_id)?;
    finish(&state, &conn, st)
}

#[tauri::command]
pub async fn redo_edit(
    state: State<'_, AppState>,
    photo_id: i64,
) -> Result<EditResult, CommandError> {
    let mut conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
    let st = edits::redo(&mut conn, photo_id)?;
    finish(&state, &conn, st)
}

/// Stores the thumbnail rendered by the preview for the edit state
/// `history_id`. Ignored if the photo changed since (returns `None`).
#[tauri::command]
pub async fn save_edited_thumb(
    state: State<'_, AppState>,
    photo_id: i64,
    history_id: Option<i64>,
    jpeg_base64: String,
) -> Result<Option<PhotoView>, CommandError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(jpeg_base64.as_bytes())
        .map_err(|_| CommandError::Message("Miniatura inválida.".into()))?;
    if bytes.len() > MAX_THUMB_BYTES || !bytes.starts_with(&[0xFF, 0xD8]) {
        return Err(CommandError::Message("Miniatura inválida.".into()));
    }
    let file = format!("{photo_id}-{}.jpg", history_id.unwrap_or(0));
    let path = state.cache.edited(&file);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| CommandError::Message(e.to_string()))?;
    }
    std::fs::write(&path, &bytes).map_err(|e| CommandError::Message(e.to_string()))?;

    let conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
    let (accepted, old) = edits::set_thumb(&conn, photo_id, history_id, Some(&file))?;
    if !accepted {
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    }
    if let Some(old) = old {
        let _ = std::fs::remove_file(state.cache.edited(&old));
    }
    photo_view(&state, &conn, photo_id)
}
