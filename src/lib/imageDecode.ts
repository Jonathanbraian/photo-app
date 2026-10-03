/**
 * Decoding the preview and resizing the edited thumbnail, with fallbacks for
 * WKWebView (Safari), whose createImageBitmap rejects some inputs and options.
 * Colors must stay exact: no color-space conversion, no premultiplied alpha.
 */

/** Something WebGL can upload, with its pixel size. */
export interface DecodedImage {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  /** Which decoder produced it (shown in diagnostics and tests). */
  via: "imagebitmap" | "img";
  close(): void;
}

/**
 * Normalizes what the `read_preview` command returned. Tauri normally hands
 * over an ArrayBuffer, but its fallback IPC can deliver a plain number array.
 */
export function toBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data) && data.every((v) => typeof v === "number")) return Uint8Array.from(data);
  const kind = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
  throw new Error(`A prévia chegou num formato inesperado (${kind}).`);
}

function hexStart(bytes: Uint8Array, n = 8): string {
  return Array.from(bytes.subarray(0, n), (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

/** Throws a descriptive error unless `bytes` starts like a JPEG (FF D8 FF). */
export function checkJpeg(bytes: Uint8Array): void {
  if (bytes.length === 0) throw new Error("A prévia veio vazia (0 bytes).");
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error(
      `A prévia não é um JPEG (${bytes.length} bytes, começa com ${hexStart(bytes)}; esperado FF D8 FF).`,
    );
  }
}

async function viaImageBitmap(blob: Blob): Promise<DecodedImage> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  return { source: bmp, width: bmp.width, height: bmp.height, via: "imagebitmap", close: () => bmp.close() };
}

async function viaImageElement(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      via: "img",
      close: () => img.removeAttribute("src"),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decodes with one specific path (tests compare both). */
export function decodeVia(blob: Blob, via: DecodedImage["via"]): Promise<DecodedImage> {
  return via === "img" ? viaImageElement(blob) : viaImageBitmap(blob);
}

/** Decodes the preview JPEG; falls back to <img> where createImageBitmap fails. */
export async function decodeJpeg(bytes: Uint8Array): Promise<DecodedImage> {
  checkJpeg(bytes);
  const blob = new Blob([bytes as BlobPart], { type: "image/jpeg" });
  try {
    return await viaImageBitmap(blob);
  } catch (first) {
    try {
      return await viaImageElement(blob);
    } catch (second) {
      throw new Error(
        `Não foi possível decodificar a prévia (${bytes.length} bytes, começa com ${hexStart(bytes)}): ` +
          `${String(first)} / ${String(second)}`,
      );
    }
  }
}

/**
 * Resizes RGBA pixels (top row first) into a canvas of `tw`×`th`.
 * Prefers createImageBitmap's high-quality resize; otherwise halves the image
 * step by step on canvases, which avoids the aliasing of a single big step.
 */
export async function resizeToCanvas(
  pixels: Uint8Array,
  width: number,
  height: number,
  tw: number,
  th: number,
): Promise<HTMLCanvasElement> {
  const data = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.byteLength), width, height);
  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  const ctx = out.getContext("2d")!;
  try {
    const bmp = await createImageBitmap(data, { resizeWidth: tw, resizeHeight: th, resizeQuality: "high" });
    try {
      if (bmp.width !== tw || bmp.height !== th) throw new Error("resize ignorado");
      ctx.drawImage(bmp, 0, 0);
      return out;
    } finally {
      bmp.close();
    }
  } catch {
    let src = document.createElement("canvas");
    src.width = width;
    src.height = height;
    src.getContext("2d")!.putImageData(data, 0, 0);
    let w = width;
    let h = height;
    while (w / 2 >= tw && h / 2 >= th) {
      const next = document.createElement("canvas");
      next.width = Math.max(tw, Math.round(w / 2));
      next.height = Math.max(th, Math.round(h / 2));
      const c = next.getContext("2d")!;
      c.imageSmoothingQuality = "high";
      c.drawImage(src, 0, 0, next.width, next.height);
      src = next;
      w = next.width;
      h = next.height;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, tw, th);
    return out;
  }
}
