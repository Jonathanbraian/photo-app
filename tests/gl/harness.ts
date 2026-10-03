// Test page: renders a synthetic image with the real WebGL renderer and with
// the CPU reference, and exposes the comparison to Playwright.
import { renderReference } from "../../src/lib/adjust";
import { normalizeRecipe } from "../../src/lib/recipe";
import { PreviewRenderer } from "../../src/gl/renderer";

function pattern(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const band = Math.floor((x / w) * 6);
      // Gradients, colored bands, a hard edge and some noise.
      px[i] = Math.min(255, (x * 255) / (w - 1) + rnd() * 12);
      px[i + 1] = band % 2 ? (y * 255) / (h - 1) : 255 - (y * 255) / (h - 1);
      px[i + 2] = x > w / 2 && y > h / 2 ? 230 : 40 + band * 30;
      px[i + 3] = 255;
    }
  return px;
}

interface Result {
  maxDiff: number;
  meanDiff: number;
  floatTargets: boolean;
}

declare global {
  interface Window {
    compare: (recipe: unknown, w: number, h: number, bypass?: boolean) => Result;
  }
}

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new PreviewRenderer(canvas);

window.compare = (input, w, h, bypass = false) => {
  const recipe = normalizeRecipe(input);
  const src = pattern(w, h);
  renderer.setPixels(src, w, h);
  const gpu = renderer.readPixels(recipe, { bypass }).pixels;
  const cpu = renderReference(src, w, h, recipe, bypass);
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < gpu.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(gpu[i + c] - cpu[i + c]);
      max = Math.max(max, d);
      sum += d;
      n++;
    }
  }
  return {
    maxDiff: max,
    meanDiff: sum / n,
    floatTargets: renderer.gl.getExtension("EXT_color_buffer_float") !== null,
  };
};
