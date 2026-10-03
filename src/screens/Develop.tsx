import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CropOverlay from "../components/CropOverlay";
import CropPanel from "../components/CropPanel";
import CurveEditor from "../components/CurveEditor";
import Filmstrip from "../components/Filmstrip";
import HslPanel from "../components/HslPanel";
import LutPanel from "../components/LutPanel";
import HistogramView from "../components/HistogramView";
import Panel from "../components/Panel";
import Slider from "../components/Slider";
import Viewer, { type Zoom } from "../components/Viewer";
import type { PreviewRenderer } from "../gl/renderer";
import { importLut, listLuts, pickCube, readLut, readPreview, type LutInfo, type Photo } from "../lib/api";
import {
  FULL,
  flipRatio,
  isNeutralCrop,
  ratioAspect,
  withAspect,
  type CropRect,
} from "../lib/crop";
import { parseCube, type Lut } from "../lib/lut";
import type { Histogram } from "../lib/histogram";
import { decodeJpeg, resizeToCanvas, type DecodedImage } from "../lib/imageDecode";
import { isTyping } from "../lib/prefs";
import {
  defaultRecipe,
  getValue,
  isGroupNeutral,
  PANELS,
  resetGroup,
  withCrop,
  withValue,
  type Recipe,
} from "../lib/recipe";
import { useEditor } from "../lib/useEditor";

const THUMB_SIZE = 300;

interface Props {
  photos: Photo[];
  currentId: number | null;
  onCurrentChange: (id: number) => void;
  onPhotoUpdated: (photo: Photo) => void;
}

function describe(p: Photo): string {
  const parts: string[] = [];
  if (p.camera) parts.push(p.camera);
  if (p.lens) parts.push(p.lens);
  if (p.shutterSpeed) {
    parts.push(p.shutterSpeed >= 1 ? `${p.shutterSpeed}s` : `1/${Math.round(1 / p.shutterSpeed)}s`);
  }
  if (p.aperture) parts.push(`f/${p.aperture.toFixed(1)}`);
  if (p.iso) parts.push(`ISO ${p.iso}`);
  return parts.join(" · ");
}

async function toBase64Jpeg(canvas: HTMLCanvasElement): Promise<string | null> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export default function Develop({ photos, currentId, onCurrentChange, onPhotoUpdated }: Props) {
  const photo = photos.find((p) => p.id === currentId) ?? null;
  const index = photo ? photos.indexOf(photo) : -1;
  const [image, setImage] = useState<{ photoId: number; decoded: DecodedImage } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [histogram, setHistogram] = useState<Histogram | null>(null);
  const [bypass, setBypass] = useState(false);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const renderer = useRef<PreviewRenderer | null>(null);
  const imageRef = useRef(image);
  imageRef.current = image;

  // Keep a valid current photo (e.g. after the folder filter changed).
  useEffect(() => {
    if (!photo && photos.length > 0) onCurrentChange(photos[0].id);
  }, [photo, photos, onCurrentChange]);

  // Load the 2048 px preview (the original file is never opened here).
  const photoId = photo?.id ?? null;
  const ready = photo?.cacheStatus === "ready";
  useEffect(() => {
    if (photoId === null || !ready) return;
    let cancelled = false;
    setLoadError(null);
    readPreview(photoId)
      .then(decodeJpeg)
      .then((decoded) => {
        if (cancelled) decoded.close();
        else
          setImage((prev) => {
            prev?.decoded.close(); // already uploaded to WebGL; free its memory
            return { photoId, decoded };
          });
      })
      .catch((e: unknown) => !cancelled && setLoadError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [photoId, ready]);

  const makeThumbnail = useCallback(async (id: number, recipe: Recipe) => {
    const r = renderer.current;
    if (!r || imageRef.current?.photoId !== id) return null;
    // The renderer must hold this recipe's LUT (it may still be loading).
    if (recipe.lut && lutRef.current?.id !== recipe.lut.id) return null;
    const { pixels, width, height } = r.readPixels(recipe);
    const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    return toBase64Jpeg(await resizeToCanvas(pixels, width, height, tw, th));
  }, []);

  const editor = useEditor({ photoId, onPhotoUpdated, makeThumbnail });
  const { recipe, setRecipe } = editor;
  const [toolError, setToolError] = useState<string | null>(null);

  // ── LUTs: imported list, and the parsed LUT the recipe points to ──────────
  const [luts, setLuts] = useState<LutInfo[]>([]);
  const [lutBusy, setLutBusy] = useState(false);
  const lutCache = useRef(new Map<string, Lut>());
  const [lutState, setLutState] = useState<{ id: string; lut: Lut | null } | null>(null);
  const lutRef = useRef(lutState);
  lutRef.current = lutState;
  const lutId = recipe.lut?.id ?? null;

  useEffect(() => {
    listLuts().then(setLuts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!lutId) return;
    const cached = lutCache.current.get(lutId);
    if (cached) {
      setLutState({ id: lutId, lut: cached });
      return;
    }
    let cancelled = false;
    readLut(lutId)
      .then((text) => {
        const lut = parseCube(text);
        lutCache.current.set(lutId, lut);
        if (!cancelled) setLutState({ id: lutId, lut });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setToolError(`LUT: ${e instanceof Error ? e.message : String(e)}`);
        setLutState({ id: lutId, lut: null });
      });
    return () => {
      cancelled = true;
    };
  }, [lutId]);

  const lutReady = !lutId || lutState?.id === lutId;
  const activeLut = lutId && lutState?.id === lutId ? lutState.lut : null;

  const onImportLut = async () => {
    const path = await pickCube();
    if (!path) return;
    setLutBusy(true);
    setToolError(null);
    try {
      const info = await importLut(path);
      setLuts(await listLuts());
      setRecipe({ ...recipe, lut: { id: info.id, intensity: recipe.lut?.intensity ?? 1 } });
    } catch (e: unknown) {
      setToolError(`LUT: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLutBusy(false);
    }
  };

  // ── Crop mode: a draft edited over the whole rotated frame ────────────────
  const [draft, setDraft] = useState<Recipe["crop"] | null>(null);
  const W = image?.decoded.width ?? 1;
  const H = image?.decoded.height ?? 1;
  useEffect(() => setDraft(null), [photoId]);

  const startCrop = useCallback((): Recipe["crop"] | null => {
    if (!image) return null;
    const c = recipe.crop;
    const d = isNeutralCrop(c, c.angle) ? { ...FULL, angle: 0, ratio: c.ratio } : { ...c };
    setDraft(d);
    setZoom("fit");
    requestAnimationFrame(() => document.getElementById("panel-crop")?.scrollIntoView({ block: "nearest" }));
    return d;
  }, [image, recipe.crop]);

  const pixelAspect = (r: CropRect) => (r.w * W) / (r.h * H);
  const updateDraft = (fn: (d: Recipe["crop"]) => Recipe["crop"]) => {
    const base = draft ?? startCrop();
    if (base) setDraft(fn(base));
  };
  const onRatio = (key: string | null) =>
    updateDraft((d) => {
      let ratio = key;
      const a = ratioAspect(key, W, H);
      // Keep the current orientation when picking a ratio.
      if (a !== null && a !== 1 && pixelAspect(d) < 1 !== a < 1) ratio = flipRatio(key);
      return { ...d, ...withAspect(d, ratioAspect(ratio, W, H), d.angle, W, H), ratio };
    });
  const onFlip = () =>
    updateDraft((d) => {
      const ratio = flipRatio(d.ratio);
      const aspect = ratio ? ratioAspect(ratio, W, H) : 1 / pixelAspect(d);
      return { ...d, ...withAspect(d, aspect, d.angle, W, H), ratio };
    });
  const onAngle = (angle: number) =>
    updateDraft((d) => ({ ...d, ...withAspect(d, pixelAspect(d), angle, W, H), angle }));
  const applyCrop = useCallback(() => {
    if (!draft) return;
    setRecipe(withCrop(recipe, draft));
    setDraft(null);
  }, [draft, recipe, setRecipe]);
  const cancelCrop = useCallback(() => setDraft(null), []);

  const cropOverride = useMemo(
    () => (draft ? { ...FULL, angle: draft.angle } : undefined),
    [draft],
  );
  // Show the photo only with its own recipe (never the previous photo's).
  const shown =
    image && image.photoId === photoId && editor.loadedFor === photoId && lutReady ? image.decoded : null;

  const go = useCallback(
    (delta: number) => {
      const next = photos[index + delta];
      if (next) onCurrentChange(next.id);
    },
    [photos, index, onCurrentChange],
  );

  // Keyboard: ← →, undo/redo, hold \ for "before"; crop mode: R, X, Enter, Esc.
  const { undo: undoEdit, redo: redoEdit } = editor;
  const undo = useCallback(() => {
    setDraft(null);
    return undoEdit();
  }, [undoEdit]);
  const redo = useCallback(() => {
    setDraft(null);
    return redoEdit();
  }, [redoEdit]);
  const keys = useRef({ draft, startCrop, applyCrop, cancelCrop, onFlip });
  keys.current = { draft, startCrop, applyCrop, cancelCrop, onFlip };
  useEffect(() => {
    const isBackslash = (e: KeyboardEvent) =>
      e.key === "\\" || e.code === "Backslash" || e.code === "IntlBackslash";
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === "KeyZ") {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      } else if (mod && e.code === "KeyY") {
        e.preventDefault();
        void redo();
      } else if (isBackslash(e)) {
        e.preventDefault();
        setBypass(true);
      } else if (!mod && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        if (keys.current.draft) keys.current.applyCrop();
        else keys.current.startCrop();
      } else if (keys.current.draft && !mod && (e.key === "x" || e.key === "X")) {
        e.preventDefault();
        keys.current.onFlip();
      } else if (keys.current.draft && e.key === "Enter") {
        e.preventDefault();
        keys.current.applyCrop();
      } else if (keys.current.draft && e.key === "Escape") {
        e.preventDefault();
        keys.current.cancelCrop();
      } else if (keys.current.draft) {
        // No photo navigation while cropping.
      } else if (!mod && e.key === "ArrowLeft" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        go(-1);
      } else if (!mod && e.key === "ArrowRight" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        go(1);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (isBackslash(e)) setBypass(false);
    };
    const blur = () => setBypass(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [go, undo, redo]);

  if (photos.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Importe fotos na Biblioteca (G) para começar a editar.
      </div>
    );
  }

  const error = glError ?? loadError ?? editor.error ?? toolError;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-3 border-b border-neutral-800 px-4 text-sm">
            <span className="truncate text-neutral-200">{photo?.fileName}</span>
            <span className="truncate text-xs text-neutral-500">{photo && describe(photo)}</span>
            <div className="ml-auto flex shrink-0 items-center gap-2 text-xs">
              {bypass && <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">Antes</span>}
              {draft && <span className="rounded bg-sky-500/20 px-2 py-0.5 text-sky-300">Corte</span>}
              <button
                type="button"
                disabled={!!draft}
                onClick={() => setZoom(zoom === "fit" ? "100" : "fit")}
                title="Clique na foto para alternar. 100 % = um pixel da prévia de 2048 px por pixel da tela."
                className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800"
              >
                {zoom === "fit" ? "Ajustar" : "100%"}
              </button>
              <button
                type="button"
                onClick={() => void editor.undo()}
                disabled={!editor.canUndo}
                title="Desfazer (Ctrl/Cmd+Z)"
                className="rounded px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-30"
              >
                ↶
              </button>
              <button
                type="button"
                onClick={() => void editor.redo()}
                disabled={!editor.canRedo}
                title="Refazer (Ctrl/Cmd+Shift+Z)"
                className="rounded px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-30"
              >
                ↷
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <Viewer
              image={shown}
              recipe={recipe}
              bypass={bypass}
              lut={activeLut}
              crop={cropOverride}
              overlay={
                draft ? (
                  <CropOverlay
                    rect={draft}
                    angle={draft.angle}
                    width={W}
                    height={H}
                    aspect={ratioAspect(draft.ratio, W, H)}
                    onChange={(r) => setDraft({ ...draft, ...r })}
                  />
                ) : undefined
              }
              zoom={zoom}
              onZoomChange={setZoom}
              onHistogram={setHistogram}
              onRenderer={(r) => (renderer.current = r)}
              onError={setGlError}
            />
            {!shown && !error && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
                {photo && !ready ? "Gerando prévia…" : "Carregando…"}
              </div>
            )}
            {error && (
              <div className="absolute inset-x-4 top-4 rounded border border-red-900 bg-red-950/80 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>
        </section>

        <aside className="flex w-72 shrink-0 flex-col border-l border-neutral-800">
          <div className="border-b border-neutral-800 p-3">
            <HistogramView data={shown ? histogram : null} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {PANELS.map((panel) => (
              <Panel
                key={panel.group}
                id={panel.group}
                title={panel.title}
                canReset={!isGroupNeutral(recipe, panel.group)}
                onReset={() => setRecipe(resetGroup(recipe, panel.group))}
              >
                {panel.sliders.map((spec) => (
                  <Slider
                    key={spec.key}
                    spec={spec}
                    value={getValue(recipe, panel.group, spec.key)}
                    onChange={(v) => setRecipe(withValue(recipe, panel.group, spec.key, v))}
                  />
                ))}
              </Panel>
            ))}
            <Panel
              id="hsl"
              title="HSL / Cor"
              canReset={!isGroupNeutral(recipe, "hsl")}
              onReset={() => setRecipe(resetGroup(recipe, "hsl"))}
            >
              <HslPanel recipe={recipe} onChange={setRecipe} />
            </Panel>
            <Panel
              id="curve"
              title="Curva de tons"
              canReset={!isGroupNeutral(recipe, "curve")}
              onReset={() => setRecipe(resetGroup(recipe, "curve"))}
            >
              <CurveEditor recipe={recipe} histogram={shown ? histogram : null} onChange={setRecipe} />
            </Panel>
            <Panel
              id="crop"
              title="Corte"
              canReset={!isGroupNeutral(recipe, "crop")}
              onReset={() => {
                setDraft(null);
                setRecipe(resetGroup(recipe, "crop"));
              }}
            >
              <CropPanel
                editing={!!draft}
                ratio={(draft ?? recipe.crop).ratio}
                angle={(draft ?? recipe.crop).angle}
                changed={!isNeutralCrop(recipe.crop, recipe.crop.angle)}
                onStart={() => void startCrop()}
                onRatio={onRatio}
                onFlip={onFlip}
                onAngle={onAngle}
                onApply={applyCrop}
                onCancel={cancelCrop}
                onReset={() => setRecipe(resetGroup(recipe, "crop"))}
              />
            </Panel>
            <Panel
              id="lut"
              title="LUT"
              canReset={!isGroupNeutral(recipe, "lut")}
              onReset={() => setRecipe(resetGroup(recipe, "lut"))}
            >
              <LutPanel
                recipe={recipe}
                luts={luts}
                busy={lutBusy}
                onImport={() => void onImportLut()}
                onChange={(lut) => setRecipe({ ...recipe, lut })}
              />
            </Panel>
            <div className="p-3">
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setRecipe(defaultRecipe());
                }}
                className="w-full rounded border border-neutral-800 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
              >
                Zerar todos os ajustes
              </button>
            </div>
          </div>
        </aside>
      </div>

      <div className="h-24 shrink-0 border-t border-neutral-800">
        <Filmstrip photos={photos} currentId={photoId} onSelect={onCurrentChange} />
      </div>
    </div>
  );
}
