import { RATIOS, ratioBase } from "../lib/crop";
import Slider from "./Slider";

interface Props {
  editing: boolean;
  ratio: string | null;
  angle: number;
  changed: boolean;
  onStart: () => void;
  onRatio: (ratio: string | null) => void;
  onFlip: () => void;
  onAngle: (angle: number) => void;
  onApply: () => void;
  onCancel: () => void;
  onReset: () => void;
}

/** Crop & straighten controls. Editing happens in crop mode (R). */
export default function CropPanel(p: Props) {
  const base = ratioBase(p.ratio);
  const portrait = !!p.ratio && (p.ratio === "original-flip" || (() => {
    const [a, b] = p.ratio.split(":").map(Number);
    return b > a;
  })());
  return (
    <div className="space-y-2 text-xs">
      {!p.editing && (
        <button
          type="button"
          onClick={p.onStart}
          className="w-full rounded border border-neutral-700 py-1 text-neutral-200 hover:bg-neutral-800"
        >
          Cortar e endireitar <kbd className="ml-1 text-neutral-500">R</kbd>
        </button>
      )}
      <div>
        <div className="mb-1 text-neutral-400">Proporção</div>
        <div className="grid grid-cols-3 gap-1">
          {RATIOS.map((r) => (
            <button
              key={r.label}
              type="button"
              aria-pressed={base === r.key}
              onClick={() => p.onRatio(r.key)}
              className={`rounded py-1 ${
                base === r.key ? "bg-sky-600 text-white" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={p.onFlip}
          title="Alternar vertical / horizontal (X)"
          className="mt-1 w-full rounded bg-neutral-900 py-1 text-neutral-300 hover:bg-neutral-800"
        >
          {portrait ? "▯ Vertical" : "▭ Horizontal"} <kbd className="ml-1 text-neutral-500">X</kbd>
        </button>
      </div>
      <Slider
        spec={{ key: "angle", label: "Endireitar", min: -45, max: 45, step: 0.1, neutral: 0, digits: 1, unit: "°" }}
        value={p.angle}
        onChange={p.onAngle}
      />
      {p.editing ? (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={p.onApply}
            className="flex-1 rounded bg-sky-600 py-1 font-medium text-white hover:bg-sky-500"
          >
            Aplicar <kbd className="ml-1 opacity-70">Enter</kbd>
          </button>
          <button
            type="button"
            onClick={p.onCancel}
            className="flex-1 rounded border border-neutral-700 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            Cancelar <kbd className="ml-1 opacity-70">Esc</kbd>
          </button>
        </div>
      ) : (
        p.changed && (
          <button
            type="button"
            onClick={p.onReset}
            className="w-full rounded py-1 text-neutral-400 hover:bg-neutral-900"
          >
            Remover corte
          </button>
        )
      )}
    </div>
  );
}
