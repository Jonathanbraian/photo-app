//! Folder import: scan, register in the catalog, then build the cache
//! (2048 px preview + 300 px thumbnail) in parallel, reporting progress.
//!
//! Independent of Tauri so it can be tested directly; the command layer
//! forwards [`ImportEvent`]s to the interface.
//!
//! Originals are only ever read. Cache files are named after the content hash,
//! so identical files share them and an edited file gets fresh ones.

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
use rusqlite::Connection;
use serde::Serialize;
use walkdir::WalkDir;

use crate::db::{self, catalog};
use crate::pipeline::{decode, thumbnail, Format};

const MAX_REPORTED_ERRORS: usize = 50;

/// Where previews and thumbnails live (inside the app cache directory).
#[derive(Debug, Clone)]
pub struct CachePaths {
    pub root: PathBuf,
}

impl CachePaths {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }
    pub fn thumb(&self, hash: &str) -> PathBuf {
        self.root.join("thumbs").join(format!("{hash}.jpg"))
    }
    pub fn preview(&self, hash: &str) -> PathBuf {
        self.root.join("previews").join(format!("{hash}.jpg"))
    }
    pub fn tmp(&self) -> PathBuf {
        self.root.join("tmp")
    }
    fn is_complete(&self, hash: &str) -> bool {
        self.thumb(hash).is_file() && self.preview(hash).is_file()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    /// Supported files found.
    pub total: usize,
    /// Files decoded and cached in this run.
    pub processed: usize,
    /// Unchanged files that were already in the catalog with a complete cache.
    pub skipped: usize,
    pub failed: usize,
    /// First errors, for display.
    pub errors: Vec<ImportError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportEvent {
    /// Every file is registered in the catalog (cache pending).
    #[serde(rename_all = "camelCase")]
    Started {
        total: usize,
        to_process: usize,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        done: usize,
        total: usize,
        photo: Option<Box<catalog::Photo>>,
    },
    Finished(ImportSummary),
}

#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error("nenhuma pasta válida para importar")]
    NoFolders,
    #[error(transparent)]
    Db(#[from] db::DbError),
    #[error("estado do banco indisponível")]
    Poisoned,
}

struct Job {
    id: i64,
    path: PathBuf,
    format: Format,
}

/// Lists supported files under `roots`, sorted by path. Non-directories are
/// ignored; hidden files and folders (".xxx") are skipped.
pub fn scan(roots: &[PathBuf], recursive: bool) -> Vec<(PathBuf, Format)> {
    let mut files: Vec<(PathBuf, Format)> = roots
        .iter()
        .filter(|r| r.is_dir())
        .flat_map(|root| {
            WalkDir::new(root)
                .max_depth(if recursive { usize::MAX } else { 1 })
                .follow_links(false)
                .into_iter()
                .filter_entry(|e| {
                    e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
                })
                .filter_map(Result::ok)
                .filter(|e| e.file_type().is_file())
                .filter_map(|e| Format::from_path(e.path()).map(|f| (e.into_path(), f)))
        })
        .collect();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    files.dedup_by(|a, b| a.0 == b.0);
    files
}

fn file_stamp(path: &Path) -> (i64, Option<i64>) {
    match std::fs::metadata(path) {
        Ok(meta) => {
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);
            (meta.len() as i64, modified)
        }
        Err(_) => (0, None),
    }
}

/// Registers every file and returns the ones whose cache must be (re)built.
fn register(
    db: &Mutex<Connection>,
    cache: &CachePaths,
    files: &[(PathBuf, Format)],
) -> Result<Vec<Job>, RunError> {
    let mut conn = db.lock().map_err(|_| RunError::Poisoned)?;
    let tx = conn.transaction().map_err(db::DbError::from)?;
    let mut folders: HashMap<PathBuf, i64> = HashMap::new();
    let mut jobs = Vec::new();
    for (path, format) in files {
        let (size, modified) = file_stamp(path);
        if let Some(existing) = catalog::find_by_path(&tx, path)? {
            let unchanged = existing.file_size == Some(size) && existing.modified_at == modified;
            let cached = existing.cache_status == "ready"
                && existing
                    .hash
                    .as_deref()
                    .is_some_and(|h| cache.is_complete(h));
            if unchanged && cached {
                continue;
            }
        }
        let parent = path.parent().unwrap_or(path).to_path_buf();
        let folder_id = match folders.get(&parent) {
            Some(id) => *id,
            None => {
                let id = catalog::upsert_folder(&tx, &parent)?;
                folders.insert(parent, id);
                id
            }
        };
        let id = catalog::upsert_pending(&tx, path, folder_id, format.as_str(), size, modified)?;
        jobs.push(Job {
            id,
            path: path.clone(),
            format: *format,
        });
    }
    tx.commit().map_err(db::DbError::from)?;
    Ok(jobs)
}

/// Decodes one file and writes its preview and thumbnail.
fn process(
    job: &Job,
    cache: &CachePaths,
) -> Result<(String, decode::Decoded), (Option<String>, String)> {
    let bytes =
        std::fs::read(&job.path).map_err(|e| (None, format!("não foi possível ler: {e}")))?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let fail = |msg: String| (Some(hash.clone()), msg);

    let bytes = Arc::new(bytes);
    let mut decoded = catch_unwind(AssertUnwindSafe(|| {
        decode::decode(&job.path, job.format, bytes, &cache.tmp(), &hash)
    }))
    .map_err(|_| fail("falha inesperada ao decodificar".into()))?
    .map_err(fail)?;

    // Move the full-size pixels out; only the metadata is needed afterwards.
    let image = std::mem::replace(&mut decoded.image, image::DynamicImage::new_rgb8(1, 1));
    if !cache.is_complete(&hash) {
        let (preview, thumb) = thumbnail::render(image, decoded.orientation).map_err(fail)?;
        thumbnail::write_jpeg(&preview, &cache.preview(&hash), 88).map_err(fail)?;
        thumbnail::write_jpeg(&thumb, &cache.thumb(&hash), 82).map_err(fail)?;
    }
    Ok((hash, decoded))
}

/// Imports `roots`. Blocks until done; call it from a background thread.
/// `threads = 0` uses all cores but one.
pub fn run(
    db: &Mutex<Connection>,
    cache: &CachePaths,
    roots: &[PathBuf],
    recursive: bool,
    threads: usize,
    emit: &(dyn Fn(ImportEvent) + Sync),
) -> Result<ImportSummary, RunError> {
    if !roots.iter().any(|r| r.is_dir()) {
        return Err(RunError::NoFolders);
    }
    let files = scan(roots, recursive);
    let jobs = register(db, cache, &files)?;
    let total = files.len();
    let skipped = total - jobs.len();
    emit(ImportEvent::Started {
        total,
        to_process: jobs.len(),
    });
    emit(ImportEvent::Progress {
        done: skipped,
        total,
        photo: None,
    });

    let done = AtomicUsize::new(skipped);
    let errors = Mutex::new(Vec::<ImportError>::new());
    let failed = AtomicUsize::new(0);

    let threads = if threads == 0 {
        num_cpus::get().saturating_sub(1).max(1)
    } else {
        threads
    };
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(|i| format!("import-{i}"))
        .build()
        .expect("thread pool");

    pool.install(|| {
        jobs.par_iter().for_each(|job| {
            let result = process(job, cache);
            let photo = db.lock().ok().and_then(|conn| {
                let write = match &result {
                    Ok((hash, d)) => catalog::mark_ready(
                        &conn,
                        job.id,
                        hash,
                        d.width,
                        d.height,
                        d.orientation,
                        &d.exif,
                    ),
                    Err((hash, msg)) => catalog::mark_error(&conn, job.id, hash.as_deref(), msg),
                };
                write.ok()?;
                catalog::get_photo(&conn, job.id)
                    .ok()
                    .flatten()
                    .map(Box::new)
            });
            if let Err((_, message)) = &result {
                failed.fetch_add(1, Ordering::Relaxed);
                let mut errors = errors.lock().unwrap_or_else(|e| e.into_inner());
                if errors.len() < MAX_REPORTED_ERRORS {
                    errors.push(ImportError {
                        path: catalog::path_str(&job.path),
                        message: message.clone(),
                    });
                }
            }
            let done = done.fetch_add(1, Ordering::Relaxed) + 1;
            emit(ImportEvent::Progress { done, total, photo });
        });
    });

    let failed = failed.into_inner();
    let summary = ImportSummary {
        total,
        processed: jobs.len() - failed,
        skipped,
        failed,
        errors: errors.into_inner().unwrap_or_default(),
    };
    let _ = std::fs::remove_dir(cache.tmp());
    emit(ImportEvent::Finished(summary.clone()));
    Ok(summary)
}
