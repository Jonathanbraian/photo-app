//! Preview (2048 px) and thumbnail (300 px) generation.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use fast_image_resize::{images::Image, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::{codecs::jpeg::JpegEncoder, metadata::Orientation, DynamicImage, RgbImage};

pub const THUMB_SIZE: u32 = 300;
pub const PREVIEW_SIZE: u32 = 2048;

/// Size that fits `(w, h)` inside a `max`×`max` box, never upscaling.
pub fn fit_size(w: u32, h: u32, max: u32) -> (u32, u32) {
    let longest = w.max(h);
    if longest <= max {
        return (w, h);
    }
    let scale = f64::from(max) / f64::from(longest);
    (
        ((f64::from(w) * scale).round() as u32).max(1),
        ((f64::from(h) * scale).round() as u32).max(1),
    )
}

pub fn resize_to_fit(src: &RgbImage, max: u32) -> Result<RgbImage, String> {
    let (w, h) = fit_size(src.width(), src.height(), max);
    if (w, h) == src.dimensions() {
        return Ok(src.clone());
    }
    let mut dst = Image::new(w, h, PixelType::U8x3);
    Resizer::new()
        .resize(
            src,
            &mut dst,
            &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3)),
        )
        .map_err(|e| e.to_string())?;
    RgbImage::from_raw(w, h, dst.into_vec()).ok_or_else(|| "falha ao redimensionar".into())
}

/// Builds the upright preview and thumbnail from an unoriented image.
/// Resizing happens before rotating, which is much cheaper on large photos.
pub fn render(image: DynamicImage, orientation: u16) -> Result<(RgbImage, RgbImage), String> {
    let rgb = image.into_rgb8();
    let preview = resize_to_fit(&rgb, PREVIEW_SIZE)?;
    drop(rgb);
    let mut preview = DynamicImage::ImageRgb8(preview);
    if let Some(o) = u8::try_from(orientation)
        .ok()
        .and_then(Orientation::from_exif)
    {
        preview.apply_orientation(o);
    }
    let preview = preview.into_rgb8();
    let thumb = resize_to_fit(&preview, THUMB_SIZE)?;
    Ok((preview, thumb))
}

/// Writes a JPEG atomically (temporary file + rename), so a crash never
/// leaves a truncated file in the cache.
pub fn write_jpeg(img: &RgbImage, path: &Path, quality: u8) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!("{}-{n}.tmp", std::process::id()));
    let result = (|| {
        let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut writer = std::io::BufWriter::new(file);
        img.write_with_encoder(JpegEncoder::new_with_quality(&mut writer, quality))
            .map_err(|e| e.to_string())?;
        drop(writer);
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_size_keeps_aspect_and_never_upscales() {
        assert_eq!(fit_size(6000, 4000, 2048), (2048, 1365));
        assert_eq!(fit_size(4000, 6000, 300), (200, 300));
        assert_eq!(fit_size(120, 80, 300), (120, 80));
    }
}
