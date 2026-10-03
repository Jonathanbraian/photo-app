//! Main EXIF fields shown in the library (camera, lens, exposure, date).

use std::io::Cursor;

use exif::{In, Tag, Value};
use serde::Serialize;

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExifSummary {
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<u32>,
    /// f-number, e.g. 2.8
    pub aperture: Option<f64>,
    /// Exposure time in seconds, e.g. 0.004 for 1/250
    pub shutter_speed: Option<f64>,
    /// `YYYY-MM-DDTHH:MM:SS`, camera local time
    pub taken_at: Option<String>,
    /// EXIF orientation (1–8)
    pub orientation: Option<u16>,
}

/// Reads EXIF from JPEG, TIFF, PNG or HEIF bytes. Missing EXIF is not an error.
pub fn read(bytes: &[u8]) -> ExifSummary {
    let Ok(exif) = exif::Reader::new().read_from_container(&mut Cursor::new(bytes)) else {
        return ExifSummary::default();
    };
    let text = |tag| {
        exif.get_field(tag, In::PRIMARY)
            .map(|f| clean(&f.display_value().to_string()))
            .filter(|s| !s.is_empty())
    };
    let rational = |tag| match exif.get_field(tag, In::PRIMARY).map(|f| &f.value) {
        Some(Value::Rational(v)) if !v.is_empty() && v[0].denom != 0 => Some(v[0].to_f64()),
        _ => None,
    };
    let uint = |tag| {
        exif.get_field(tag, In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
    };

    let date = exif
        .get_field(Tag::DateTimeOriginal, In::PRIMARY)
        .or_else(|| exif.get_field(Tag::DateTime, In::PRIMARY))
        .and_then(|f| match &f.value {
            Value::Ascii(v) if !v.is_empty() => std::str::from_utf8(&v[0]).ok().map(str::to_owned),
            _ => None,
        });

    ExifSummary {
        camera: camera_name(text(Tag::Make), text(Tag::Model)),
        lens: text(Tag::LensModel),
        iso: uint(Tag::PhotographicSensitivity),
        aperture: rational(Tag::FNumber),
        shutter_speed: rational(Tag::ExposureTime),
        taken_at: date.as_deref().and_then(normalize_date),
        orientation: uint(Tag::Orientation).and_then(|o| u16::try_from(o).ok()),
    }
}

fn clean(s: &str) -> String {
    s.trim_matches(|c: char| c == '"' || c.is_whitespace() || c == '\0')
        .to_string()
}

/// "Canon" + "Canon EOS R5" → "Canon EOS R5"; "NIKON CORPORATION" + "NIKON Z 6" → "NIKON Z 6".
pub fn camera_name(make: Option<String>, model: Option<String>) -> Option<String> {
    match (make, model) {
        (Some(make), Some(model)) => {
            let first = make.split_whitespace().next().unwrap_or("");
            if model.to_lowercase().starts_with(&first.to_lowercase()) {
                Some(model)
            } else {
                Some(format!("{make} {model}"))
            }
        }
        (None, Some(model)) => Some(model),
        (Some(make), None) => Some(make),
        (None, None) => None,
    }
}

/// "2026:09:15 14:30:00" → "2026-09-15T14:30:00".
pub fn normalize_date(raw: &str) -> Option<String> {
    let raw = raw.trim_matches(|c: char| c == '\0' || c.is_whitespace());
    let b = raw.as_bytes();
    if b.len() < 19 || !b[..19].iter().any(u8::is_ascii_digit) || raw.starts_with("0000") {
        return None;
    }
    let (date, time) = (&raw[..10], &raw[11..19]);
    Some(format!("{}T{}", date.replace(':', "-"), time))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_name_avoids_repeating_make() {
        let s = |v: &str| Some(v.to_string());
        assert_eq!(
            camera_name(s("Canon"), s("Canon EOS R5")),
            s("Canon EOS R5")
        );
        assert_eq!(
            camera_name(s("NIKON CORPORATION"), s("NIKON Z 6")),
            s("NIKON Z 6")
        );
        assert_eq!(camera_name(s("SONY"), s("ILCE-7M4")), s("SONY ILCE-7M4"));
    }

    #[test]
    fn normalizes_exif_dates() {
        assert_eq!(
            normalize_date("2026:09:15 14:30:00").as_deref(),
            Some("2026-09-15T14:30:00")
        );
        assert_eq!(normalize_date("0000:00:00 00:00:00"), None);
        assert_eq!(normalize_date("bad"), None);
    }
}
