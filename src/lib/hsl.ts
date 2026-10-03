/** HSL per color (docs/ADJUSTMENTS.md §6), in HSV over linear RGB. */
type Vec3 = [number, number, number];

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

export const HSL_COLORS = [
  { key: "red", label: "Vermelho", center: 0, swatch: "#e5484d" },
  { key: "orange", label: "Laranja", center: 30, swatch: "#f76b15" },
  { key: "yellow", label: "Amarelo", center: 60, swatch: "#ffc53d" },
  { key: "green", label: "Verde", center: 120, swatch: "#46a758" },
  { key: "aqua", label: "Aqua", center: 180, swatch: "#12a594" },
  { key: "blue", label: "Azul", center: 240, swatch: "#3e63dd" },
  { key: "purple", label: "Roxo", center: 270, swatch: "#8e4ec6" },
  { key: "magenta", label: "Magenta", center: 300, swatch: "#d6409f" },
] as const;

export type HslKey = (typeof HSL_COLORS)[number]["key"];
export type HslValues = Partial<Record<string, { h: number; s: number; l: number }>>;

export const HSL_CENTERS = HSL_COLORS.map((c) => c.center);

/** Weights of the 8 colors for hue `h` (degrees); they sum to 1. */
export function hueWeights(h: number): number[] {
  const w = new Array(8).fill(0);
  h = ((h % 360) + 360) % 360;
  let i = 7;
  for (let j = 0; j < 8; j++) if (h >= HSL_CENTERS[j]) i = j;
  const c0 = HSL_CENTERS[i];
  const c1 = i === 7 ? 360 : HSL_CENTERS[i + 1];
  const s = smoothstep(0, 1, (h - c0) / (c1 - c0));
  w[i] = 1 - s;
  w[(i + 1) % 8] += s;
  return w;
}

export function rgbToHsv(c: Vec3): Vec3 {
  const [r, g, b] = c;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const s = mx > 1e-6 ? d / mx : 0;
  let h = 0;
  if (d >= 1e-9) {
    if (mx === r) h = (60 * (g - b)) / d;
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return [h, s, mx];
}

export function hsvToRgb([h, s, v]: Vec3): Vec3 {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;
  const sector = ((Math.floor(hp) % 6) + 6) % 6;
  const t: Vec3[] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = t[sector];
  return [r + m, g + m, b + m];
}

/** The 8 (h, s, l) triples in color order (missing colors are zero). */
export function hslVectors(hsl: HslValues): Vec3[] {
  return HSL_COLORS.map(({ key }) => {
    const v = hsl[key];
    return [v?.h ?? 0, v?.s ?? 0, v?.l ?? 0];
  });
}

export function hslIsNeutral(hsl: HslValues): boolean {
  return hslVectors(hsl).every((v) => v[0] === 0 && v[1] === 0 && v[2] === 0);
}

export function applyHsl(rgb: Vec3, vectors: Vec3[]): Vec3 {
  const [h, s, v] = rgbToHsv(rgb);
  const w = hueWeights(h);
  let dh = 0;
  let ds = 0;
  let dl = 0;
  for (let j = 0; j < 8; j++) {
    dh += (w[j] * vectors[j][0]) / 100;
    ds += (w[j] * vectors[j][1]) / 100;
    dl += (w[j] * vectors[j][2]) / 100;
  }
  const k = smoothstep(0.02, 0.2, s);
  const h2 = (((h + k * dh * 30) % 360) + 360) % 360;
  const s2 = Math.min(1, Math.max(0, s * (1 + k * ds)));
  const v2 = v * Math.pow(2, k * dl);
  return hsvToRgb([h2, s2, v2]);
}
