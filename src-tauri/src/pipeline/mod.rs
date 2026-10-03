//! Image pipeline. Step 2 covers decoding and cache generation; the
//! full-resolution adjustments (`adjust`) and encoders (`encode`) arrive in
//! steps 4 and 6.

pub mod decode;
pub mod exif;
mod heic;
pub mod thumbnail;

/// Supported source formats, detected by file extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Jpeg,
    Png,
    Tiff,
    Heic,
    Cr2,
    Cr3,
    Nef,
    Arw,
    Raf,
    Dng,
}

impl Format {
    pub fn from_path(path: &std::path::Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        Some(match ext.as_str() {
            "jpg" | "jpeg" => Self::Jpeg,
            "png" => Self::Png,
            "tif" | "tiff" => Self::Tiff,
            "heic" | "heif" => Self::Heic,
            "cr2" => Self::Cr2,
            "cr3" => Self::Cr3,
            "nef" => Self::Nef,
            "arw" => Self::Arw,
            "raf" => Self::Raf,
            "dng" => Self::Dng,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Jpeg => "jpeg",
            Self::Png => "png",
            Self::Tiff => "tiff",
            Self::Heic => "heic",
            Self::Cr2 => "cr2",
            Self::Cr3 => "cr3",
            Self::Nef => "nef",
            Self::Arw => "arw",
            Self::Raf => "raf",
            Self::Dng => "dng",
        }
    }

    pub fn is_raw(self) -> bool {
        matches!(
            self,
            Self::Cr2 | Self::Cr3 | Self::Nef | Self::Arw | Self::Raf | Self::Dng
        )
    }
}
