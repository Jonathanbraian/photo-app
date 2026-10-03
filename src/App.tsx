import { useCallback, useEffect, useState, type ReactNode } from "react";
import Library from "./screens/Library";
import Develop from "./screens/Develop";
import { isTyping } from "./lib/prefs";
import { emptySelection, type Selection } from "./lib/selection";
import { useLibrary } from "./lib/useLibrary";

type Screen = "library" | "develop";

export default function App() {
  const [screen, setScreen] = useState<Screen>("library");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  // Photo opened by D / double click and shown in Develop.
  const [currentId, setCurrentId] = useState<number | null>(null);
  const lib = useLibrary(folderId);

  const openDevelop = useCallback(
    (id?: number) => {
      const target = id ?? currentId ?? [...selection.ids][0] ?? lib.photos[0]?.id ?? null;
      if (target !== null) setCurrentId(target);
      setScreen("develop");
    },
    [currentId, selection, lib.photos],
  );

  // Atalhos: G (biblioteca), D (edição).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (e.key === "g" || e.key === "G") setScreen("library");
      if (e.key === "d" || e.key === "D") openDevelop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDevelop]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-6 border-b border-neutral-800 px-4">
        <span className="text-sm font-semibold tracking-wide text-neutral-100">
          Photo Batch Editor
        </span>
        <nav className="flex gap-1 text-sm">
          <TabButton active={screen === "library"} onClick={() => setScreen("library")} hint="G">
            Biblioteca
          </TabButton>
          <TabButton active={screen === "develop"} onClick={() => openDevelop()} hint="D">
            Edição
          </TabButton>
        </nav>
      </header>
      <main className="min-h-0 flex-1">
        {screen === "library" ? (
          <Library
            lib={lib}
            folderId={folderId}
            onFolderChange={setFolderId}
            selection={selection}
            setSelection={setSelection}
            onCurrent={setCurrentId}
            onOpen={(id) => openDevelop(id)}
          />
        ) : (
          <Develop
            photos={lib.photos}
            currentId={currentId}
            onCurrentChange={setCurrentId}
            onPhotoUpdated={lib.updatePhoto}
          />
        )}
      </main>
    </div>
  );
}

function TabButton(props: {
  active: boolean;
  onClick: () => void;
  hint: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`rounded px-3 py-1 transition-colors ${
        props.active ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {props.children}
      <kbd className="ml-2 text-xs text-neutral-500">{props.hint}</kbd>
    </button>
  );
}
