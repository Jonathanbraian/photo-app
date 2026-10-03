// End-to-end flow of the Develop screen with the real interface and WebGL
// (Rust commands mocked in tests/e2e/mock-backend.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from "@playwright/test";

type Backend = {
  calls: { cmd: string; args: Record<string, unknown> }[];
  entries: Map<number, { recipe: { light: { exposure: number } }; history: unknown[]; thumb: string | null }>;
};

const exposureOf = (page: Page, id: number) =>
  page.evaluate(
    (pid) => (window as never as { __backend: Backend }).__backend.entries.get(pid)?.recipe.light.exposure ?? 0,
    id,
  );

const histogramPixels = (page: Page) =>
  page.locator('canvas[aria-label="Histograma"]').evaluate((c: HTMLCanvasElement) => c.toDataURL());

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto("/tests/e2e/app.html");
  await expect(page.getByText("IMG_1.jpg")).toHaveCount(1);
});

test("abre com duplo clique, ajusta, salva, desfaz e refaz", async ({ page }) => {
  await page.locator('button:has-text("IMG_1.jpg")').dblclick();
  await expect(page.getByRole("slider", { name: "Exposição" })).toBeVisible();
  await expect(page.locator("text=Erro")).toHaveCount(0);

  // Histogram appears once the preview renders.
  await expect.poll(() => histogramPixels(page)).not.toBe("");
  const before = await histogramPixels(page);

  await page.getByRole("slider", { name: "Exposição" }).fill("1.5");
  await expect(page.getByText("+1.50 EV")).toBeVisible();
  await expect.poll(() => histogramPixels(page)).not.toBe(before);

  // Saved after the ~300 ms pause, then the edited thumbnail is stored.
  await expect.poll(() => exposureOf(page, 1)).toBe(1.5);
  await expect
    .poll(() => page.evaluate(() => (window as never as { __backend: Backend }).__backend.calls.filter((c) => c.cmd === "save_edited_thumb").length))
    .toBeGreaterThan(0);

  await page.keyboard.press("Control+z");
  await expect(page.getByText("0.00 EV")).toBeVisible();
  await expect.poll(() => exposureOf(page, 1)).toBe(0);

  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByText("+1.50 EV")).toBeVisible();
  await expect.poll(() => exposureOf(page, 1)).toBe(1.5);
});

test("Ctrl+Z logo após mexer (antes do salvamento) desfaz a mudança", async ({ page }) => {
  await page.locator('button:has-text("IMG_1.jpg")').dblclick();
  await page.getByRole("slider", { name: "Contraste" }).fill("40");
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("slider", { name: "Contraste" })).toHaveValue("0");
});

test("duplo clique zera o slider e o botão do painel zera o grupo", async ({ page }) => {
  await page.locator('button:has-text("IMG_1.jpg")').dblclick();
  const contrast = page.getByRole("slider", { name: "Contraste" });
  const shadows = page.getByRole("slider", { name: "Sombras" });
  await contrast.fill("50");
  await shadows.fill("30");
  await contrast.dblclick();
  await expect(contrast).toHaveValue("0");
  await expect(shadows).toHaveValue("30");
  await page.getByTitle("Zerar Luz").click();
  await expect(shadows).toHaveValue("0");
});

test("setas navegam, \\ mostra o antes, clique alterna o zoom, G volta", async ({ page }) => {
  await page.locator('button:has-text("IMG_1.jpg")').dblclick();
  await expect(page.locator("span", { hasText: /^IMG_1\.jpg$/ })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(page.locator("span", { hasText: /^IMG_2\.jpg$/ })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("span", { hasText: /^IMG_1\.jpg$/ })).toBeVisible();

  await page.keyboard.down("\\");
  await expect(page.getByText("Antes", { exact: true })).toBeVisible();
  await page.keyboard.up("\\");
  await expect(page.getByText("Antes", { exact: true })).toHaveCount(0);

  const canvas = page.locator("main canvas").first();
  await expect(page.getByRole("button", { name: "Ajustar" })).toBeVisible();
  await canvas.click();
  await expect(page.getByRole("button", { name: "100%" })).toBeVisible();
  await canvas.click();
  await expect(page.getByRole("button", { name: "Ajustar" })).toBeVisible();

  await page.keyboard.press("g");
  await expect(page.getByText("Importar pasta…")).toBeVisible();
});

test("foto editada ganha selo na biblioteca; D abre a última clicada", async ({ page }) => {
  await page.locator('button:has-text("IMG_2.jpg")').click();
  await page.keyboard.press("d");
  await expect(page.locator("span", { hasText: /^IMG_2\.jpg$/ })).toBeVisible();
  await page.getByRole("slider", { name: "Saturação" }).fill("-60");
  await expect
    .poll(() => page.evaluate(() => (window as never as { __backend: Backend }).__backend.calls.some((c) => c.cmd === "save_recipe")))
    .toBe(true);
  await page.keyboard.press("g");
  const cell = page.locator('button:has-text("IMG_2.jpg")');
  await expect(cell.getByTitle("Editada")).toBeVisible();
  await expect(page.locator('button:has-text("IMG_1.jpg")').getByTitle("Editada")).toHaveCount(0);
});

// Regression: on macOS WKWebView, createImageBitmap(blob, options) failed with
// "InvalidStateError: Cannot decode the data…". The preview must still load
// (via <img>) and the edited thumbnail must still be produced (canvas resize).
test("Safari: createImageBitmap falhando usa o fallback <img> e canvas", async ({ page }) => {
  await page.goto("/tests/e2e/app.html?nobitmap=1");
  await page.locator('button:has-text("IMG_1.jpg")').dblclick();
  await expect.poll(() => histogramPixels(page)).not.toBe("");
  await expect(page.locator("text=createImageBitmap")).toHaveCount(0);
  await expect(page.locator("text=Erro")).toHaveCount(0);

  await page.getByRole("slider", { name: "Exposição" }).fill("1");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as never as { __backend: Backend }).__backend.calls
          .filter((c) => c.cmd === "save_edited_thumb")
          .map((c) => String(c.args.jpegBase64).slice(0, 4)),
      ),
    )
    .toContain("/9j/"); // base64 of FF D8 FF
});

test("prévia entregue como lista de números (IPC alternativo) funciona", async ({ page }) => {
  await page.goto("/tests/e2e/app.html?preview=array");
  await page.locator('button:has-text("IMG_1.jpg")').dblclick();
  await expect.poll(() => histogramPixels(page)).not.toBe("");
  await expect(page.locator("text=prévia")).toHaveCount(0);
});

test("prévia que não é JPEG mostra o motivo e os primeiros bytes", async ({ page }) => {
  await page.goto("/tests/e2e/app.html?preview=bad");
  await page.locator('button:has-text("IMG_1.jpg")').dblclick();
  await expect(page.getByText(/A prévia não é um JPEG \(15 bytes, começa com 32 35 35 2C/)).toBeVisible();
});

// ── Step 3b: HSL, curve, crop & straighten, LUT ───────────────────────────

type Entry = { recipe: Record<string, any> };
const recipeOf = (page: Page, id = 1) =>
  page.evaluate(
    (pid) => (window as never as { __backend: { entries: Map<number, Entry> } }).__backend.entries.get(pid)?.recipe ?? null,
    id,
  );

async function openFirst(page: Page) {
  await page.locator('button:has-text("IMG_1.jpg")').dblclick();
  // The preview canvas stays hidden until the photo is decoded and rendered.
  await expect(page.locator("main canvas").first()).toBeVisible();
}

test("HSL: abas e sliders por cor vão para a receita", async ({ page }) => {
  await openFirst(page);
  const before = await histogramPixels(page);
  await page.getByRole("tab", { name: "Saturação" }).click();
  await page.getByRole("slider", { name: "Saturação Verde" }).fill("-100");
  await page.getByRole("tab", { name: "Matiz" }).click();
  await page.getByRole("slider", { name: "Matiz Azul" }).fill("40");
  await expect.poll(() => recipeOf(page).then((r) => r?.hsl)).toEqual({
    green: { h: 0, s: -100, l: 0 },
    blue: { h: 40, s: 0, l: 0 },
  });
  await expect.poll(() => histogramPixels(page)).not.toBe(before);
});

test("curva: clique adiciona, arrasta move, duplo clique remove", async ({ page }) => {
  await openFirst(page);
  const svg = page.getByRole("img", { name: "Curva RGB" });
  await svg.scrollIntoViewIfNeeded();
  const box = (await svg.boundingBox())!;
  // viewBox is -4…259: map curve coordinates to screen.
  const at = (x: number, y: number) => ({
    x: box.x + ((x + 4) / 263) * box.width,
    y: box.y + ((255 - y + 4) / 263) * box.height,
  });
  let p = at(100, 150);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("curve-point")).toHaveCount(3);
  // Drag it.
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  p = at(110, 180);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.mouse.up();
  // The click saves first; wait for the save after the drag (debounced).
  await expect.poll(() => recipeOf(page).then((r) => r?.curve?.rgb?.[1]?.[1] ?? 0)).toBeGreaterThan(170);
  const rgb = (await recipeOf(page))!.curve.rgb;
  expect(rgb).toHaveLength(3);
  expect(rgb[1][0]).toBeGreaterThan(104);
  // Channel tab + double click removes the point.
  await page.mouse.dblclick(p.x, p.y);
  await expect(page.getByTestId("curve-point")).toHaveCount(2);
  await page.getByRole("tab", { name: "R", exact: true }).click();
  await expect(page.getByRole("img", { name: "Curva R" })).toBeVisible();
});

test("corte: R, proporção 1:1, Enter aplica; a foto aparece cortada e a miniatura também", async ({ page }) => {
  await openFirst(page);
  await page.keyboard.press("r");
  await expect(page.getByTestId("crop-rect")).toBeVisible();
  await page.getByRole("button", { name: "1:1" }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("crop-rect")).toHaveCount(0);
  await expect.poll(() => recipeOf(page).then((r) => r?.crop?.ratio)).toBe("1:1");
  const crop = (await recipeOf(page))!.crop;
  expect(crop.w * 1200).toBeCloseTo(crop.h * 800, 3); // square in pixels
  const canvas = page.locator("main canvas").first();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width - c.height)).toBe(0);
  // The edited thumbnail is square too.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const calls = (window as never as { __backend: Backend }).__backend.calls.filter((c) => c.cmd === "save_edited_thumb");
        const last = calls[calls.length - 1];
        if (!last) return null;
        const img = new Image();
        img.src = `data:image/jpeg;base64,${last.args.jpegBase64}`;
        await img.decode();
        return img.naturalWidth === img.naturalHeight;
      }),
    )
    .toBe(true);
  // Undo removes the crop.
  await page.keyboard.press("Control+z");
  await expect.poll(() => recipeOf(page).then((r) => r?.crop?.w)).toBe(1);
});

test("corte: endireitar corta as bordas vazias; X alterna a orientação; Esc cancela", async ({ page }) => {
  await openFirst(page);
  await page.keyboard.press("r");
  await page.getByRole("button", { name: "4:5" }).click();
  await page.keyboard.press("x");
  await page.getByRole("slider", { name: "Endireitar" }).fill("10");
  await page.keyboard.press("Enter");
  await expect.poll(() => recipeOf(page).then((r) => r?.crop?.angle)).toBe(10);
  const crop = (await recipeOf(page))!.crop;
  // 4:5 on a landscape photo keeps it landscape (5:4); X turns it portrait.
  expect(crop.ratio).toBe("4:5");
  expect((crop.w * 1200) / (crop.h * 800)).toBeCloseTo(4 / 5, 3);
  expect(crop.w).toBeLessThan(1);

  // Esc discards changes made in crop mode.
  await page.keyboard.press("r");
  await page.getByRole("slider", { name: "Endireitar" }).fill("-20");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("crop-rect")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect((await recipeOf(page))!.crop.angle).toBe(10);
});

test("LUT: importa .cube, aplica com intensidade e entra no histórico", async ({ page }) => {
  await openFirst(page);
  const before = await histogramPixels(page);
  await page.getByRole("button", { name: "Importar .cube…" }).click();
  await expect.poll(() => recipeOf(page).then((r) => r?.lut)).toEqual({ id: "abc123", intensity: 1 });
  await expect(page.getByRole("combobox", { name: "LUT" })).toHaveValue("abc123");
  await expect.poll(() => histogramPixels(page)).not.toBe(before);
  await page.getByRole("slider", { name: "Intensidade" }).fill("40");
  await expect.poll(() => recipeOf(page).then((r) => r?.lut?.intensity)).toBe(0.4);
  await page.keyboard.press("Control+z");
  await expect.poll(() => recipeOf(page).then((r) => r?.lut?.intensity)).toBe(1);
  await page.getByRole("combobox", { name: "LUT" }).selectOption("");
  await expect.poll(() => recipeOf(page).then((r) => r?.lut)).toBeNull();
});
