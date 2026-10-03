import { useCallback, useEffect, useRef, useState } from "react";
import {
  isTauri,
  loadEdit,
  redoEdit,
  saveEditedThumb,
  saveRecipe,
  undoEdit,
  type EditResult,
  type EditState,
  type Photo,
} from "./api";
import { defaultRecipe, normalizeRecipe, recipesEqual, type Recipe } from "./recipe";

const SAVE_DELAY_MS = 300;

interface Options {
  photoId: number | null;
  /** Library row changed (badge / thumbnail). */
  onPhotoUpdated: (photo: Photo) => void;
  /** Renders `recipe` of `photoId` to a base64 JPEG thumbnail, or null if not possible now. */
  makeThumbnail: (photoId: number, recipe: Recipe) => Promise<string | null>;
}

/**
 * Recipe state of the photo being edited. Changes render immediately and are
 * saved ~300 ms after the last one; each save is one undo step.
 */
export function useEditor({ photoId, onPhotoUpdated, makeThumbnail }: Options) {
  const [recipe, setRecipeState] = useState<Recipe>(defaultRecipe);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const photoRef = useRef<number | null>(null);
  const recipeRef = useRef(recipe);
  const timer = useRef<number | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const cbs = useRef({ onPhotoUpdated, makeThumbnail });
  cbs.current = { onPhotoUpdated, makeThumbnail };

  const apply = useCallback((res: EditResult, takeRecipe: boolean) => {
    if (res.state.photoId !== photoRef.current) {
      if (res.photo) cbs.current.onPhotoUpdated(res.photo);
      return;
    }
    setEdit(res.state);
    if (takeRecipe) {
      const r = normalizeRecipe(res.state.recipe);
      recipeRef.current = r;
      setRecipeState(r);
    }
    if (res.photo) cbs.current.onPhotoUpdated(res.photo);
    if (res.state.edited) {
      const { photoId: id, historyId } = res.state;
      const r = normalizeRecipe(res.state.recipe);
      void cbs.current
        .makeThumbnail(id, r)
        .then((b64) => (b64 ? saveEditedThumb(id, historyId, b64) : null))
        .then((photo) => photo && cbs.current.onPhotoUpdated(photo))
        .catch(() => undefined);
    }
  }, []);

  /** Saves pending changes now (before undo, photo switch, unmount). */
  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
      const id = photoRef.current;
      const r = recipeRef.current;
      if (id !== null) {
        saving.current = saving.current
          .then(() => saveRecipe(id, r))
          .then((res) => apply(res, false))
          .catch((e: unknown) => setError(String(e)));
      }
    }
    await saving.current;
  }, [apply]);

  // Load the recipe whenever the photo changes.
  useEffect(() => {
    if (!isTauri() || photoId === null) return;
    let cancelled = false;
    void (async () => {
      await flush();
      if (cancelled) return;
      photoRef.current = photoId;
      try {
        const st = await loadEdit(photoId);
        if (cancelled) return;
        const r = normalizeRecipe(st.recipe);
        recipeRef.current = r;
        setRecipeState(r);
        setEdit(st);
        setError(null);
      } catch (e: unknown) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoId, flush]);

  // Save whatever is pending when leaving the screen.
  useEffect(() => () => void flush(), [flush]);

  const setRecipe = useCallback(
    (next: Recipe) => {
      if (recipesEqual(next, recipeRef.current)) return;
      recipeRef.current = next;
      setRecipeState(next);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const id = photoRef.current;
        if (id === null) return;
        saving.current = saving.current
          .then(() => saveRecipe(id, next))
          .then((res) => apply(res, false))
          .catch((e: unknown) => setError(String(e)));
      }, SAVE_DELAY_MS);
    },
    [apply],
  );

  const history = useCallback(
    async (dir: "undo" | "redo") => {
      await flush();
      const id = photoRef.current;
      if (id === null) return;
      try {
        const res = await (dir === "undo" ? undoEdit(id) : redoEdit(id));
        apply(res, true);
      } catch (e: unknown) {
        setError(String(e));
      }
    },
    [apply, flush],
  );

  // Unsaved changes count as an undo step (Ctrl+Z saves them, then undoes).
  const dirty = edit !== null && !recipesEqual(recipe, normalizeRecipe(edit.recipe));

  return {
    recipe,
    setRecipe,
    canUndo: (edit?.canUndo ?? false) || dirty,
    canRedo: edit?.canRedo ?? false,
    undo: () => history("undo"),
    redo: () => history("redo"),
    error,
    /** The loaded recipe belongs to this photo (avoid rendering a stale one). */
    loadedFor: edit?.photoId ?? null,
  };
}
