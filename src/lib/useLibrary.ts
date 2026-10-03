import { useCallback, useEffect, useRef, useState } from "react";
import {
  importFolders,
  isTauri,
  listFolders,
  listPhotos,
  onImportEvent,
  type Folder,
  type ImportSummary,
  type Photo,
} from "./api";

export interface ImportProgress {
  done: number;
  total: number;
}

/** Catalog state for the Library screen, kept in sync with import events. */
export function useLibrary(folderId: number | null) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const folderRef = useRef(folderId);
  folderRef.current = folderId;

  const reload = useCallback(async () => {
    if (!isTauri()) return;
    const requested = folderRef.current;
    const [f, p] = await Promise.all([listFolders(), listPhotos(requested)]);
    setFolders(f);
    // Ignore stale answers if the filter changed meanwhile.
    if (folderRef.current === requested) setPhotos(p);
  }, []);

  useEffect(() => {
    reload().catch((e: unknown) => setError(String(e)));
  }, [folderId, reload]);

  // Photo updates arrive one per file; apply them at most once per frame.
  const pending = useRef(new Map<number, Photo>());
  const frame = useRef<number | null>(null);
  const flush = useCallback(() => {
    frame.current = null;
    const updates = pending.current;
    pending.current = new Map();
    setPhotos((list) => list.map((p) => updates.get(p.id) ?? p));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onImportEvent((e) => {
      switch (e.kind) {
        case "started":
          setSummary(null);
          setProgress({ done: e.total - e.toProcess, total: e.total });
          reload().catch((err: unknown) => setError(String(err)));
          break;
        case "progress":
          setProgress({ done: e.done, total: e.total });
          if (e.photo) {
            pending.current.set(e.photo.id, e.photo);
            frame.current ??= requestAnimationFrame(flush);
          }
          break;
        case "finished": {
          const { kind: _kind, ...rest } = e;
          setProgress(null);
          setSummary(rest);
          reload().catch((err: unknown) => setError(String(err)));
          break;
        }
        case "failed":
          setProgress(null);
          setError(e.message);
          break;
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [flush, reload]);

  const startImport = useCallback(async (paths: string[], recursive: boolean) => {
    if (paths.length === 0) return;
    setError(null);
    setProgress((p) => p ?? { done: 0, total: 0 });
    try {
      await importFolders(paths, recursive);
    } catch (e: unknown) {
      setProgress((p) => (p && p.total === 0 ? null : p));
      setError(String(e));
    }
  }, []);

  /** Replaces one photo in the list (e.g. after an edit changes its thumbnail). */
  const updatePhoto = useCallback((photo: Photo) => {
    setPhotos((list) => list.map((p) => (p.id === photo.id ? photo : p)));
  }, []);

  return {
    folders,
    photos,
    progress,
    summary,
    error,
    startImport,
    updatePhoto,
    dismissSummary: () => setSummary(null),
    dismissError: () => setError(null),
  };
}
