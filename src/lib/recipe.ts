/** Recipe: the versioned JSON with a photo's adjustments (see docs/SPEC.md). */
import type { Curves, Point } from "./curve";

export interface Recipe {
  version: 1;
  light: {
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    whites: number;
    blacks: number;
  };
  color: { temperature: number; tint: number; vibrance: number; saturation: number };
  presence: { sharpness: number; clarity: number; noise: number; vignette: number };
  hsl: Record<string, { h: number; s: number; l: number }>;
  curve: Curves;
  /** Imported LUT (copied to the app data folder) and its strength 0…1. */
  lut: { id: string; intensity: number } | null;
  crop: { x: number; y: number; w: number; h: number; angle: number; ratio: string | null };
}

export type GroupKey = "light" | "color" | "presence";
export type ToolKey = GroupKey | "hsl" | "curve" | "crop" | "lut";

export interface SliderSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  neutral: number;
  /** Decimal places shown. */
  digits?: number;
  unit?: string;
}

/** Sliders per panel, in display order. Ranges match docs/ADJUSTMENTS.md. */
export const PANELS: { group: GroupKey; title: string; sliders: SliderSpec[] }[] = [
  {
    group: "light",
    title: "Luz",
    sliders: [
      { key: "exposure", label: "Exposição", min: -5, max: 5, step: 0.01, neutral: 0, digits: 2, unit: "EV" },
      { key: "contrast", label: "Contraste", min: -100, max: 100, step: 1, neutral: 0 },
      { key: "highlights", label: "Realces", min: -100, max: 100, step: 1, neutral: 0 },
      { key: "shadows", label: "Sombras", min: -100, max: 100, step: 1, neutral: 0 },
      { key: "whites", label: "Brancos", min: -100, max: 100, step: 1, neutral: 0 },
      { key: "blacks", label: "Pretos", min: -100, max: 100, step: 1, neutral: 0 },
    ],
  },
  {
    group: "color",
    title: "Cor",
    sliders: [
      { key: "temperature", label: "Temperatura", min: 2000, max: 12000, step: 50, neutral: 6500, unit: "K" },
      { key: "tint", label: "Matiz", min: -100, max: 100, step: 1, neutral: 0 },
      { key: "vibrance", label: "Vibração", min: -100, max: 100, step: 1, neutral: 0 },
      { key: "saturation", label: "Saturação", min: -100, max: 100, step: 1, neutral: 0 },
    ],
  },
  {
    group: "presence",
    title: "Presença",
    sliders: [
      { key: "sharpness", label: "Nitidez", min: 0, max: 100, step: 1, neutral: 0 },
      { key: "clarity", label: "Clareza", min: -100, max: 100, step: 1, neutral: 0 },
      { key: "vignette", label: "Vinheta", min: -100, max: 100, step: 1, neutral: 0 },
    ],
  },
];

const identity = (): Point[] => [
  [0, 0],
  [255, 255],
];

export function defaultRecipe(): Recipe {
  return {
    version: 1,
    light: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
    color: { temperature: 6500, tint: 0, vibrance: 0, saturation: 0 },
    presence: { sharpness: 0, clarity: 0, noise: 0, vignette: 0 },
    hsl: {},
    curve: { rgb: identity(), r: identity(), g: identity(), b: identity() },
    lut: null,
    crop: { x: 0, y: 0, w: 1, h: 1, angle: 0, ratio: null },
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Fills missing fields with defaults (older or partial recipes). */
export function normalizeRecipe(input: unknown): Recipe {
  const base = defaultRecipe();
  if (!input || typeof input !== "object") return base;
  const src = input as Record<string, Record<string, unknown> | undefined>;
  for (const group of ["light", "color", "presence"] as const) {
    const target = base[group] as Record<string, number>;
    for (const key of Object.keys(target)) {
      target[key] = num(src[group]?.[key], target[key]);
    }
  }
  const raw = input as Record<string, unknown>;
  const hsl = raw.hsl as Record<string, Record<string, unknown>> | undefined;
  if (hsl && typeof hsl === "object") {
    for (const [key, v] of Object.entries(hsl)) {
      if (!v || typeof v !== "object") continue;
      const e = { h: num(v.h, 0), s: num(v.s, 0), l: num(v.l, 0) };
      if (e.h || e.s || e.l) base.hsl[key] = e;
    }
  }
  const curve = raw.curve as Record<string, unknown> | undefined;
  if (curve && typeof curve === "object") {
    for (const ch of ["rgb", "r", "g", "b"] as const) {
      const pts = curve[ch];
      if (Array.isArray(pts) && pts.length >= 2) {
        base.curve[ch] = pts
          .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2)
          .map(([x, y]) => [num(x, 0), num(y, 0)]);
      }
    }
  }
  const lut = raw.lut as Record<string, unknown> | null | undefined;
  if (lut && typeof lut === "object" && typeof lut.id === "string") {
    base.lut = { id: lut.id, intensity: Math.min(1, Math.max(0, num(lut.intensity, 1))) };
  }
  const crop = raw.crop as Record<string, unknown> | undefined;
  if (crop && typeof crop === "object") {
    base.crop = {
      x: num(crop.x, 0),
      y: num(crop.y, 0),
      w: num(crop.w, 1),
      h: num(crop.h, 1),
      angle: num(crop.angle, 0),
      ratio: typeof crop.ratio === "string" ? crop.ratio : null,
    };
  }
  return base;
}

export function withValue(r: Recipe, group: GroupKey, key: string, value: number): Recipe {
  return { ...r, [group]: { ...r[group], [key]: value } };
}

export function resetGroup(r: Recipe, group: ToolKey): Recipe {
  const d = defaultRecipe();
  return { ...r, [group]: d[group] };
}

export function getValue(r: Recipe, group: GroupKey, key: string): number {
  return (r[group] as Record<string, number>)[key];
}

export function isGroupNeutral(r: Recipe, group: ToolKey): boolean {
  return JSON.stringify(r[group]) === JSON.stringify(defaultRecipe()[group]);
}

export function recipesEqual(a: Recipe, b: Recipe): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Sets one HSL value; colors back to all-zero are dropped (stay neutral). */
export function withHsl(r: Recipe, color: string, field: "h" | "s" | "l", value: number): Recipe {
  const cur = r.hsl[color] ?? { h: 0, s: 0, l: 0 };
  const next = { ...cur, [field]: value };
  const hsl = { ...r.hsl };
  if (next.h === 0 && next.s === 0 && next.l === 0) delete hsl[color];
  else hsl[color] = next;
  return { ...r, hsl };
}

export function withCurve(r: Recipe, channel: keyof Recipe["curve"], points: [number, number][]): Recipe {
  return { ...r, curve: { ...r.curve, [channel]: points } };
}

/** Crop with a full rect and no rotation is stored as neutral (ratio is UI only). */
export function withCrop(r: Recipe, crop: Recipe["crop"]): Recipe {
  const neutral = crop.angle === 0 && crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1;
  return { ...r, crop: neutral ? defaultRecipe().crop : crop };
}
