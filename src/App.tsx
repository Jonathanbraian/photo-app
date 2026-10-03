import { useEffect, useState, type ReactNode } from "react";
import Library from "./screens/Library";
import Develop from "./screens/Develop";

type Screen = "library" | "develop";

export default function App() {
  const [screen, setScreen] = useState<Screen>("library");

  // Atalhos: G (biblioteca), D (edição).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "g" || e.key === "G") setScreen("library");
      if (e.key === "d" || e.key === "D") setScreen("develop");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          <TabButton active={screen === "develop"} onClick={() => setScreen("develop")} hint="D">
            Edição
          </TabButton>
        </nav>
      </header>
      <main className="min-h-0 flex-1">{screen === "library" ? <Library /> : <Develop />}</main>
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
