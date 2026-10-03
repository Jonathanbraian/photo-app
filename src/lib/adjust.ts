/**
 * CPU reference implementation of docs/ADJUSTMENTS.md.
 *
 * The WebGL preview must match this (checked by tests/gl/shaders.spec.ts),
 * and the Rust export (step 4) must reproduce it. Keep it literal and simple:
 * correctness over speed.
 */
import { cropSize, isNeutralCrop, toSource } from "./crop";
import { curveFunctions, curvesIdentity } from "./curve";
import { applyHsl, hslIsNeutral, hslVectors } from "./hsl";
import { applyLut, type Lut } from "./lut";
import type { Recipe } from "./recipe";

export type Vec3 = [number, number, number];

export const luma = (c: Vec3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const enc = (l: number) => Math.pow(Math.max(l, 0), 1 / 2.2);
export const dec = (p: number) => Math.pow(Math.max(p, 0), 2.2);
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  c = clamp(c, 0, 1);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function relum(rgb: Vec3, l: number, l2: number): Vec3 {
  if (l > 1e-6) {
    const k = l2 / l;
    return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
  }
  return [l2, l2, l2];
}

/** Linear sRGB of a Planckian (black-body) light at `t` kelvin. */
export function planckianRgb(t: number): Vec3 {
  t = clamp(t, 1667, 25000);
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    t <= 4000
      ? -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.17991
      : -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.24039;
  const x2 = x * x;
  const x3 = x2 * x;
  const y =
    t <= 2222
      ? -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683
      : t <= 4000
        ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483;
  const X = x / y;
  const Z = (1 - x - y) / y;
  return [
    3.2404542 * X - 1.5371385 - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 + 0.041556 * Z,
    0.0556434 * X - 0.2040259 + 1.0572252 * Z,
  ];
}

/** White-balance channel gains for a recipe (step 2). */
export function whiteBalanceGains(temperature: number, tint: number): Vec3 {
  const ref = planckianRgb(6500);
  const w = planckianRgb(temperature);
  const g: Vec3 = [ref[0] / w[0], (ref[1] / w[1]) * Math.pow(2, (-0.5 * tint) / 100), ref[2] / w[2]];
  const y = luma(g);
  return [g[0] / y, g[1] / y, g[2] / y];
}

/** Per-recipe precomputation for the per-pixel steps. */
export interface Prepared {
  gains: Vec3;
  hsl: Vec3[] | null;
  curves: ((e: number) => number)[] | null;
}

export function prepare(r: Recipe): Prepared {
  return {
    gains: whiteBalanceGains(r.color.temperature, r.color.tint),
    hsl: hslIsNeutral(r.hsl) ? null : hslVectors(r.hsl),
    curves: curvesIdentity(r.curve) ? null : curveFunctions(r.curve),
  };
}

/** Steps 2–7 (everything per-pixel before the spatial step), linear in/out. */
export function pointAdjust(rgb: Vec3, r: Recipe, gains: Vec3, prep: Prepared = prepare(r)): Vec3 {
  const { light, color } = r;
  // 2. White balance
  let c: Vec3 = [rgb[0] * gains[0], rgb[1] * gains[1], rgb[2] * gains[2]];
  // 3. Exposure
  const ev = Math.pow(2, light.exposure);
  c = [c[0] * ev, c[1] * ev, c[2] * ev];
  // 4. Tone
  const l = luma(c);
  const p = enc(l);
  const wp = 1 - (0.25 * light.whites) / 100;
  const bp = (-0.1 * light.blacks) / 100;
  const p1 = (p - bp) / (wp - bp);
  const q = clamp(p1, 0, 1);
  const p2 =
    p1 +
    0.25 * (light.shadows / 100) * 6.75 * q * (1 - q) * (1 - q) +
    0.25 * (light.highlights / 100) * 6.75 * q * q * (1 - q);
  const q2 = clamp(p2, 0, 1);
  const p3 = p2 + (light.contrast / 100) * 4 * (q2 - 0.5) * q2 * (1 - q2);
  c = relum(c, l, dec(p3));
  // 5. Color
  const l5 = luma(c);
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  const sat = mx > 1e-6 ? (mx - mn) / mx : 0;
  const f = (1 + (color.vibrance / 100) * (1 - sat) * (1 - sat)) * (1 + color.saturation / 100);
  c = [
    Math.max(l5 + (c[0] - l5) * f, 0),
    Math.max(l5 + (c[1] - l5) * f, 0),
    Math.max(l5 + (c[2] - l5) * f, 0),
  ];
  // 6. HSL
  if (prep.hsl) c = applyHsl(c, prep.hsl);
  // 7. Tone curve (on encoded values)
  if (prep.curves) {
    const fns = prep.curves;
    c = [0, 1, 2].map((i) => srgbToLinear(clamp(fns[i](linearToSrgb(c[i])), 0, 1))) as Vec3;
  }
  return c;
}

/** Separable Gaussian blur with replicated edges (step 6). */
export function gaussianBlur(src: Float64Array, w: number, h: number, sigma: number): Float64Array {
  if (sigma <= 0) return src.slice();
  const radius = Math.ceil(3 * sigma);
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        acc += kernel[k + radius] * src[y * w + clamp(x + k, 0, w - 1)];
      }
      tmp[y * w + x] = acc;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        acc += kernel[k + radius] * tmp[clamp(y + k, 0, h - 1) * w + x];
      }
      out[y * w + x] = acc;
    }
  return out;
}

export interface Rendered {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Step 13: crop & straighten an 8-bit RGBA image (bilinear). */
export function cropImage(
  src: Uint8ClampedArray,
  W: number,
  H: number,
  crop: Recipe["crop"],
): Rendered {
  const [wc, hc] = cropSize(crop, W, H);
  const out = new Uint8ClampedArray(wc * hc * 4);
  const at = (x: number, y: number, ch: number) =>
    src[(clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4 + ch];
  for (let j = 0; j < hc; j++)
    for (let i = 0; i < wc; i++) {
      const fx = crop.x * W + (i + 0.5) * ((crop.w * W) / wc) - W / 2;
      const fy = crop.y * H + (j + 0.5) * ((crop.h * H) / hc) - H / 2;
      const [sx, sy] = toSource(fx, fy, crop.angle);
      const px = W / 2 + sx - 0.5;
      const py = H / 2 + sy - 0.5;
      const o = (j * wc + i) * 4;
      out[o + 3] = 255;
      if (px < -0.5 || px > W - 0.5 || py < -0.5 || py > H - 0.5) continue; // black
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const fxw = px - x0;
      const fyw = py - y0;
      for (let ch = 0; ch < 3; ch++) {
        const v =
          at(x0, y0, ch) * (1 - fxw) * (1 - fyw) +
          at(x0 + 1, y0, ch) * fxw * (1 - fyw) +
          at(x0, y0 + 1, ch) * (1 - fxw) * fyw +
          at(x0 + 1, y0 + 1, ch) * fxw * fyw;
        out[o + ch] = Math.round(v);
      }
    }
  return { pixels: out, width: wc, height: hc };
}

/**
 * Full pipeline on an 8-bit sRGB RGBA image (alpha ignored, output alpha 255).
 * `bypass` renders the "before" view (steps 1, 10 and 12 only, no crop).
 * `lut` is the parsed LUT referenced by `r.lut`, if any.
 */
export function renderReference(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  r: Recipe,
  bypass = false,
  lut: Lut | null = null,
): Rendered {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const lin: Vec3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    lin[i] = [
      srgbToLinear(rgba[i * 4] / 255),
      srgbToLinear(rgba[i * 4 + 1] / 255),
      srgbToLinear(rgba[i * 4 + 2] / 255),
    ];
  }
  if (!bypass) {
    const prep = prepare(r);
    const p = new Float64Array(n);
    const lum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      lin[i] = pointAdjust(lin[i], r, prep.gains, prep);
      lum[i] = luma(lin[i]);
      p[i] = enc(lum[i]);
    }
    const side = Math.max(w, h);
    const { sharpness, clarity, vignette } = r.presence;
    const bs = sharpness !== 0 ? gaussianBlur(p, w, h, (1 * side) / 2048) : p;
    const bc = clarity !== 0 ? gaussianBlur(p, w, h, (20 * side) / 2048) : p;
    const a = w / h;
    const rmax = Math.sqrt((a / 2) * (a / 2) + 0.25);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const q = clamp(p[i], 0, 1);
        const m = 4 * q * (1 - q);
        const p2 =
          p[i] + 1.5 * (sharpness / 100) * (p[i] - bs[i]) + 0.6 * (clarity / 100) * m * (p[i] - bc[i]);
        let c = relum(lin[i], lum[i], dec(p2));
        const dx = ((x + 0.5) / w - 0.5) * a;
        const dy = (y + 0.5) / h - 0.5;
        const wv = smoothstep(0.25, 1, Math.sqrt(dx * dx + dy * dy) / rmax);
        const k = Math.pow(2, 1.5 * (vignette / 100) * wv);
        c = [c[0] * k, c[1] * k, c[2] * k];
        lin[i] = c;
      }
  }
  const useLut = !bypass && lut !== null && r.lut !== null;
  for (let i = 0; i < n; i++) {
    let e: [number, number, number] = [linearToSrgb(lin[i][0]), linearToSrgb(lin[i][1]), linearToSrgb(lin[i][2])];
    if (useLut) e = applyLut(lut, e, r.lut!.intensity);
    out[i * 4] = Math.round(255 * e[0]);
    out[i * 4 + 1] = Math.round(255 * e[1]);
    out[i * 4 + 2] = Math.round(255 * e[2]);
    out[i * 4 + 3] = 255;
  }
  if (bypass || isNeutralCrop(r.crop, r.crop.angle)) return { pixels: out, width: w, height: h };
  return cropImage(out, w, h, r.crop);
}
