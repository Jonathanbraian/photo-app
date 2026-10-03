//! Generates the test fixtures in `tests/fixtures/`:
//!
//! - `orientation6.jpg`: 600×400 JPEG (left half red, right half blue) with
//!   EXIF Orientation = 6 and camera/lens/exposure tags. Displayed upright it
//!   is 400×600 with red on top.
//! - `tiny.dng`: 320×240 16-bit CFA DNG with an embedded 320×240 JPEG preview
//!   (left half green, right half magenta), Orientation = 8 and EXIF tags.
//!   Displayed upright it is 240×320 with green at the bottom.
//!
//! Run with `cargo run --example make_fixtures` from `src-tauri/`.

use std::io::Cursor;
use std::path::Path;

use image::{codecs::jpeg::JpegEncoder, Rgb, RgbImage};

const BYTE: u16 = 1;
const ASCII: u16 = 2;
const SHORT: u16 = 3;
const LONG: u16 = 4;
const RATIONAL: u16 = 5;
const SRATIONAL: u16 = 10;

/// One IFD entry. Values are stored already encoded (little-endian).
struct Entry {
    tag: u16,
    kind: u16,
    count: u32,
    data: Vec<u8>,
}

fn ascii(tag: u16, s: &str) -> Entry {
    let mut data = s.as_bytes().to_vec();
    data.push(0);
    Entry {
        tag,
        kind: ASCII,
        count: data.len() as u32,
        data,
    }
}
fn bytes(tag: u16, v: &[u8]) -> Entry {
    Entry {
        tag,
        kind: BYTE,
        count: v.len() as u32,
        data: v.to_vec(),
    }
}
fn shorts(tag: u16, v: &[u16]) -> Entry {
    let data = v.iter().flat_map(|x| x.to_le_bytes()).collect();
    Entry {
        tag,
        kind: SHORT,
        count: v.len() as u32,
        data,
    }
}
fn longs(tag: u16, v: &[u32]) -> Entry {
    let data = v.iter().flat_map(|x| x.to_le_bytes()).collect();
    Entry {
        tag,
        kind: LONG,
        count: v.len() as u32,
        data,
    }
}
fn rationals(tag: u16, v: &[(u32, u32)]) -> Entry {
    let data = v
        .iter()
        .flat_map(|(n, d)| [n.to_le_bytes(), d.to_le_bytes()].concat())
        .collect();
    Entry {
        tag,
        kind: RATIONAL,
        count: v.len() as u32,
        data,
    }
}
fn srationals(tag: u16, v: &[(i32, i32)]) -> Entry {
    let data = v
        .iter()
        .flat_map(|(n, d)| [n.to_le_bytes(), d.to_le_bytes()].concat())
        .collect();
    Entry {
        tag,
        kind: SRATIONAL,
        count: v.len() as u32,
        data,
    }
}

/// Minimal little-endian TIFF writer: append blobs and IFDs, children first.
struct Tiff {
    buf: Vec<u8>,
}

impl Tiff {
    fn new() -> Self {
        Self {
            buf: vec![b'I', b'I', 42, 0, 0, 0, 0, 0],
        }
    }

    fn align(&mut self) {
        if self.buf.len() % 2 == 1 {
            self.buf.push(0);
        }
    }

    fn blob(&mut self, data: &[u8]) -> u32 {
        self.align();
        let offset = self.buf.len() as u32;
        self.buf.extend_from_slice(data);
        offset
    }

    fn ifd(&mut self, mut entries: Vec<Entry>) -> u32 {
        entries.sort_by_key(|e| e.tag);
        self.align();
        let start = self.buf.len() as u32;
        let mut extra_offset = start + 2 + 12 * entries.len() as u32 + 4;
        let mut extra = Vec::new();
        self.buf
            .extend_from_slice(&(entries.len() as u16).to_le_bytes());
        for e in &entries {
            self.buf.extend_from_slice(&e.tag.to_le_bytes());
            self.buf.extend_from_slice(&e.kind.to_le_bytes());
            self.buf.extend_from_slice(&e.count.to_le_bytes());
            if e.data.len() <= 4 {
                let mut inline = e.data.clone();
                inline.resize(4, 0);
                self.buf.extend_from_slice(&inline);
            } else {
                self.buf.extend_from_slice(&extra_offset.to_le_bytes());
                extra.extend_from_slice(&e.data);
                if extra.len() % 2 == 1 {
                    extra.push(0);
                }
                extra_offset = start + 2 + 12 * entries.len() as u32 + 4 + extra.len() as u32;
            }
        }
        self.buf.extend_from_slice(&0u32.to_le_bytes());
        self.buf.extend_from_slice(&extra);
        start
    }

    fn finish(mut self, ifd0: u32) -> Vec<u8> {
        self.buf[4..8].copy_from_slice(&ifd0.to_le_bytes());
        self.buf
    }
}

fn exif_entries(lens: &str) -> Vec<Entry> {
    vec![
        rationals(0x829A, &[(1, 250)]),       // ExposureTime
        rationals(0x829D, &[(28, 10)]),       // FNumber
        shorts(0x8827, &[400]),               // ISO
        ascii(0x9003, "2026:09:15 14:30:00"), // DateTimeOriginal
        ascii(0xA434, lens),                  // LensModel
    ]
}

fn two_tone(w: u32, h: u32, left: [u8; 3], right: [u8; 3]) -> RgbImage {
    RgbImage::from_fn(w, h, |x, _| Rgb(if x < w / 2 { left } else { right }))
}

fn jpeg_bytes(img: &RgbImage, quality: u8) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    img.write_with_encoder(JpegEncoder::new_with_quality(&mut out, quality))
        .unwrap();
    out.into_inner()
}

fn make_jpeg(dir: &Path) {
    let jpeg = jpeg_bytes(&two_tone(600, 400, [220, 30, 30], [30, 30, 220]), 90);

    let mut tiff = Tiff::new();
    let exif = tiff.ifd(exif_entries("Test Lens 50mm F1.8"));
    let ifd0 = tiff.ifd(vec![
        ascii(0x010F, "TestMake"),
        ascii(0x0110, "TestModel"),
        shorts(0x0112, &[6]),
        longs(0x8769, &[exif]),
    ]);
    let tiff = tiff.finish(ifd0);

    // Insert an APP1 "Exif" segment right after SOI.
    let mut app1 = b"Exif\0\0".to_vec();
    app1.extend_from_slice(&tiff);
    let mut out = jpeg[..2].to_vec();
    out.extend_from_slice(&[0xFF, 0xE1]);
    out.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(&app1);
    out.extend_from_slice(&jpeg[2..]);
    std::fs::write(dir.join("orientation6.jpg"), out).unwrap();
}

fn make_dng(dir: &Path) {
    let (w, h) = (320u32, 240u32);

    // RGGB Bayer mosaic of a flat mid-grey scene.
    let raw: Vec<u8> = (0..w * h).flat_map(|_| 20_000u16.to_le_bytes()).collect();
    let preview = jpeg_bytes(&two_tone(w, h, [30, 200, 30], [200, 30, 200]), 90);
    let thumb_img = two_tone(64, 48, [30, 200, 30], [200, 30, 200]);
    let thumb = thumb_img.as_raw().clone();

    let mut tiff = Tiff::new();
    let raw_off = tiff.blob(&raw);
    let preview_off = tiff.blob(&preview);
    let thumb_off = tiff.blob(&thumb);

    let raw_ifd = tiff.ifd(vec![
        longs(0x00FE, &[0]), // NewSubFileType: main image
        longs(0x0100, &[w]),
        longs(0x0101, &[h]),
        shorts(0x0102, &[16]),
        shorts(0x0103, &[1]),     // uncompressed
        shorts(0x0106, &[32803]), // CFA
        longs(0x0111, &[raw_off]),
        shorts(0x0115, &[1]),
        longs(0x0116, &[h]),
        longs(0x0117, &[w * h * 2]),
        shorts(0x011C, &[1]),
        shorts(0x828D, &[2, 2]),      // CFARepeatPatternDim
        bytes(0x828E, &[0, 1, 1, 2]), // CFAPattern RGGB
        bytes(0xC617, &[1]),          // CFALayout
        longs(0xC61A, &[0]),          // BlackLevel
        longs(0xC61D, &[65_535]),     // WhiteLevel
    ]);
    let preview_ifd = tiff.ifd(vec![
        longs(0x00FE, &[1]), // reduced-resolution preview
        longs(0x0100, &[w]),
        longs(0x0101, &[h]),
        shorts(0x0102, &[8, 8, 8]),
        shorts(0x0103, &[7]), // JPEG
        shorts(0x0106, &[6]), // YCbCr
        longs(0x0111, &[preview_off]),
        shorts(0x0115, &[3]),
        longs(0x0116, &[h]),
        longs(0x0117, &[preview.len() as u32]),
        longs(0xC71A, &[1]), // PreviewColorSpace: sRGB
    ]);
    let exif = tiff.ifd(exif_entries("Test Lens 35mm F2"));
    let ifd0 = tiff.ifd(vec![
        longs(0x00FE, &[1]),
        longs(0x0100, &[64]),
        longs(0x0101, &[48]),
        shorts(0x0102, &[8, 8, 8]),
        shorts(0x0103, &[1]),
        ascii(0x010F, "TestMake"),
        ascii(0x0110, "TestModel"),
        shorts(0x0106, &[2]), // RGB
        longs(0x0111, &[thumb_off]),
        shorts(0x0112, &[8]),
        shorts(0x0115, &[3]),
        longs(0x0116, &[48]),
        longs(0x0117, &[thumb.len() as u32]),
        longs(0x014A, &[raw_ifd, preview_ifd]), // SubIFDs
        longs(0x8769, &[exif]),
        bytes(0xC612, &[1, 4, 0, 0]), // DNGVersion
        bytes(0xC613, &[1, 1, 0, 0]), // DNGBackwardVersion
        ascii(0xC614, "TestMake TestModel"),
        // ColorMatrix1: identity (XYZ -> camera), D65.
        srationals(
            0xC621,
            &[
                (1, 1),
                (0, 1),
                (0, 1),
                (0, 1),
                (1, 1),
                (0, 1),
                (0, 1),
                (0, 1),
                (1, 1),
            ],
        ),
        shorts(0xC65A, &[21]),
        rationals(0xC628, &[(1, 1), (1, 1), (1, 1)]), // AsShotNeutral
    ]);
    std::fs::write(dir.join("tiny.dng"), tiff.finish(ifd0)).unwrap();
}

fn main() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    std::fs::create_dir_all(&dir).unwrap();
    make_jpeg(&dir);
    make_dng(&dir);
    println!("fixtures written to {}", dir.display());
}
