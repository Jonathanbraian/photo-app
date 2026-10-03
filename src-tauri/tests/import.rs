//! Import pipeline tests using the fixtures in `tests/fixtures/`
//! (regenerate them with `cargo run --example make_fixtures`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use image::{Rgb, RgbImage};
use photo_batch_editor_lib::db::{self, catalog};
use photo_batch_editor_lib::import::{self, CachePaths, ImportEvent};
use rusqlite::Connection;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

struct Env {
    _tmp: tempfile::TempDir,
    photos: PathBuf,
    cache: CachePaths,
    db: Mutex<Connection>,
}

/// Library folder layout:
///   photos/orientation6.jpg, photos/tiny.dng, photos/notes.txt
///   photos/sub/copy.jpg
fn setup() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let photos = tmp.path().join("photos");
    std::fs::create_dir_all(photos.join("sub")).unwrap();
    std::fs::copy(fixture("orientation6.jpg"), photos.join("orientation6.jpg")).unwrap();
    std::fs::copy(fixture("tiny.dng"), photos.join("tiny.dng")).unwrap();
    std::fs::write(photos.join("notes.txt"), "ignorar").unwrap();
    std::fs::copy(fixture("orientation6.jpg"), photos.join("sub/copy.jpg")).unwrap();
    let cache = CachePaths::new(tmp.path().join("cache"));
    let db = Mutex::new(db::open(&tmp.path().join("library.db")).unwrap());
    Env {
        _tmp: tmp,
        photos,
        cache,
        db,
    }
}

fn run(env: &Env, recursive: bool) -> (import::ImportSummary, Vec<ImportEvent>) {
    let events = Mutex::new(Vec::new());
    let summary = import::run(
        &env.db,
        &env.cache,
        std::slice::from_ref(&env.photos),
        recursive,
        2,
        &|e| events.lock().unwrap().push(e),
    )
    .unwrap();
    (summary, events.into_inner().unwrap())
}

fn photo_named(env: &Env, name: &str) -> catalog::Photo {
    let conn = env.db.lock().unwrap();
    catalog::list_photos(&conn, None)
        .unwrap()
        .into_iter()
        .find(|p| p.file_name == name)
        .unwrap_or_else(|| panic!("{name} not imported"))
}

fn load(path: &Path) -> RgbImage {
    image::open(path).unwrap().to_rgb8()
}

fn is_close(px: &Rgb<u8>, expected: [u8; 3]) -> bool {
    px.0.iter()
        .zip(expected)
        .all(|(a, b)| (i16::from(*a) - i16::from(b)).abs() < 40)
}

#[test]
fn imports_jpeg_with_exif_and_applies_orientation() {
    let env = setup();
    let (summary, _) = run(&env, false);
    assert_eq!(summary.total, 2, "only jpg + dng in the top folder");
    assert_eq!(summary.failed, 0, "{:?}", summary.errors);

    let photo = photo_named(&env, "orientation6.jpg");
    assert_eq!(photo.format, "jpeg");
    assert_eq!(photo.cache_status, "ready");
    // Stored 600×400 with orientation 6 → displayed 400×600.
    assert_eq!((photo.width, photo.height), (Some(400), Some(600)));
    assert_eq!(photo.orientation, Some(6));
    assert_eq!(photo.camera.as_deref(), Some("TestMake TestModel"));
    assert_eq!(photo.lens.as_deref(), Some("Test Lens 50mm F1.8"));
    assert_eq!(photo.iso, Some(400));
    assert_eq!(photo.aperture, Some(2.8));
    assert_eq!(photo.shutter_speed, Some(1.0 / 250.0));
    assert_eq!(photo.taken_at.as_deref(), Some("2026-09-15T14:30:00"));

    let hash = photo.hash.unwrap();
    let thumb = load(&env.cache.thumb(&hash));
    assert_eq!(thumb.dimensions(), (200, 300));
    // Rotated 90° clockwise: the red left half ends up on top.
    assert!(is_close(thumb.get_pixel(100, 20), [220, 30, 30]));
    assert!(is_close(thumb.get_pixel(100, 280), [30, 30, 220]));

    let preview = load(&env.cache.preview(&hash));
    assert_eq!(
        preview.dimensions(),
        (400, 600),
        "small images are not upscaled"
    );
}

#[test]
fn imports_raw_using_embedded_preview() {
    let env = setup();
    let (summary, _) = run(&env, false);
    assert_eq!(summary.failed, 0, "{:?}", summary.errors);

    let photo = photo_named(&env, "tiny.dng");
    assert_eq!(photo.format, "dng");
    assert_eq!(photo.cache_status, "ready");
    // Sensor is 320×240 with orientation 8 → displayed 240×320.
    assert_eq!((photo.width, photo.height), (Some(240), Some(320)));
    assert_eq!(photo.orientation, Some(8));
    assert_eq!(photo.camera.as_deref(), Some("TestMake TestModel"));
    assert_eq!(photo.lens.as_deref(), Some("Test Lens 35mm F2"));
    assert_eq!(photo.iso, Some(400));
    assert_eq!(photo.aperture, Some(2.8));
    assert_eq!(photo.taken_at.as_deref(), Some("2026-09-15T14:30:00"));

    let thumb = load(&env.cache.thumb(photo.hash.as_deref().unwrap()));
    assert_eq!(thumb.dimensions(), (225, 300));
    // Embedded preview is green | magenta; rotated 90° counter-clockwise the
    // green left half goes to the bottom.
    assert!(is_close(thumb.get_pixel(112, 280), [30, 200, 30]));
    assert!(is_close(thumb.get_pixel(112, 20), [200, 30, 200]));
}

#[test]
fn raw_decodes_with_embedded_preview_and_can_be_developed() {
    let bytes = std::sync::Arc::new(std::fs::read(fixture("tiny.dng")).unwrap());
    let raw = photo_batch_editor_lib::raw::decode(bytes.clone()).unwrap();
    assert!(raw.used_embedded);
    assert_eq!((raw.width, raw.height), (320, 240));

    // Fallback path for RAWs without a usable preview: develop the sensor
    // data. The fixture is a flat grey scene, so the result is neutral.
    let developed = photo_batch_editor_lib::raw::develop(bytes)
        .unwrap()
        .to_rgb8();
    assert_eq!(developed.dimensions(), (320, 240));
    let px = developed.get_pixel(160, 120).0;
    assert!(px.iter().all(|&c| c > 20), "not black: {px:?}");
    let spread = px.iter().max().unwrap() - px.iter().min().unwrap();
    assert!(spread < 40, "roughly neutral: {px:?}");
}

#[test]
fn recursive_option_controls_subfolders_and_ignores_other_files() {
    let env = setup();
    let (summary, _) = run(&env, false);
    assert_eq!(summary.total, 2);

    let (summary, _) = run(&env, true);
    assert_eq!(summary.total, 3, "subfolder photo included, .txt ignored");
    assert_eq!(summary.skipped, 2, "top-level photos already imported");
    assert_eq!(summary.processed, 1);

    let conn = env.db.lock().unwrap();
    let folders = catalog::list_folders(&conn).unwrap();
    assert_eq!(folders.len(), 2);
    assert_eq!(folders[0].name, "photos");
    assert_eq!(folders[0].photo_count, 2);
    assert_eq!(folders[1].name, "sub");
    assert_eq!(
        catalog::list_photos(&conn, Some(folders[1].id))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn reimporting_does_not_duplicate_and_keeps_ids() {
    let env = setup();
    run(&env, true);
    let before = {
        let conn = env.db.lock().unwrap();
        catalog::list_photos(&conn, None).unwrap()
    };
    assert_eq!(before.len(), 3);

    let (summary, events) = run(&env, true);
    assert_eq!(summary.skipped, 3);
    assert_eq!(summary.processed, 0);
    assert!(matches!(
        events.last(),
        Some(ImportEvent::Finished(s)) if s.total == 3
    ));

    let after = {
        let conn = env.db.lock().unwrap();
        catalog::list_photos(&conn, None).unwrap()
    };
    let ids = |v: &[catalog::Photo]| v.iter().map(|p| p.id).collect::<Vec<_>>();
    assert_eq!(ids(&before), ids(&after));
}

#[test]
fn changed_file_is_reprocessed_with_same_id() {
    let env = setup();
    run(&env, false);
    let old = photo_named(&env, "orientation6.jpg");

    // Replace the content (a different, smaller JPEG without EXIF).
    let path = env.photos.join("orientation6.jpg");
    image::RgbImage::from_pixel(30, 20, Rgb([10, 200, 10]))
        .save(&path)
        .unwrap();
    let (summary, _) = run(&env, false);
    assert_eq!(summary.processed, 1);

    let new = photo_named(&env, "orientation6.jpg");
    assert_eq!(new.id, old.id);
    assert_ne!(new.hash, old.hash);
    assert_eq!((new.width, new.height), (Some(30), Some(20)));
}

#[test]
fn progress_events_count_up_to_total() {
    let env = setup();
    let (_, events) = run(&env, true);
    assert!(matches!(
        events.first(),
        Some(ImportEvent::Started {
            total: 3,
            to_process: 3
        })
    ));
    let mut dones: Vec<usize> = events
        .iter()
        .filter_map(|e| match e {
            ImportEvent::Progress {
                done,
                photo: Some(_),
                ..
            } => Some(*done),
            _ => None,
        })
        .collect();
    dones.sort();
    assert_eq!(dones, vec![1, 2, 3]);
}

#[test]
fn corrupt_file_is_reported_without_stopping_the_import() {
    let env = setup();
    std::fs::write(env.photos.join("broken.cr3"), b"not a raw file").unwrap();
    let (summary, _) = run(&env, false);
    assert_eq!(summary.total, 3);
    assert_eq!(summary.failed, 1);
    assert_eq!(summary.processed, 2);
    assert!(summary.errors[0].path.ends_with("broken.cr3"));
    assert_eq!(photo_named(&env, "broken.cr3").cache_status, "error");
}

#[test]
fn originals_are_never_modified() {
    let env = setup();
    let files = ["orientation6.jpg", "tiny.dng", "sub/copy.jpg"];
    let snapshot = || {
        files
            .iter()
            .map(|f| {
                let p = env.photos.join(f);
                (
                    std::fs::read(&p).unwrap(),
                    std::fs::metadata(&p).unwrap().modified().unwrap(),
                )
            })
            .collect::<Vec<_>>()
    };
    let before = snapshot();
    run(&env, true);
    run(&env, true);
    assert_eq!(before, snapshot());
    let entries: Vec<_> = std::fs::read_dir(&env.photos).unwrap().collect();
    assert_eq!(entries.len(), 4, "no files created next to the originals");
}

/// HEIC goes through the system codec; on macOS we can create one with `sips`.
#[cfg(target_os = "macos")]
#[test]
fn imports_heic_on_macos() {
    let env = setup();
    let heic = env.photos.join("sub/photo.heic");
    let status = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "heic"])
        .arg(fixture("orientation6.jpg"))
        .arg("--out")
        .arg(&heic)
        .status()
        .unwrap();
    assert!(status.success());

    let (summary, _) = run(&env, true);
    assert_eq!(summary.failed, 0, "{:?}", summary.errors);
    let photo = photo_named(&env, "photo.heic");
    assert_eq!(photo.format, "heic");
    assert_eq!(photo.cache_status, "ready");
    let thumb = load(&env.cache.thumb(photo.hash.as_deref().unwrap()));
    assert_eq!(
        thumb.dimensions(),
        (200, 300),
        "upright, like the source JPEG"
    );
    assert!(is_close(thumb.get_pixel(100, 20), [220, 30, 30]));
}
