use std::path::PathBuf;
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::CommandError;
use crate::db::catalog::{self, Folder, Photo};
use crate::import::{self, CachePaths, ImportEvent};
use crate::AppState;

/// Event name carrying [`ImportEvent`] payloads.
pub const IMPORT_EVENT: &str = "import";

/// A catalog photo plus the cache files the interface displays.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoView {
    #[serde(flatten)]
    pub photo: Photo,
    pub thumb_path: Option<String>,
    pub preview_path: Option<String>,
}

impl PhotoView {
    fn new(photo: Photo, cache: &CachePaths) -> Self {
        let ready = photo.cache_status == "ready";
        let path = |p: PathBuf| ready.then(|| p.to_string_lossy().into_owned());
        let (thumb_path, preview_path) = match photo.hash.as_deref() {
            Some(h) => (path(cache.thumb(h)), path(cache.preview(h))),
            None => (None, None),
        };
        Self {
            photo,
            thumb_path,
            preview_path,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ImportEventView {
    #[serde(rename_all = "camelCase")]
    Started {
        total: usize,
        to_process: usize,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        done: usize,
        total: usize,
        photo: Option<serde_json::Value>,
    },
    Finished(import::ImportSummary),
    Failed {
        message: String,
    },
}

/// Starts importing `paths` in the background and returns right away.
/// Progress arrives through the `import` event.
#[tauri::command]
pub fn import_folders(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    recursive: bool,
) -> Result<(), CommandError> {
    let roots: Vec<PathBuf> = paths
        .iter()
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .map(|p| dunce::canonicalize(&p).unwrap_or(p))
        .collect();
    if roots.is_empty() {
        return Err(CommandError::Message(
            "Nenhuma pasta encontrada. Escolha ou solte uma pasta; arquivos soltos não são importados.".into(),
        ));
    }
    if state
        .importing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(CommandError::Message(
            "Já existe uma importação em andamento.".into(),
        ));
    }

    let db = state.db.clone();
    let cache = state.cache.clone();
    let importing = state.importing.clone();
    std::thread::spawn(move || {
        let emit = |event: ImportEvent| {
            let view = match event {
                ImportEvent::Started { total, to_process } => {
                    ImportEventView::Started { total, to_process }
                }
                ImportEvent::Progress { done, total, photo } => ImportEventView::Progress {
                    done,
                    total,
                    photo: photo.map(|p| {
                        serde_json::to_value(PhotoView::new(*p, &cache)).unwrap_or_default()
                    }),
                },
                ImportEvent::Finished(summary) => ImportEventView::Finished(summary),
            };
            let _ = app.emit(IMPORT_EVENT, view);
        };
        let result = import::run(&db, &cache, &roots, recursive, 0, &emit);
        importing.store(false, Ordering::Release);
        if let Err(e) = result {
            let _ = app.emit(
                IMPORT_EVENT,
                ImportEventView::Failed {
                    message: e.to_string(),
                },
            );
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn list_folders(state: State<'_, AppState>) -> Result<Vec<Folder>, CommandError> {
    let conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
    Ok(catalog::list_folders(&conn)?)
}

#[tauri::command]
pub async fn list_photos(
    state: State<'_, AppState>,
    folder_id: Option<i64>,
) -> Result<Vec<PhotoView>, CommandError> {
    let photos = {
        let conn = state.db.lock().map_err(|_| CommandError::Poisoned)?;
        catalog::list_photos(&conn, folder_id)?
    };
    Ok(photos
        .into_iter()
        .map(|p| PhotoView::new(p, &state.cache))
        .collect())
}
