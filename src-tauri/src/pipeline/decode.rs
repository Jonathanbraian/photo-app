//! Turns a source file into an (unoriented) image plus its metadata.

use std::io::Cursor;
use std::path::Path;
use std::sync::Arc;

use image::{DynamicImage, ImageReader};

use super::{exif, heic, thumbnail::PREVIEW_SIZE, Format};
use crate::raw;

pub struct Decoded {
    /// Pixels as stored in the file (orientation not applied yet).
    pub image: DynamicImage,
    /// Orientation to apply for display (EXIF 1–8).
    pub orientation: u16,
    /// Full-resolution size as displayed (orientation applied).
    pub width: u32,
    pub height: u32,
    pub exif: exif::ExifSummary,
}

/// `bytes` is the file content (already read for hashing). The original file
/// is only ever opened for reading.
pub fn decode(
    path: &Path,
    format: Format,
    bytes: Arc<Vec<u8>>,
    tmp_dir: &Path,
    key: &str,
) -> Result<Decoded, String> {
    let (image, size, summary) = match format {
        f if f.is_raw() => {
            let raw = raw::decode(bytes)?;
            (raw.image, (raw.width, raw.height), raw.exif)
        }
        Format::Heic => {
            let mut summary = exif::read(&bytes);
            let heic = heic::decode(path, tmp_dir, key, PREVIEW_SIZE)?;
            if heic.orientation.is_some() {
                summary.orientation = heic.orientation;
            }
            let size = heic
                .full_size
                .unwrap_or((heic.image.width(), heic.image.height()));
            (heic.image, size, summary)
        }
        _ => {
            let summary = exif::read(&bytes);
            let mut reader = ImageReader::new(Cursor::new(bytes.as_slice()))
                .with_guessed_format()
                .map_err(|e| e.to_string())?;
            reader.no_limits();
            let image = reader.decode().map_err(|e| e.to_string())?;
            let size = (image.width(), image.height());
            (image, size, summary)
        }
    };

    let orientation = summary
        .orientation
        .filter(|o| (1..=8).contains(o))
        .unwrap_or(1);
    let (width, height) = if orientation >= 5 {
        (size.1, size.0)
    } else {
        size
    };
    Ok(Decoded {
        image,
        orientation,
        width,
        height,
        exif: summary,
    })
}
