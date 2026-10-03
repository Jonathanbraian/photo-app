import { describe, expect, it } from "vitest";
import { defaultRecipe, isGroupNeutral, normalizeRecipe, resetGroup, withValue } from "./recipe";

describe("recipe", () => {
  it("fills missing fields from defaults", () => {
    const r = normalizeRecipe({ version: 1, light: { exposure: 0.5 } });
    expect(r.light.exposure).toBe(0.5);
    expect(r.light.contrast).toBe(0);
    expect(r.color.temperature).toBe(6500);
  });

  it("ignores invalid numbers", () => {
    const r = normalizeRecipe({ light: { exposure: "x", contrast: Number.NaN } });
    expect(r.light.exposure).toBe(0);
    expect(r.light.contrast).toBe(0);
  });

  it("resets a single group", () => {
    let r = withValue(defaultRecipe(), "light", "exposure", 1);
    r = withValue(r, "color", "saturation", 20);
    r = resetGroup(r, "light");
    expect(isGroupNeutral(r, "light")).toBe(true);
    expect(r.color.saturation).toBe(20);
  });
});
