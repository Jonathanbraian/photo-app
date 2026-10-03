import { describe, expect, it } from "vitest";
import {
  linearToSrgb,
  luma,
  planckianRgb,
  pointAdjust,
  renderReference,
  srgbToLinear,
  whiteBalanceGains,
  type Vec3,
} from "./adjust";
import { defaultRecipe, withValue, type Recipe } from "./recipe";

function pattern(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = (x * 255) / (w - 1);
      px[i + 1] = (y * 255) / (h - 1);
      px[i + 2] = ((x + y) * 7) % 256;
      px[i + 3] = 255;
    }
  return px;
}

const gray = (v: number): Vec3 => [v, v, v];
const neutralGains = whiteBalanceGains(6500, 0);

describe("transfer functions", () => {
  it("sRGB round-trips every 8-bit value", () => {
    for (let v = 0; v < 256; v++) {
      expect(Math.round(255 * linearToSrgb(srgbToLinear(v / 255)))).toBe(v);
    }
  });
});

describe("neutral recipe", () => {
  it("is the identity", () => {
    const src = pattern(40, 30);
    const out = renderReference(src, 40, 30, defaultRecipe()).pixels;
    for (let i = 0; i < src.length; i++) expect(Math.abs(out[i] - src[i])).toBeLessThanOrEqual(1);
  });

  it("has unit white-balance gains at 6500 K", () => {
    neutralGains.forEach((g) => expect(g).toBeCloseTo(1, 12));
  });
});

describe("white balance", () => {
  it("lower temperature cools, higher warms, gray keeps its luminance", () => {
    const cool = whiteBalanceGains(3000, 0);
    const warm = whiteBalanceGains(10000, 0);
    expect(cool[2]).toBeGreaterThan(cool[0]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(luma(cool)).toBeCloseTo(1, 12);
    expect(luma(warm)).toBeCloseTo(1, 12);
  });

  it("positive tint reduces green (magenta)", () => {
    const g = whiteBalanceGains(6500, 50);
    expect(g[1]).toBeLessThan(g[0]);
    expect(g[1]).toBeLessThan(g[2]);
  });

  it("Planckian white is near-neutral at 6500 K (within 10 % of D65)", () => {
    const w = planckianRgb(6500);
    expect(Math.abs(w[0] / w[1] - 1)).toBeLessThan(0.1);
    expect(Math.abs(w[2] / w[1] - 1)).toBeLessThan(0.1);
  });
});

describe("light", () => {
  const at = (r: Recipe, v: number) => pointAdjust(gray(v), r, whiteBalanceGains(r.color.temperature, r.color.tint))[0];

  it("+1 EV doubles linear values", () => {
    const r = withValue(defaultRecipe(), "light", "exposure", 1);
    expect(at(r, 0.1)).toBeCloseTo(0.2, 10);
  });

  it("contrast keeps 0, the pivot and 1 fixed and spreads the rest", () => {
    const r = withValue(defaultRecipe(), "light", "contrast", 100);
    const pivot = Math.pow(0.5, 2.2);
    expect(at(r, 0)).toBe(0);
    expect(at(r, pivot)).toBeCloseTo(pivot, 10);
    expect(at(r, 1)).toBeCloseTo(1, 10);
    expect(at(r, 0.05)).toBeLessThan(0.05);
    expect(at(r, 0.6)).toBeGreaterThan(0.6);
  });

  it("shadows lift dark tones more than bright ones", () => {
    const r = withValue(defaultRecipe(), "light", "shadows", 100);
    expect(at(r, 0.03) / 0.03).toBeGreaterThan(at(r, 0.6) / 0.6);
    expect(at(r, 1)).toBeCloseTo(1, 10);
  });

  it("highlights recover bright tones more than dark ones", () => {
    const r = withValue(defaultRecipe(), "light", "highlights", -100);
    expect(at(r, 0.5) / 0.5).toBeLessThan(at(r, 0.03) / 0.03);
  });

  it("whites and blacks move the end points", () => {
    expect(at(withValue(defaultRecipe(), "light", "whites", 100), 0.6)).toBeGreaterThan(0.6);
    expect(at(withValue(defaultRecipe(), "light", "blacks", -100), 0.01)).toBeLessThan(0.01);
    expect(at(withValue(defaultRecipe(), "light", "blacks", 100), 0)).toBeGreaterThan(0);
  });
});

describe("color", () => {
  const red: Vec3 = [0.5, 0.1, 0.1];

  it("saturation -100 gives gray with the same luminance", () => {
    const r = withValue(defaultRecipe(), "color", "saturation", -100);
    const out = pointAdjust(red, r, neutralGains);
    expect(out[0]).toBeCloseTo(out[1], 10);
    expect(out[1]).toBeCloseTo(out[2], 10);
    expect(luma(out)).toBeCloseTo(luma(red), 10);
  });

  it("vibrance boosts muted colors more than saturated ones", () => {
    const r = withValue(defaultRecipe(), "color", "vibrance", 100);
    const muted: Vec3 = [0.3, 0.25, 0.25];
    const spread = (c: Vec3) => Math.max(...c) - Math.min(...c);
    const gainMuted = spread(pointAdjust(muted, r, neutralGains)) / spread(muted);
    const gainRed = spread(pointAdjust(red, r, neutralGains)) / spread(red);
    expect(gainMuted).toBeGreaterThan(gainRed);
  });
});

describe("presence", () => {
  it("vignette darkens corners and leaves the center", () => {
    const w = 64;
    const h = 48;
    const src = new Uint8ClampedArray(w * h * 4).fill(128);
    const out = renderReference(src, w, h, withValue(defaultRecipe(), "presence", "vignette", -100)).pixels;
    expect(out[0]).toBeLessThan(100);
    const c = ((h / 2) * w + w / 2) * 4;
    expect(Math.abs(out[c] - 128)).toBeLessThanOrEqual(1);
  });

  it("sharpness and clarity do nothing on a flat image", () => {
    const src = new Uint8ClampedArray(32 * 32 * 4).fill(100);
    let r = withValue(defaultRecipe(), "presence", "sharpness", 100);
    r = withValue(r, "presence", "clarity", 100);
    const out = renderReference(src, 32, 32, r).pixels;
    for (let i = 0; i < out.length; i += 4) expect(Math.abs(out[i] - 100)).toBeLessThanOrEqual(1);
  });

  it("sharpness increases edge contrast (radius relative to a 2048 px side)", () => {
    const w = 2048;
    const h = 2;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = i % w < w / 2 ? 60 : 180;
      src.set([v, v, v, 255], i * 4);
    }
    const out = renderReference(src, w, h, withValue(defaultRecipe(), "presence", "sharpness", 100)).pixels;
    expect(out[(w / 2 - 1) * 4]).toBeLessThan(60);
    expect(out[(w / 2) * 4]).toBeGreaterThan(180);
    expect(Math.abs(out[10 * 4] - 60)).toBeLessThanOrEqual(1);
  });
});
