import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { checkJpeg, toBytes } from "./imageDecode";
import type { Recipe } from "./recipe";

/** Mirrors `commands::system::AppStatus` in Rust. */
export interface AppStatus {
  appVersion: string;
  dbPath: string;
  sqliteVersion: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  tables: string[];
}

export interface Folder {
  id: number;
  path: string;
  name: string;
  photoCount: number;
}

export type CacheStatus = "pending" | "ready" | "error";

/** Mirrors `commands::library::PhotoView`. */
export interface Photo {
  id: number;
  folderId: number | null;
  path: string;
  fileName: string;
  format: string;
  hash: string | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
  camera: string | null;
  lens: string | null;
  iso: number | null;
  aperture: number | null;
  /** seconds */
  shutterSpeed: number | null;
  takenAt: string | null;
  cacheStatus: CacheStatus;
  cacheError: string | null;
  /** Has a non-neutral recipe (badge in the library). */
  edited: boolean;
  thumbPath: string | null;
  previewPath: string | null;
}

export interface ImportSummary {
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  errors: { path: string; message: string }[];
}

/** Mirrors `commands::library::ImportEventView`. */
export type ImportEvent =
  | { kind: "started"; total: number; toProcess: number }
  | { kind: "progress"; done: number; total: number; photo: Photo | null }
  | ({ kind: "finished" } & ImportSummary)
  | { kind: "failed"; message: string };

export { isTauri };

export function getAppStatus(): Promise<AppStatus> {
  return invoke<AppStatus>("app_status");
}

export function importFolders(paths: string[], recursive: boolean): Promise<void> {
  return invoke("import_folders", { paths, recursive });
}

export function listFolders(): Promise<Folder[]> {
  return invoke<Folder[]>("list_folders");
}

export function listPhotos(folderId: number | null): Promise<Photo[]> {
  return invoke<Photo[]>("list_photos", { folderId });
}

export function onImportEvent(handler: (e: ImportEvent) => void): Promise<UnlistenFn> {
  return listen<ImportEvent>("import", (e) => handler(e.payload));
}

/** Folder picker; returns an empty list when cancelled. */
export async function pickFolders(): Promise<string[]> {
  const result = await open({ directory: true, multiple: true, title: "Importar pastas" });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

/** URL the webview can load for a cache file. */
export function fileUrl(path: string): string {
  return convertFileSrc(path);
}

/** Mirrors `db::edits::EditState`. */
export interface EditState {
  photoId: number;
  recipe: Recipe;
  historyId: number | null;
  canUndo: boolean;
  canRedo: boolean;
  edited: boolean;
}

export interface EditResult {
  state: EditState;
  photo: Photo | null;
}

/** The 2048 px preview JPEG bytes (never the original file), validated. */
export async function readPreview(photoId: number): Promise<Uint8Array> {
  const bytes = toBytes(await invoke<unknown>("read_preview", { photoId }));
  checkJpeg(bytes);
  return bytes;
}

export function loadEdit(photoId: number): Promise<EditState> {
  return invoke<EditState>("load_edit", { photoId });
}

export function saveRecipe(photoId: number, recipe: Recipe): Promise<EditResult> {
  return invoke<EditResult>("save_recipe", { photoId, recipe });
}

export function undoEdit(photoId: number): Promise<EditResult> {
  return invoke<EditResult>("undo_edit", { photoId });
}

export function redoEdit(photoId: number): Promise<EditResult> {
  return invoke<EditResult>("redo_edit", { photoId });
}

export function saveEditedThumb(
  photoId: number,
  historyId: number | null,
  jpegBase64: string,
): Promise<Photo | null> {
  return invoke<Photo | null>("save_edited_thumb", { photoId, historyId, jpegBase64 });
}

export interface LutInfo {
  id: string;
  name: string;
  kind: "1d" | "3d";
  size: number;
  title: string;
}

/** Validates the `.cube` and copies it to the app data folder. */
export function importLut(path: string): Promise<LutInfo> {
  return invoke<LutInfo>("import_lut", { path });
}

export function listLuts(): Promise<LutInfo[]> {
  return invoke<LutInfo[]>("list_luts");
}

/** Text of an imported LUT (the app's own copy). */
export function readLut(id: string): Promise<string> {
  return invoke<string>("read_lut", { id });
}

/** File picker for `.cube` files; null when cancelled. */
export async function pickCube(): Promise<string | null> {
  const result = await open({
    multiple: false,
    directory: false,
    title: "Importar LUT",
    filters: [{ name: "LUT .cube", extensions: ["cube", "CUBE"] }],
  });
  return typeof result === "string" ? result : null;
}
