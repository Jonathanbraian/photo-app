import { useState, type ReactNode } from "react";
import { store, stored } from "../lib/prefs";

interface Props {
  id: string;
  title: string;
  canReset: boolean;
  onReset: () => void;
  children: ReactNode;
}

/** Collapsible adjustment panel with a "reset group" button. */
export default function Panel({ id, title, canReset, onReset, children }: Props) {
  const [open, setOpen] = useState(() => stored(`panel.${id}`, true));
  const toggle = () => {
    setOpen(!open);
    store(`panel.${id}`, !open);
  };
  return (
    <section id={`panel-${id}`} className="border-b border-neutral-800">
      <header className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={toggle}
          className="flex flex-1 items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-300"
          aria-expanded={open}
        >
          <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          {title}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={!canReset}
          title={`Zerar ${title}`}
          className="rounded px-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ↺
        </button>
      </header>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}
