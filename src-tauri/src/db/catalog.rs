//! Catalog queries: folders and photos.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use super::DbError;
use crate::pipeline::exif::ExifSummary;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub photo_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id: i64,
    pub folder_id: Option<i64>,
    pub path: String,
    pub file_name: String,
    pub format: String,
    pub hash: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub orientation: Option<u16>,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<u32>,
    pub aperture: Option<f64>,
    pub shutter_speed: Option<f64>,
    pub taken_at: Option<String>,
    /// `pending`, `ready` or `error`
    pub cache_status: String,
    pub cache_error: Option<String>,
}

/// What the importer needs to know about a path already in the catalog.
#[derive(Debug, Clone)]
pub struct Existing {
    pub id: i64,
    pub hash: Option<String>,
    pub file_size: Option<i64>,
    pub modified_at: Option<i64>,
    pub cache_status: String,
}

const PHOTO_COLUMNS: &str = "id, folder_id, path, file_name, format, hash, width, height, \
     orientation, camera, lens, iso, aperture, shutter_speed, taken_at, cache_status, cache_error";

fn photo_from_row(row: &Row) -> rusqlite::Result<Photo> {
    Ok(Photo {
        id: row.get(0)?,
        folder_id: row.get(1)?,
        path: row.get(2)?,
        file_name: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        format: row.get(4)?,
        hash: row.get(5)?,
        width: row.get(6)?,
        height: row.get(7)?,
        orientation: row.get(8)?,
        camera: row.get(9)?,
        lens: row.get(10)?,
        iso: row.get(11)?,
        aperture: row.get(12)?,
        shutter_speed: row.get(13)?,
        taken_at: row.get(14)?,
        cache_status: row.get(15)?,
        cache_error: row.get(16)?,
    })
}

pub fn path_str(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Returns the id of the folder at `path`, creating it if needed.
pub fn upsert_folder(conn: &Connection, path: &Path) -> Result<i64, DbError> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_str(path));
    let id = conn.query_row(
        "INSERT INTO folders (path, name) VALUES (?1, ?2)
         ON CONFLICT (path) DO UPDATE SET name = excluded.name
         RETURNING id",
        params![path_str(path), name],
        |row| row.get(0),
    )?;
    Ok(id)
}

pub fn find_by_path(conn: &Connection, path: &Path) -> Result<Option<Existing>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, hash, file_size, modified_at, cache_status FROM photos WHERE path = ?1",
            [path_str(path)],
            |row| {
                Ok(Existing {
                    id: row.get(0)?,
                    hash: row.get(1)?,
                    file_size: row.get(2)?,
                    modified_at: row.get(3)?,
                    cache_status: row.get(4)?,
                })
            },
        )
        .optional()?)
}

/// Registers (or refreshes) a photo found on disk and marks its cache as
/// pending. The id of an existing path is kept, so its edits stay attached.
pub fn upsert_pending(
    conn: &Connection,
    path: &Path,
    folder_id: i64,
    format: &str,
    file_size: i64,
    modified_at: Option<i64>,
) -> Result<i64, DbError> {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let id = conn.query_row(
        "INSERT INTO photos (path, file_name, folder_id, format, file_size, modified_at, cache_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')
         ON CONFLICT (path) DO UPDATE SET
             file_name = excluded.file_name,
             folder_id = excluded.folder_id,
             format = excluded.format,
             file_size = excluded.file_size,
             modified_at = excluded.modified_at,
             cache_status = 'pending',
             cache_error = NULL
         RETURNING id",
        params![path_str(path), file_name, folder_id, format, file_size, modified_at],
        |row| row.get(0),
    )?;
    Ok(id)
}

pub fn mark_ready(
    conn: &Connection,
    id: i64,
    hash: &str,
    width: u32,
    height: u32,
    orientation: u16,
    exif: &ExifSummary,
) -> Result<(), DbError> {
    conn.execute(
        "UPDATE photos SET hash = ?2, width = ?3, height = ?4, orientation = ?5, camera = ?6,
             lens = ?7, iso = ?8, aperture = ?9, shutter_speed = ?10, taken_at = ?11,
             cache_status = 'ready', cache_error = NULL
         WHERE id = ?1",
        params![
            id,
            hash,
            width,
            height,
            orientation,
            exif.camera,
            exif.lens,
            exif.iso,
            exif.aperture,
            exif.shutter_speed,
            exif.taken_at,
        ],
    )?;
    Ok(())
}

pub fn mark_error(
    conn: &Connection,
    id: i64,
    hash: Option<&str>,
    message: &str,
) -> Result<(), DbError> {
    conn.execute(
        "UPDATE photos SET hash = COALESCE(?2, hash), cache_status = 'error', cache_error = ?3
         WHERE id = ?1",
        params![id, hash, message],
    )?;
    Ok(())
}

pub fn get_photo(conn: &Connection, id: i64) -> Result<Option<Photo>, DbError> {
    Ok(conn
        .query_row(
            &format!("SELECT {PHOTO_COLUMNS} FROM photos WHERE id = ?1"),
            [id],
            photo_from_row,
        )
        .optional()?)
}

/// Photos ordered by path; `folder_id = None` lists every photo.
pub fn list_photos(conn: &Connection, folder_id: Option<i64>) -> Result<Vec<Photo>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PHOTO_COLUMNS} FROM photos
         WHERE ?1 IS NULL OR folder_id = ?1
         ORDER BY path"
    ))?;
    let photos = stmt
        .query_map([folder_id], photo_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(photos)
}

pub fn list_folders(conn: &Connection) -> Result<Vec<Folder>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.path, f.name, COUNT(p.id)
         FROM folders f LEFT JOIN photos p ON p.folder_id = f.id
         GROUP BY f.id
         HAVING COUNT(p.id) > 0
         ORDER BY f.path",
    )?;
    let folders = stmt
        .query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                photo_count: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(folders)
}
