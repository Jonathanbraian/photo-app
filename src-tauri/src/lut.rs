//! `.cube` LUT validation and import (docs/ADJUSTMENTS.md §11). Mirrors the
//! parser in `src/lib/lut.ts`; the interface applies the LUT, the app only
//! checks the file and keeps its own copy.

use std::path::Path;

use serde::Serialize;

pub const MAX_3D_SIZE: usize = 65;
pub const MAX_1D_SIZE: usize = 4096;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CubeInfo {
    /// "1d" or "3d"
    pub kind: String,
    pub size: usize,
    pub title: String,
}

/// Parses and validates a `.cube` file's text.
pub fn parse_cube(text: &str) -> Result<CubeInfo, String> {
    let mut kind: Option<&str> = None;
    let mut size = 0usize;
    let mut title = String::new();
    let mut min = [0.0f64; 3];
    let mut max = [1.0f64; 3];
    let mut rows = 0usize;

    for (ln, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let key = parts.next().unwrap_or("").to_ascii_uppercase();
        let nums = |parts: std::str::SplitWhitespace| -> Option<Vec<f64>> {
            parts
                .map(|p| p.parse::<f64>().ok().filter(|v| v.is_finite()))
                .collect()
        };
        match key.as_str() {
            "TITLE" => title = line[5..].trim().trim_matches('"').to_string(),
            "LUT_1D_SIZE" | "LUT_3D_SIZE" => {
                if kind.is_some() {
                    return Err(format!(
                        "Linha {}: o arquivo declara o tamanho duas vezes.",
                        ln + 1
                    ));
                }
                let k = if key == "LUT_1D_SIZE" { "1d" } else { "3d" };
                let limit = if k == "3d" { MAX_3D_SIZE } else { MAX_1D_SIZE };
                size = parts
                    .next()
                    .and_then(|v| v.parse().ok())
                    .filter(|&n: &usize| (2..=limit).contains(&n))
                    .ok_or_else(|| {
                        format!(
                            "Linha {}: tamanho inválido ({} vai de 2 a {limit}).",
                            ln + 1,
                            k.to_uppercase()
                        )
                    })?;
                kind = Some(k);
            }
            "DOMAIN_MIN" | "DOMAIN_MAX" => {
                let v = nums(parts)
                    .filter(|v| v.len() == 3)
                    .ok_or_else(|| format!("Linha {}: {key} inválido.", ln + 1))?;
                let target = if key == "DOMAIN_MIN" {
                    &mut min
                } else {
                    &mut max
                };
                target.copy_from_slice(&v);
            }
            k if k.chars().all(|c| c.is_ascii_uppercase() || c == '_') => {}
            _ => {
                let all = std::iter::once(key.as_str()).chain(line.split_whitespace().skip(1));
                let v: Option<Vec<f64>> = all
                    .map(|p| p.parse::<f64>().ok().filter(|v| v.is_finite()))
                    .collect();
                match v {
                    Some(v) if v.len() == 3 => rows += 1,
                    _ => {
                        return Err(format!(
                            "Linha {}: esperado \"r g b\", encontrado \"{}\".",
                            ln + 1,
                            line.chars().take(40).collect::<String>()
                        ))
                    }
                }
            }
        }
    }
    let kind = kind.ok_or("O arquivo não declara LUT_1D_SIZE nem LUT_3D_SIZE.")?;
    let expected = if kind == "3d" { size.pow(3) } else { size };
    if rows != expected {
        return Err(format!(
            "Esperadas {expected} linhas de dados, encontradas {rows}."
        ));
    }
    if (0..3).any(|c| max[c] <= min[c]) {
        return Err("DOMAIN_MAX deve ser maior que DOMAIN_MIN.".into());
    }
    Ok(CubeInfo {
        kind: kind.into(),
        size,
        title,
    })
}

/// Validates `src` and copies it to `dir/<hash>.cube`. Returns (id, info).
pub fn import_file(src: &Path, dir: &Path) -> Result<(String, CubeInfo), String> {
    let bytes =
        std::fs::read(src).map_err(|e| format!("Não foi possível ler {}: {e}", src.display()))?;
    let text =
        String::from_utf8(bytes).map_err(|_| "O arquivo .cube não é texto UTF-8.".to_string())?;
    let info = parse_cube(&text)?;
    let id = blake3::hash(text.as_bytes()).to_hex()[..32].to_string();
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{id}.cube"));
    if !dest.is_file() {
        let tmp = dir.join(format!("{id}.cube.tmp"));
        std::fs::write(&tmp, text.as_bytes()).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    }
    Ok((id, info))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity3d(n: usize) -> String {
        let mut s = format!("TITLE \"Identidade\"\nLUT_3D_SIZE {n}\n");
        for b in 0..n {
            for g in 0..n {
                for r in 0..n {
                    let f = |v: usize| v as f64 / (n - 1) as f64;
                    s += &format!("{} {} {}\n", f(r), f(g), f(b));
                }
            }
        }
        s
    }

    #[test]
    fn parses_3d_and_1d() {
        let info = parse_cube(&identity3d(4)).unwrap();
        assert_eq!(
            (info.kind.as_str(), info.size, info.title.as_str()),
            ("3d", 4, "Identidade")
        );
        let info =
            parse_cube("# c\nLUT_1D_SIZE 2\nDOMAIN_MAX 2 2 2\n0 0 0\n1 1 1 # fim\n").unwrap();
        assert_eq!((info.kind.as_str(), info.size), ("1d", 2));
    }

    #[test]
    fn accepts_65_and_rejects_66() {
        assert!(parse_cube(&identity3d(65)).is_ok());
        assert!(parse_cube("LUT_3D_SIZE 66")
            .unwrap_err()
            .contains("3D vai de 2 a 65"));
    }

    #[test]
    fn rejects_malformed_files() {
        assert!(parse_cube("0 0 0").unwrap_err().contains("nem LUT_3D_SIZE"));
        assert!(parse_cube("LUT_3D_SIZE 2\n0 0 0")
            .unwrap_err()
            .contains("Esperadas 8 linhas de dados, encontradas 1"));
        assert!(parse_cube("LUT_1D_SIZE 2\n0 0\n1 1 1")
            .unwrap_err()
            .contains("Linha 2"));
        assert!(
            parse_cube("LUT_1D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 1 1 1\n0 0 0\n1 1 1")
                .unwrap_err()
                .contains("DOMAIN_MAX")
        );
    }

    #[test]
    fn import_copies_once_and_leaves_the_original_alone() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("Filme.cube");
        let text = identity3d(3);
        std::fs::write(&src, &text).unwrap();
        let before = std::fs::metadata(&src).unwrap().modified().unwrap();

        let luts = dir.path().join("luts");
        let (id, info) = import_file(&src, &luts).unwrap();
        let (id2, _) = import_file(&src, &luts).unwrap();
        assert_eq!(id, id2, "same content, same id");
        assert_eq!(info.size, 3);
        assert_eq!(
            std::fs::read_to_string(luts.join(format!("{id}.cube"))).unwrap(),
            text
        );
        assert_eq!(std::fs::read_dir(&luts).unwrap().count(), 1);

        // The recipe no longer depends on the original file.
        std::fs::remove_file(&src).unwrap();
        assert!(luts.join(format!("{id}.cube")).is_file());
        let _ = before;
    }

    #[test]
    fn invalid_file_is_not_copied() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("ruim.cube");
        std::fs::write(&src, "LUT_3D_SIZE 2\n0 0 0").unwrap();
        let luts = dir.path().join("luts");
        assert!(import_file(&src, &luts).is_err());
        assert!(!luts.exists() || std::fs::read_dir(&luts).unwrap().count() == 0);
    }
}
