import { describe, expect, it } from "vitest";
import { renderReference } from "./adjust";
import { constrain, cropSize, FULL, fitInside, flipRatio, insideRotated, ratioAspect, withAspect } from "./crop";
import { defaultRecipe } from "./recipe";

const W = 300;
const H = 200;

describe("crop geometry", () => {
  it("ratios and orientation flips", () => {
    expect(ratioAspect("4:5", W, H)).toBeCloseTo(0.8);
    expect(ratioAspect("original", W, H)).toBeCloseTo(1.5);
    expect(ratioAspect("original-flip", W, H)).toBeCloseTo(H / W);
    expect(ratioAspect(null, W, H)).toBeNull();
    expect(flipRatio("16:9")).toBe("9:16");
    expect(flipRatio("original")).toBe("original-flip");
  });

  it("full frame fits only without rotation; fitInside crops empty borders", () => {
    expect(insideRotated(FULL, 0, W, H)).toBe(true);
    expect(insideRotated(FULL, 5, W, H)).toBe(false);
    for (const angle of [-45, -12.5, 3, 45]) {
      const r = fitInside(FULL, angle, W, H);
      expect(insideRotated(r, angle, W, H)).toBe(true);
      expect(r.w / r.h).toBeCloseTo(1, 6); // keeps the (normalized) aspect
      expect(r.x + r.w / 2).toBeCloseTo(0.5, 9);
      // Maximal: slightly larger no longer fits.
      const bigger = { x: r.x - 0.001, y: r.y - 0.001, w: r.w + 0.002, h: r.h + 0.002 };
      expect(insideRotated(bigger, angle, W, H)).toBe(false);
    }
  });

  it("withAspect gives the exact pixel ratio, inside the rotated photo", () => {
    for (const [ratio, angle] of [["1:1", 0], ["4:5", 10], ["16:9", -20]] as const) {
      const r = withAspect(FULL, ratioAspect(ratio, W, H), angle, W, H);
      const [a, b] = ratio.split(":").map(Number);
      expect((r.w * W) / (r.h * H)).toBeCloseTo(a / b, 6);
      expect(insideRotated(r, angle, W, H)).toBe(true);
    }
  });

  it("constrain stops a move at the border", () => {
    const from = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    const r = constrain(from, { ...from, x: 0.9 }, 0, W, H);
    expect(r.x).toBeCloseTo(0.5, 6);
  });

  it("neutral crop is the identity; 180×200 crop has that size", () => {
    const src = new Uint8ClampedArray(W * H * 4).map((_, i) => (i * 37) % 256);
    for (let i = 3; i < src.length; i += 4) src[i] = 255;
    const same = renderReference(src, W, H, defaultRecipe());
    expect(same.width).toBe(W);
    const r = defaultRecipe();
    r.crop = { x: 0.2, y: 0, w: 0.6, h: 1, angle: 0, ratio: null };
    const out = renderReference(src, W, H, r);
    expect([out.width, out.height]).toEqual(cropSize(r.crop, W, H));
    expect([out.width, out.height]).toEqual([180, 200]);
    // Unrotated crop at integer offsets copies pixels exactly.
    expect(out.pixels[0]).toBe(same.pixels[60 * 4]);
  });
});
