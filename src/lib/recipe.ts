/** Recipe: the versioned JSON with a photo's adjustments (see docs/SPEC.md). */

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
  curve: { rgb: [number, number][] };
  lut: string | null;
  crop: { x: number; y: number; w: number; h: number; angle: number; ratio: string | null };
}

export type GroupKey = "light" | "color" | "presence";

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

export function defaultRecipe(): Recipe {
  return {
    version: 1,
    light: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
    color: { temperature: 6500, tint: 0, vibrance: 0, saturation: 0 },
    presence: { sharpness: 0, clarity: 0, noise: 0, vignette: 0 },
    hsl: {},
    curve: {
      rgb: [
        [0, 0],
        [255, 255],
      ],
    },
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
  const raw = input as Partial<Recipe>;
  if (raw.hsl && typeof raw.hsl === "object") base.hsl = raw.hsl;
  if (raw.curve && Array.isArray(raw.curve.rgb)) base.curve = raw.curve;
  if (typeof raw.lut === "string") base.lut = raw.lut;
  if (raw.crop && typeof raw.crop === "object") base.crop = { ...base.crop, ...raw.crop };
  return base;
}

export function withValue(r: Recipe, group: GroupKey, key: string, value: number): Recipe {
  return { ...r, [group]: { ...r[group], [key]: value } };
}

export function resetGroup(r: Recipe, group: GroupKey): Recipe {
  return { ...r, [group]: { ...defaultRecipe()[group] } };
}

export function getValue(r: Recipe, group: GroupKey, key: string): number {
  return (r[group] as Record<string, number>)[key];
}

export function isGroupNeutral(r: Recipe, group: GroupKey): boolean {
  return JSON.stringify(r[group]) === JSON.stringify(defaultRecipe()[group]);
}

export function recipesEqual(a: Recipe, b: Recipe): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
