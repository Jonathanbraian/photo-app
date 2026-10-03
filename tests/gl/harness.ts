// Test page: renders a synthetic image with the real WebGL renderer and with
// the CPU reference, and exposes the comparison to Playwright.
import { renderReference } from "../../src/lib/adjust";
import { normalizeRecipe } from "../../src/lib/recipe";
import { PreviewRenderer } from "../../src/gl/renderer";
import { decodeVia } from "../../src/lib/imageDecode";

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
    compareDecoders: () => Promise<{ maxDiff: number; width: number; height: number }>;
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

// Both decode paths (ImageBitmap and <img>) must give WebGL the same pixels.
window.compareDecoders = async () => {
  const c = new OffscreenCanvas(300, 200);
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 300, 200);
  grad.addColorStop(0, "#c02a1f");
  grad.addColorStop(0.5, "#2fa84a");
  grad.addColorStop(1, "#3150d8");
  g.fillStyle = grad;
  g.fillRect(0, 0, 300, 200);
  const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  const read = async (via: "imagebitmap" | "img") => {
    const d = await decodeVia(blob, via);
    renderer.setImage(d.source, d.width, d.height);
    const out = renderer.readPixels(normalizeRecipe({}), { bypass: true });
    d.close();
    return out;
  };
  const a = await read("imagebitmap");
  const b = await read("img");
  let max = 0;
  for (let i = 0; i < a.pixels.length; i++) max = Math.max(max, Math.abs(a.pixels[i] - b.pixels[i]));
  return { maxDiff: max, width: b.width, height: b.height };
};
