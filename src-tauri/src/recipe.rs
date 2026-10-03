//! Recipe: the versioned JSON with a photo's adjustments (docs/SPEC.md).
//! Mirrors `src/lib/recipe.ts`; formulas live in docs/ADJUSTMENTS.md.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Recipe {
    pub version: u32,
    pub light: Light,
    pub color: Color,
    pub presence: Presence,
    pub hsl: BTreeMap<String, Hsl>,
    pub curve: Curve,
    pub lut: Option<String>,
    pub crop: Crop,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Light {
    pub exposure: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub whites: f64,
    pub blacks: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Color {
    /// Kelvin; 6500 is neutral.
    pub temperature: f64,
    pub tint: f64,
    pub vibrance: f64,
    pub saturation: f64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Presence {
    pub sharpness: f64,
    pub clarity: f64,
    pub noise: f64,
    pub vignette: f64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Hsl {
    pub h: f64,
    pub s: f64,
    pub l: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Curve {
    pub rgb: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub angle: f64,
    pub ratio: Option<String>,
}

impl Default for Recipe {
    fn default() -> Self {
        Self {
            version: 1,
            light: Light::default(),
            color: Color::default(),
            presence: Presence::default(),
            hsl: BTreeMap::new(),
            curve: Curve::default(),
            lut: None,
            crop: Crop::default(),
        }
    }
}

impl Default for Color {
    fn default() -> Self {
        Self {
            temperature: 6500.0,
            tint: 0.0,
            vibrance: 0.0,
            saturation: 0.0,
        }
    }
}

impl Default for Curve {
    fn default() -> Self {
        Self {
            rgb: vec![[0.0, 0.0], [255.0, 255.0]],
        }
    }
}

impl Default for Crop {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
            angle: 0.0,
            ratio: None,
        }
    }
}

impl Recipe {
    /// Parses stored or incoming JSON; missing fields take default values.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("recipe serializes")
    }

    /// True when any adjustment differs from neutral.
    pub fn is_edited(&self) -> bool {
        *self != Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_example_parses() {
        let json = r#"{
          "version": 1,
          "light": { "exposure": 0.35, "contrast": 12, "highlights": -40, "shadows": 25, "whites": 5, "blacks": -8 },
          "color": { "temperature": 5600, "tint": 4, "vibrance": 15, "saturation": 0 },
          "presence": { "sharpness": 30, "clarity": 10, "noise": 0, "vignette": -15 },
          "hsl": { "orange": { "h": 0, "s": -5, "l": 8 } },
          "curve": { "rgb": [[0,0],[64,58],[192,200],[255,255]] },
          "lut": null,
          "crop": { "x": 0, "y": 0, "w": 1, "h": 1, "angle": 0, "ratio": "4:5" }
        }"#;
        let r = Recipe::from_json(json).unwrap();
        assert_eq!(r.light.exposure, 0.35);
        assert_eq!(r.color.temperature, 5600.0);
        assert_eq!(r.hsl["orange"].l, 8.0);
        assert_eq!(r.crop.ratio.as_deref(), Some("4:5"));
        assert!(r.is_edited());
        assert_eq!(Recipe::from_json(&r.to_json()).unwrap(), r);
    }

    #[test]
    fn partial_json_fills_defaults() {
        let r = Recipe::from_json(r#"{"light":{"exposure":1}}"#).unwrap();
        assert_eq!(r.light.exposure, 1.0);
        assert_eq!(r.color.temperature, 6500.0);
        assert_eq!(r.curve, Curve::default());
    }

    #[test]
    fn default_is_not_edited() {
        assert!(!Recipe::default().is_edited());
        assert!(!Recipe::from_json("{}").unwrap().is_edited());
    }
}
