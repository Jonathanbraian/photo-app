// Runs the real interface in a browser with an in-memory stand-in for the
// Rust commands (Tauri's mockIPC). The Rust side has its own tests; this
// checks the screens, WebGL preview and keyboard flows end to end.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

interface Entry {
  cur: number | null;
  history: { id: number; recipe: unknown }[];
  recipe: unknown;
  thumb: string | null;
}

const NEUTRAL = {
  version: 1,
  light: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
  color: { temperature: 6500, tint: 0, vibrance: 0, saturation: 0 },
  presence: { sharpness: 0, clarity: 0, noise: 0, vignette: 0 },
  hsl: {},
  curve: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] },
  lut: null,
  crop: { x: 0, y: 0, w: 1, h: 1, angle: 0, ratio: null },
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function makePreview(seed: number): Promise<ArrayBuffer> {
  const c = new OffscreenCanvas(1200, 800);
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 1200, 800);
  grad.addColorStop(0, `hsl(${seed * 90}, 70%, 25%)`);
  grad.addColorStop(1, `hsl(${seed * 90 + 120}, 60%, 70%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1200, 800);
  g.fillStyle = "#f2f2f2";
  g.fillRect(500, 250, 200, 300);
  return c.convertToBlob({ type: "image/jpeg", quality: 0.9 }).then((b) => b.arrayBuffer());
}

let nextHistory = 1;
const entries = new Map<number, Entry>();
const entry = (id: number) => {
  if (!entries.has(id)) entries.set(id, { cur: null, history: [], recipe: NEUTRAL, thumb: null });
  return entries.get(id)!;
};
const calls: { cmd: string; args: unknown }[] = [];

const photo = (id: number) => {
  const e = entries.get(id);
  const edited = !!e && !same(e.recipe, NEUTRAL);
  return {
    id,
    folderId: 1,
    path: `/fotos/ensaio/IMG_${id}.jpg`,
    fileName: `IMG_${id}.jpg`,
    format: "jpeg",
    hash: `h${id}`,
    width: 1200,
    height: 800,
    orientation: 1,
    camera: "Teste X1",
    lens: "50mm",
    iso: 200,
    aperture: 2.8,
    shutterSpeed: 1 / 250,
    takenAt: "2026-09-15T14:30:00",
    cacheStatus: "ready",
    cacheError: null,
    edited,
    thumbPath: edited && e?.thumb ? e.thumb : `data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=`,
    previewPath: `/cache/previews/h${id}.jpg`,
  };
};

const state = (id: number) => {
  const e = entry(id);
  const idx = e.history.findIndex((h) => h.id === e.cur);
  return {
    photoId: id,
    recipe: e.recipe,
    historyId: e.cur,
    canUndo: idx > 0,
    canRedo: idx >= 0 && idx < e.history.length - 1,
    edited: !same(e.recipe, NEUTRAL),
  };
};
const result = (id: number) => ({ state: state(id), photo: photo(id) });

const ids = [1, 2, 3];
const luts: { id: string; name: string; kind: string; size: number; title: string }[] = [];

// Failure modes seen on macOS (WKWebView), selected by query string.
const params = new URLSearchParams(location.search);
if (params.has("nobitmap")) {
  // Like Safari: createImageBitmap rejects blobs and ImageData resizing.
  window.createImageBitmap = (() =>
    Promise.reject(
      new DOMException("Cannot decode the data in the argument to createImageBitmap", "InvalidStateError"),
    )) as typeof window.createImageBitmap;
}
const previewMode = params.get("preview"); // "array" | "bad" | null

mockWindows("main");
mockIPC(
  (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args: a });
    const id = a.photoId as number;
    switch (cmd) {
      case "app_status":
        return { appVersion: "test", dbPath: "/mock", sqliteVersion: "-", schemaVersion: 3, latestSchemaVersion: 3, tables: [] };
      case "list_folders":
        return [{ id: 1, path: "/fotos/ensaio", name: "ensaio", photoCount: ids.length }];
      case "list_photos":
        return ids.map(photo);
      case "read_preview":
        if (previewMode === "bad") return new TextEncoder().encode("255,216,255,224").buffer;
        if (previewMode === "array") return makePreview(id).then((b) => Array.from(new Uint8Array(b)));
        return makePreview(id);
      case "load_edit":
        return state(id);
      case "save_recipe": {
        const e = entry(id);
        if (!same(e.recipe, a.recipe)) {
          if (e.cur === null) {
            e.history.push({ id: nextHistory, recipe: e.recipe });
            e.cur = nextHistory++;
          }
          e.history = e.history.filter((h) => h.id <= (e.cur as number));
          e.history.push({ id: nextHistory, recipe: a.recipe });
          e.cur = nextHistory++;
          e.recipe = a.recipe;
        }
        return result(id);
      }
      case "undo_edit":
      case "redo_edit": {
        const e = entry(id);
        const idx = e.history.findIndex((h) => h.id === e.cur);
        const to = e.history[idx + (cmd === "undo_edit" ? -1 : 1)];
        if (idx >= 0 && to) {
          e.cur = to.id;
          e.recipe = to.recipe;
        }
        return result(id);
      }
      case "plugin:dialog|open":
        return "/fotos/luts/Quente.cube";
      case "import_lut": {
        const info = { id: "abc123", name: "Quente", kind: "3d", size: 2, title: "" };
        if (!luts.some((l) => l.id === info.id)) luts.push(info);
        return info;
      }
      case "list_luts":
        return luts;
      case "read_lut":
        // Warm 2³ LUT: boosts red, cuts blue.
        return "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0.1 0 0.6\n1 0 0.6\n0.1 1 0.6\n1 1 0.6\n";
      case "save_edited_thumb": {
        const e = entry(id);
        if (e.cur !== a.historyId) return null;
        e.thumb = `data:image/jpeg;base64,${a.jpegBase64}`;
        return photo(id);
      }
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);
// Thumbnails are data URLs here; skip the asset protocol.
(window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc = (p) => p;
(globalThis as unknown as { isTauri: boolean }).isTauri = true;
(window as unknown as { __backend: unknown }).__backend = { calls, entries, NEUTRAL };

await import("../../src/main");
