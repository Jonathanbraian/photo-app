//! RAW decoding via `rawler` (CR2, CR3, NEF, ARW, RAF, DNG).
//!
//! For speed, the import uses the JPEG preview the camera embeds in the RAW.
//! Only when there is none (or it is tiny) is the sensor data developed.

use std::sync::Arc;

use image::DynamicImage;
use rawler::{
    decoders::{Decoder, RawDecodeParams},
    imgop::develop::RawDevelop,
    rawsource::RawSource,
    RawImage,
};

use crate::pipeline::exif::{camera_name, normalize_date, ExifSummary};

pub struct RawPhoto {
    /// Unoriented image (embedded preview or developed raw).
    pub image: DynamicImage,
    /// Unoriented size of the full-resolution raw image.
    pub width: u32,
    pub height: u32,
    pub exif: ExifSummary,
    pub used_embedded: bool,
}

pub fn decode(bytes: Arc<Vec<u8>>) -> Result<RawPhoto, String> {
    let src = RawSource::new_from_shared_vec(bytes);
    let decoder = rawler::get_decoder(&src).map_err(|e| e.to_string())?;
    let params = RawDecodeParams::default();
    let metadata = decoder
        .raw_metadata(&src, &params)
        .map_err(|e| e.to_string())?;
    // `dummy = true` parses the layout without decompressing sensor data.
    let layout = decoder
        .raw_image(&src, &params, true)
        .map_err(|e| e.to_string())?;
    let (width, height) = raw_size(&layout);

    let min_side = width.max(height).min(1024);
    let embedded = [
        decoder.preview_image(&src, &params),
        decoder.full_image(&src, &params),
    ]
    .into_iter()
    .filter_map(|r| r.ok().flatten())
    .max_by_key(|img| img.width().max(img.height()))
    .filter(|img| img.width().max(img.height()) >= min_side);

    let (image, used_embedded) = match embedded {
        Some(img) => (img, true),
        None => (develop_source(decoder.as_ref(), &src, &params)?, false),
    };

    let exif = &metadata.exif;
    let lens = exif.lens_model.clone().or_else(|| {
        metadata.lens.as_ref().map(|l| {
            format!("{} {}", l.lens_make, l.lens_model)
                .trim()
                .to_string()
        })
    });
    let summary = ExifSummary {
        camera: camera_name(non_empty(&metadata.make), non_empty(&metadata.model)),
        lens: lens.filter(|l| !l.is_empty()),
        iso: exif
            .iso_speed_ratings
            .map(u32::from)
            .or(exif.iso_speed)
            .or(exif.recommended_exposure_index),
        aperture: exif.fnumber.and_then(|r| ratio(r.n, r.d)),
        shutter_speed: exif.exposure_time.and_then(|r| ratio(r.n, r.d)),
        taken_at: exif
            .date_time_original
            .as_deref()
            .or(exif.create_date.as_deref())
            .and_then(normalize_date),
        orientation: exif
            .orientation
            .or_else(|| Some(layout.orientation.to_u16()))
            .filter(|o| (1..=8).contains(o)),
    };

    Ok(RawPhoto {
        image,
        width,
        height,
        exif: summary,
        used_embedded,
    })
}

/// Develops the sensor data (demosaic, white balance, color, sRGB), ignoring
/// any embedded preview. Slow; used only when the RAW has no usable preview.
pub fn develop(bytes: Arc<Vec<u8>>) -> Result<DynamicImage, String> {
    let src = RawSource::new_from_shared_vec(bytes);
    let decoder = rawler::get_decoder(&src).map_err(|e| e.to_string())?;
    develop_source(decoder.as_ref(), &src, &RawDecodeParams::default())
}

fn develop_source(
    decoder: &dyn Decoder,
    src: &RawSource,
    params: &RawDecodeParams,
) -> Result<DynamicImage, String> {
    let raw = decoder
        .raw_image(src, params, false)
        .map_err(|e| e.to_string())?;
    RawDevelop::default()
        .develop_intermediate(&raw)
        .map_err(|e| e.to_string())?
        .to_dynamic_image()
        .ok_or_else(|| "falha ao revelar o RAW".to_string())
}

fn raw_size(raw: &RawImage) -> (u32, u32) {
    let (w, h) = match raw.crop_area {
        Some(rect) => (rect.d.w, rect.d.h),
        None => (raw.width, raw.height),
    };
    (w as u32, h as u32)
}

fn ratio(n: u32, d: u32) -> Option<f64> {
    (d != 0).then(|| f64::from(n) / f64::from(d))
}

fn non_empty(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}
