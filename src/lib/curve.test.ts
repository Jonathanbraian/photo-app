import { describe, expect, it } from "vitest";
import { curveFunctions, isIdentity, normalizePoints, pchip, type Point } from "./curve";

describe("tone curve (PCHIP)", () => {
  it("identity passes values through", () => {
    const f = pchip([[0, 0], [255, 255]]);
    for (const x of [0, 17, 128, 254.5, 255]) expect(f(x)).toBeCloseTo(x, 10);
    expect(isIdentity([[255, 255], [0, 0]])).toBe(true);
  });

  it("passes through every point and stays constant outside", () => {
    const pts: Point[] = [[20, 10], [100, 140], [200, 230]];
    const f = pchip(pts);
    for (const [x, y] of pts) expect(f(x)).toBeCloseTo(y, 10);
    expect(f(0)).toBe(10);
    expect(f(255)).toBe(230);
  });

  it("is monotone for monotone points and never overshoots", () => {
    const pts: Point[] = [[0, 0], [60, 20], [70, 200], [255, 255]];
    const f = pchip(pts);
    let prev = -1;
    for (let x = 0; x <= 255; x += 0.25) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
    for (let x = 60; x <= 70; x += 0.1) {
      expect(f(x)).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(f(x)).toBeLessThanOrEqual(200 + 1e-9);
    }
  });

  it("flattens at local extrema of non-monotone points (no overshoot)", () => {
    const f = pchip([[0, 0], [128, 200], [255, 50]]);
    for (let x = 0; x <= 255; x++) expect(f(x)).toBeLessThanOrEqual(200 + 1e-9);
  });

  it("normalizes order and duplicates (last wins)", () => {
    expect(normalizePoints([[200, 1], [10, 2], [200, 3], [300, -5]])).toEqual([
      [10, 2],
      [200, 3],
      [255, 0],
    ]);
  });

  it("applies the RGB curve before the channel curve", () => {
    const [r, g] = curveFunctions({
      rgb: [[0, 0], [255, 128]],
      r: [[0, 0], [128, 255]],
      g: [[0, 0], [255, 255]],
      b: [[0, 0], [255, 255]],
    });
    expect(r(1)).toBeCloseTo(1, 6); // 255 → 128 → 255
    expect(g(1)).toBeCloseTo(128 / 255, 6);
  });
});
