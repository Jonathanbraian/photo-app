// The WebGL preview must match the CPU reference (docs/ADJUSTMENTS.md).
import { expect, test } from "@playwright/test";

const W = 320;
const H = 200;

const cases: { name: string; recipe: object; max: number; mean: number }[] = [
  { name: "neutro", recipe: {}, max: 1, mean: 0.05 },
  { name: "exposição +1.3", recipe: { light: { exposure: 1.3 } }, max: 2, mean: 0.3 },
  { name: "exposição −2", recipe: { light: { exposure: -2 } }, max: 2, mean: 0.3 },
  {
    name: "tom completo",
    recipe: { light: { contrast: 60, highlights: -70, shadows: 55, whites: 30, blacks: -40 } },
    max: 2,
    mean: 0.3,
  },
  { name: "temperatura 3200 K, matiz +40", recipe: { color: { temperature: 3200, tint: 40 } }, max: 2, mean: 0.3 },
  { name: "temperatura 11000 K, matiz −60", recipe: { color: { temperature: 11000, tint: -60 } }, max: 2, mean: 0.3 },
  { name: "vibração e saturação", recipe: { color: { vibrance: 80, saturation: -30 } }, max: 2, mean: 0.3 },
  { name: "vinheta −80", recipe: { presence: { vignette: -80 } }, max: 2, mean: 0.3 },
  { name: "clareza +80", recipe: { presence: { clarity: 80 } }, max: 2, mean: 0.3 },
  { name: "tudo junto", recipe: {
      light: { exposure: 0.4, contrast: 25, highlights: -30, shadows: 20, whites: 10, blacks: -10 },
      color: { temperature: 5200, tint: 8, vibrance: 25, saturation: 10 },
      presence: { clarity: 30, vignette: -25 },
    }, max: 4, mean: 0.6 },
];

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/gl/harness.html");
  await page.waitForFunction(() => typeof window.compare === "function");
});

for (const c of cases) {
  test(`GPU = CPU: ${c.name}`, async ({ page }) => {
    const r = await page.evaluate(([recipe, w, h]) => window.compare(recipe, w as number, h as number), [c.recipe, W, H] as const);
    expect(r.maxDiff, JSON.stringify(r)).toBeLessThanOrEqual(c.max);
    expect(r.meanDiff, JSON.stringify(r)).toBeLessThanOrEqual(c.mean);
  });
}

test("GPU = CPU: nitidez na largura real da prévia", async ({ page }) => {
  const r = await page.evaluate(() => window.compare({ presence: { sharpness: 80 } }, 2048, 64));
  expect(r.maxDiff, JSON.stringify(r)).toBeLessThanOrEqual(2);
  expect(r.meanDiff, JSON.stringify(r)).toBeLessThanOrEqual(0.3);
});

// At the real preview size the clarity blur runs on a 4× reduced image.
test("GPU ≈ CPU: clareza na largura real da prévia", async ({ page }) => {
  const r = await page.evaluate(() => window.compare({ presence: { clarity: 80 } }, 2048, 160));
  expect(r.maxDiff, JSON.stringify(r)).toBeLessThanOrEqual(4);
  expect(r.meanDiff, JSON.stringify(r)).toBeLessThanOrEqual(0.5);
});

test("antes (bypass) é a imagem original", async ({ page }) => {
  const r = await page.evaluate(() =>
    window.compare({ light: { exposure: 2 }, presence: { vignette: -100 } }, 200, 100, true),
  );
  expect(r.maxDiff).toBeLessThanOrEqual(1);
});
