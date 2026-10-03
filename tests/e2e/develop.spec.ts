// End-to-end flow of the Develop screen with the real interface and WebGL
// (Rust commands mocked in tests/e2e/mock-backend.ts).
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
