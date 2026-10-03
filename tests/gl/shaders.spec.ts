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

// LUTs built in the test: a 17³ "warm, contrasty" 3D LUT and a 1D inversion with a domain.
function cube3d(n: number): string {
  const lines = [`LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const [R, G, B] = [r, g, b].map((v) => v / (n - 1));
        const s = (x: number) => x * x * (3 - 2 * x);
        lines.push(`${Math.min(1, s(R) * 1.05)} ${s(G)} ${s(B) * 0.9}`);
      }
  return lines.join("\n");
}
const CUBE_1D = "LUT_1D_SIZE 3\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n1 1 1\n0.6 0.4 0.5\n0 0 0.1";

const newCases: { name: string; recipe: object; cube?: string; max: number; mean: number }[] = [
  {
    // Hue is numerically sensitive near gray; WebKit's float32 GPU math can
    // differ by 3/255 on a handful of pixels (Chromium: ≤ 1). Still capped
    // below by the "pixels over 2" check.
    name: "HSL (matiz, saturação e luminância em várias cores)",
    recipe: {
      hsl: {
        red: { h: 60, s: 40, l: -30 },
        orange: { h: -50, s: -60, l: 20 },
        green: { h: 100, s: 80, l: 50 },
        blue: { h: -100, s: -100, l: -60 },
        magenta: { h: 30, s: 50, l: 100 },
      },
    },
    max: 3,
    mean: 0.3,
  },
  {
    name: "curva RGB + por canal",
    recipe: {
      curve: {
        rgb: [[0, 10], [64, 50], [190, 215], [255, 245]],
        r: [[0, 0], [128, 150], [255, 255]],
        g: [[0, 0], [255, 235]],
        b: [[0, 30], [120, 100], [255, 255]],
      },
    },
    max: 2,
    mean: 0.3,
  },
  { name: "LUT 3D 17³ a 100 %", recipe: { lut: { id: "x", intensity: 1 } }, cube: cube3d(17), max: 2, mean: 0.3 },
  { name: "LUT 3D a 35 %", recipe: { lut: { id: "x", intensity: 0.35 } }, cube: cube3d(17), max: 2, mean: 0.3 },
  { name: "LUT 1D com domínio", recipe: { lut: { id: "x", intensity: 0.8 } }, cube: CUBE_1D, max: 2, mean: 0.3 },
  {
    name: "corte sem giro",
    recipe: { crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6, angle: 0, ratio: null } },
    max: 1,
    mean: 0.05,
  },
  {
    name: "corte + endireitar 7.5°",
    recipe: { crop: { x: 0.15, y: 0.12, w: 0.7, h: 0.76, angle: 7.5, ratio: null } },
    max: 2,
    mean: 0.2,
  },
  {
    name: "tudo junto (3a + 3b)",
    recipe: {
      light: { exposure: 0.3, contrast: 20, highlights: -25, shadows: 15 },
      color: { temperature: 5600, vibrance: 20 },
      presence: { clarity: 20, vignette: -20 },
      hsl: { orange: { h: -20, s: -15, l: 10 }, blue: { h: 0, s: 30, l: -20 } },
      curve: { rgb: [[0, 0], [70, 55], [185, 200], [255, 255]] },
      lut: { id: "x", intensity: 0.6 },
      crop: { x: 0.08, y: 0.1, w: 0.8, h: 0.75, angle: -4, ratio: null },
    },
    cube: cube3d(9),
    max: 4,
    mean: 0.6,
  },
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
    // At most 0.2 % of the pixels may differ by more than 2/255.
    expect(r.pixelsOver2, JSON.stringify(r)).toBeLessThanOrEqual(r.width * r.height * 0.002);
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

test("ImageBitmap e <img> entregam os mesmos pixels ao WebGL", async ({ page }) => {
  const r = await page.evaluate(() => window.compareDecoders());
  expect([r.width, r.height]).toEqual([300, 200]);
  expect(r.maxDiff, JSON.stringify(r)).toBeLessThanOrEqual(1);
});

for (const c of newCases) {
  test(`GPU = CPU: ${c.name}`, async ({ page }) => {
    const r = await page.evaluate(
      ([recipe, w, h, cube]) => window.compare(recipe, w as number, h as number, false, cube as string | undefined),
      [c.recipe, W, H, c.cube] as const,
    );
    expect(r.maxDiff, JSON.stringify(r)).toBeLessThanOrEqual(c.max);
    expect(r.meanDiff, JSON.stringify(r)).toBeLessThanOrEqual(c.mean);
    // At most 0.2 % of the pixels may differ by more than 2/255.
    expect(r.pixelsOver2, JSON.stringify(r)).toBeLessThanOrEqual(r.width * r.height * 0.002);
  });
}

test("corte define o tamanho da saída", async ({ page }) => {
  const r = await page.evaluate(() =>
    window.compare({ crop: { x: 0, y: 0, w: 0.5, h: 0.25, angle: 12, ratio: null } }, 320, 200),
  );
  expect([r.width, r.height]).toEqual([160, 50]);
});
