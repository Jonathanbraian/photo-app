import { describe, expect, it } from "vitest";
import { applyHsl, hslVectors, hsvToRgb, hueWeights, rgbToHsv } from "./hsl";

const vec = (hsl: Record<string, { h: number; s: number; l: number }>) => hslVectors(hsl);

describe("HSL per color", () => {
  it("weights form a smooth partition of unity peaking at the centers", () => {
    for (let h = 0; h < 360; h += 0.5) {
      const w = hueWeights(h);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(w.filter((x) => x > 0).length).toBeLessThanOrEqual(2);
    }
    expect(hueWeights(120)[3]).toBe(1); // green
    expect(hueWeights(330)[7]).toBeCloseTo(0.5, 12); // halfway magenta → red
    expect(hueWeights(330)[0]).toBeCloseTo(0.5, 12);
    // No jumps: weights change continuously across the hue circle.
    let prev = hueWeights(0);
    for (let h = 0.1; h <= 360; h += 0.1) {
      const w = hueWeights(h);
      for (let j = 0; j < 8; j++) expect(Math.abs(w[j] - prev[j])).toBeLessThan(0.02);
      prev = w;
    }
  });

  it("HSV round-trips", () => {
    for (const c of [[0.8, 0.2, 0.1], [0.1, 0.5, 0.9], [0.3, 0.3, 0.3], [0, 0, 0]] as [number, number, number][]) {
      const back = hsvToRgb(rgbToHsv(c));
      back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 12));
    }
  });

  it("neutral values change nothing; grays are never touched", () => {
    const c: [number, number, number] = [0.6, 0.3, 0.1];
    applyHsl(c, vec({})).forEach((v, i) => expect(v).toBeCloseTo(c[i], 12));
    const gray: [number, number, number] = [0.4, 0.4, 0.4];
    const all = { red: { h: 100, s: 100, l: 100 }, green: { h: -100, s: -100, l: -100 } };
    applyHsl(gray, vec(all)).forEach((v) => expect(v).toBeCloseTo(0.4, 12));
  });

  it("green saturation −100 desaturates green but not red", () => {
    const v = vec({ green: { h: 0, s: -100, l: 0 } });
    const [, sGreen] = rgbToHsv(applyHsl([0.1, 0.6, 0.1], v));
    const [, sRed] = rgbToHsv(applyHsl([0.6, 0.1, 0.1], v));
    expect(sGreen).toBeLessThan(0.01);
    expect(sRed).toBeCloseTo(rgbToHsv([0.6, 0.1, 0.1])[1], 12);
  });

  it("hue +100 on yellow turns it 30° toward green; luminance −100 halves V", () => {
    const yellow: [number, number, number] = [0.7, 0.7, 0.05];
    const [h] = rgbToHsv(applyHsl(yellow, vec({ yellow: { h: 100, s: 0, l: 0 } })));
    expect(h).toBeCloseTo(90, 6);
    const [, , v] = rgbToHsv(applyHsl(yellow, vec({ yellow: { h: 0, s: 0, l: -100 } })));
    expect(v).toBeCloseTo(0.35, 6);
  });
});
