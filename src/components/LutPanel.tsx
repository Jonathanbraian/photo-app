import type { LutInfo } from "../lib/api";
import type { Recipe } from "../lib/recipe";
import Slider from "./Slider";

interface Props {
  recipe: Recipe;
  luts: LutInfo[];
  busy: boolean;
  onImport: () => void;
  onChange: (lut: Recipe["lut"]) => void;
}

/** Imported `.cube` LUTs: pick one (or none) and set its strength. */
export default function LutPanel({ recipe, luts, busy, onImport, onChange }: Props) {
  const current = recipe.lut;
  const known = current && luts.some((l) => l.id === current.id);
  return (
    <div className="space-y-2 text-xs">
      <select
        aria-label="LUT"
        value={current?.id ?? ""}
        onChange={(e) => onChange(e.target.value ? { id: e.target.value, intensity: current?.intensity ?? 1 } : null)}
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
      >
        <option value="">Nenhuma</option>
        {luts.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} ({l.kind === "3d" ? `${l.size}³` : `1D ${l.size}`})
          </option>
        ))}
        {current && !known && <option value={current.id}>LUT da receita</option>}
      </select>
      <button
        type="button"
        onClick={onImport}
        disabled={busy}
        className="w-full rounded border border-neutral-700 py-1 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Importando…" : "Importar .cube…"}
      </button>
      {current && (
        <Slider
          spec={{ key: "intensity", label: "Intensidade", min: 0, max: 100, step: 1, neutral: 100, unit: "%" }}
          value={Math.round(current.intensity * 100)}
          display={`${Math.round(current.intensity * 100)} %`}
          onChange={(v) => onChange({ ...current, intensity: v / 100 })}
        />
      )}
    </div>
  );
}
