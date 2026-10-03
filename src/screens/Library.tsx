import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import PhotoGrid from "../components/PhotoGrid";
import Sidebar from "../components/Sidebar";
import StatusCard from "../components/StatusCard";
import { isTauri, pickFolders } from "../lib/api";
import { clickSelect, emptySelection, retain, selectAll, type Selection } from "../lib/selection";
import { isTyping, store, stored } from "../lib/prefs";
import type { useLibrary } from "../lib/useLibrary";

interface Props {
  lib: ReturnType<typeof useLibrary>;
  folderId: number | null;
  onFolderChange: (id: number | null) => void;
  selection: Selection;
  setSelection: Dispatch<SetStateAction<Selection>>;
  /** Last clicked photo: what D opens in the Develop screen. */
  onCurrent: (id: number) => void;
  /** Double click: open in Develop. */
  onOpen: (id: number) => void;
}

export default function Library({
  lib,
  folderId,
  onFolderChange,
  selection,
  setSelection,
  onCurrent,
  onOpen,
}: Props) {
  const [recursive, setRecursive] = useState(() => stored("import.recursive", true));
  const [cellSize, setCellSize] = useState(() => stored("grid.size", 160));
  const [dragging, setDragging] = useState(false);

  const ids = useMemo(() => lib.photos.map((p) => p.id), [lib.photos]);
  const totalPhotos = lib.folders.reduce((n, f) => n + f.photoCount, 0);

  useEffect(() => store("import.recursive", recursive), [recursive]);
  useEffect(() => store("grid.size", cellSize), [cellSize]);
  useEffect(() => setSelection((s) => retain(s, ids)), [ids, setSelection]);

  // Ctrl/Cmd+A selects everything in view; Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(selectAll(ids));
      } else if (e.key === "Escape") {
        setSelection(emptySelection);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, setSelection]);

  // Drag and drop folders from Finder / Explorer.
  const { startImport } = lib;
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") setDragging(true);
        else if (e.payload.type === "leave") setDragging(false);
        else if (e.payload.type === "drop") {
          setDragging(false);
          void startImport(e.payload.paths, recursive);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [startImport, recursive]);

  const onImportClick = async () => {
    const paths = await pickFolders();
    await startImport(paths, recursive);
  };

  const onCellClick = (index: number, e: MouseEvent) => {
    onCurrent(ids[index]);
    setSelection((s) =>
      clickSelect(s, ids, index, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey }),
    );
  };

  const importing = lib.progress !== null;
  const empty = lib.photos.length === 0 && totalPhotos === 0;

  return (
    <div className="relative flex h-full">
      <Sidebar
        folders={lib.folders}
        totalPhotos={totalPhotos}
        selectedFolder={folderId}
        onSelectFolder={(id) => {
          onFolderChange(id);
          setSelection(emptySelection);
        }}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-4 border-b border-neutral-800 px-4 text-sm">
          <button
            type="button"
            onClick={() => void onImportClick()}
            disabled={importing}
            className="rounded bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            Importar pasta…
          </button>
          <label className="flex items-center gap-2 text-neutral-400">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
              className="accent-sky-500"
            />
            Incluir subpastas
          </label>

          {lib.progress && <ProgressBar done={lib.progress.done} total={lib.progress.total} />}

          <label className="ml-auto flex items-center gap-2 text-neutral-500" title="Tamanho das miniaturas">
            <span className="text-xs">▫</span>
            <input
              type="range"
              min={96}
              max={300}
              step={4}
              value={cellSize}
              onChange={(e) => setCellSize(Number(e.target.value))}
              className="w-28 accent-sky-500"
            />
            <span className="text-base">▢</span>
          </label>
        </div>

        {lib.error && (
          <Banner tone="error" onClose={lib.dismissError}>
            {lib.error}
          </Banner>
        )}
        {lib.summary && (
          <Banner tone={lib.summary.failed ? "warn" : "ok"} onClose={lib.dismissSummary}>
            Importação concluída: {lib.summary.processed} processada(s),{" "}
            {lib.summary.skipped} já estavam na biblioteca
            {lib.summary.failed > 0 && `, ${lib.summary.failed} com erro`}.
            {lib.summary.errors.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs">Ver erros</summary>
                <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-xs select-text">
                  {lib.summary.errors.map((err) => (
                    <li key={err.path}>
                      {err.path}: {err.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Banner>
        )}

        <div className="min-h-0 flex-1">
          {empty ? (
            <EmptyState onImport={() => void onImportClick()} />
          ) : (
            <PhotoGrid
              photos={lib.photos}
              cellSize={cellSize}
              selected={selection.ids}
              onCellClick={onCellClick}
              onCellDoubleClick={(index) => onOpen(ids[index])}
              onBackgroundClick={() => setSelection(emptySelection)}
            />
          )}
        </div>

        <footer className="flex h-11 shrink-0 items-center gap-3 border-t border-neutral-800 px-4 text-sm">
          <span className="text-neutral-400 tabular-nums">
            {selection.ids.size > 0
              ? `${selection.ids.size} de ${lib.photos.length} selecionada(s)`
              : `${lib.photos.length} foto(s)`}
          </span>
          <div className="ml-auto flex gap-2">
            {["Aplicar preset", "Colar ajustes", "Exportar"].map((label) => (
              <button
                key={label}
                type="button"
                disabled
                title="Disponível nas próximas etapas"
                className="rounded border border-neutral-800 px-3 py-1 text-neutral-500 disabled:cursor-not-allowed"
              >
                {label}
              </button>
            ))}
          </div>
        </footer>
      </section>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-sky-400 bg-sky-500/10 text-lg text-sky-200">
          Solte a pasta para importar{recursive ? " (com subpastas)" : ""}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-neutral-300">
      <div className="h-1.5 w-40 overflow-hidden rounded bg-neutral-800">
        <div className="h-full bg-sky-500 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums">
        {total > 0 ? `Importando ${done} de ${total}` : "Procurando fotos…"}
      </span>
    </div>
  );
}

function Banner(props: { tone: "ok" | "warn" | "error"; onClose: () => void; children: ReactNode }) {
  const tones = {
    ok: "border-emerald-900 bg-emerald-950/60 text-emerald-200",
    warn: "border-amber-900 bg-amber-950/60 text-amber-200",
    error: "border-red-900 bg-red-950/60 text-red-200",
  };
  return (
    <div className={`flex items-start gap-3 border-b px-4 py-2 text-sm ${tones[props.tone]}`}>
      <div className="min-w-0 flex-1">{props.children}</div>
      <button type="button" onClick={props.onClose} className="opacity-70 hover:opacity-100" aria-label="Fechar">
        ✕
      </button>
    </div>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-lg space-y-6 text-center">
        <div>
          <p className="text-lg text-neutral-300">Arraste uma pasta para cá</p>
          <p className="mt-1 text-sm text-neutral-500">
            ou{" "}
            <button type="button" onClick={onImport} className="text-sky-400 hover:underline">
              escolha uma pasta
            </button>
            . JPEG, PNG, TIFF, HEIC e RAW (CR2, CR3, NEF, ARW, RAF, DNG).
          </p>
        </div>
        <StatusCard />
      </div>
    </div>
  );
}
