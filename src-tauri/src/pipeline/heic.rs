//! HEIC/HEIF decoding through the operating system's own codec:
//! ImageIO (via `sips`) on macOS and WIC on Windows. This avoids bundling an
//! HEVC decoder. On Windows it needs Microsoft's "HEIF Image Extensions" and
//! "HEVC Video Extensions", the same requirement as the Photos app.

use std::path::Path;

use image::DynamicImage;

pub struct HeicImage {
    /// Unoriented image, already scaled to fit the preview size.
    pub image: DynamicImage,
    /// Full-resolution size, when the decoder reports it.
    pub full_size: Option<(u32, u32)>,
    /// Orientation reported by the decoder output; `None` means "use EXIF".
    pub orientation: Option<u16>,
}

#[cfg(target_os = "macos")]
pub fn decode(path: &Path, tmp_dir: &Path, key: &str, max_side: u32) -> Result<HeicImage, String> {
    use std::process::Command;

    std::fs::create_dir_all(tmp_dir).map_err(|e| e.to_string())?;
    let out = tmp_dir.join(format!("heic-{key}.jpg"));
    let status = Command::new("/usr/bin/sips")
        .args(["-s", "format", "jpeg", "-s", "formatOptions", "95", "-Z"])
        .arg(max_side.to_string())
        .arg(path)
        .arg("--out")
        .arg(&out)
        .output()
        .map_err(|e| format!("falha ao executar sips: {e}"))?;
    if !status.status.success() {
        let _ = std::fs::remove_file(&out);
        return Err(format!(
            "sips não conseguiu ler o HEIC: {}",
            String::from_utf8_lossy(&status.stderr).trim()
        ));
    }
    let bytes = std::fs::read(&out).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&out);
    let bytes = bytes?;
    let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;
    Ok(HeicImage {
        image,
        full_size: None,
        orientation: super::exif::read(&bytes).orientation,
    })
}

#[cfg(windows)]
pub fn decode(
    path: &Path,
    _tmp_dir: &Path,
    _key: &str,
    max_side: u32,
) -> Result<HeicImage, String> {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::GENERIC_READ;
    use windows::Win32::Graphics::Imaging::*;
    use windows::Win32::System::Com::*;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let missing_codec = |e: windows::core::Error| {
        format!(
            "o Windows não conseguiu ler o HEIC ({e}). Instale \"Extensões de Imagem HEIF\" e \
             \"Extensões de Vídeo HEVC\" pela Microsoft Store"
        )
    };

    unsafe {
        // Already-initialized threads return S_FALSE / RPC_E_CHANGED_MODE; both are fine.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| e.to_string())?;
        let decoder = factory
            .CreateDecoderFromFilename(
                PCWSTR(wide.as_ptr()),
                None,
                GENERIC_READ,
                WICDecodeMetadataCacheOnDemand,
            )
            .map_err(missing_codec)?;
        let frame = decoder.GetFrame(0).map_err(missing_codec)?;
        let (mut w, mut h) = (0u32, 0u32);
        frame.GetSize(&mut w, &mut h).map_err(|e| e.to_string())?;
        if w == 0 || h == 0 {
            return Err("HEIC com dimensões inválidas".into());
        }
        let scale = (f64::from(max_side) / f64::from(w.max(h))).min(1.0);
        let tw = ((f64::from(w) * scale).round() as u32).max(1);
        let th = ((f64::from(h) * scale).round() as u32).max(1);

        let scaler = factory.CreateBitmapScaler().map_err(|e| e.to_string())?;
        scaler
            .Initialize(&frame, tw, th, WICBitmapInterpolationModeFant)
            .map_err(|e| e.to_string())?;
        let converter = factory.CreateFormatConverter().map_err(|e| e.to_string())?;
        converter
            .Initialize(
                &scaler,
                &GUID_WICPixelFormat24bppRGB,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )
            .map_err(|e| e.to_string())?;
        let stride = tw * 3;
        let mut buf = vec![0u8; (stride * th) as usize];
        converter
            .CopyPixels(std::ptr::null(), stride, &mut buf)
            .map_err(missing_codec)?;
        let image = image::RgbImage::from_raw(tw, th, buf).ok_or("buffer HEIC inválido")?;
        Ok(HeicImage {
            image: DynamicImage::ImageRgb8(image),
            full_size: Some((w, h)),
            orientation: None,
        })
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn decode(
    _path: &Path,
    _tmp_dir: &Path,
    _key: &str,
    _max_side: u32,
) -> Result<HeicImage, String> {
    Err("HEIC só é suportado no macOS e no Windows".into())
}
