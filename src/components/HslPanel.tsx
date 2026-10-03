import { useState } from "react";
import { HSL_COLORS } from "../lib/hsl";
import { store, stored } from "../lib/prefs";
import { withHsl, type Recipe } from "../lib/recipe";
import Slider from "./Slider";

const TABS = [
  { field: "h", label: "Matiz" },
  { field: "s", label: "Saturação" },
  { field: "l", label: "Luminância" },
] as const;

/** Track gradients that show what each slider does to that color. */
function gradient(field: "h" | "s" | "l", center: number): string {
  if (field === "h") {
    return `linear-gradient(90deg, hsl(${center - 30} 80% 50%), hsl(${center} 80% 50%), hsl(${center + 30} 80% 50%))`;
  }
  if (field === "s") return `linear-gradient(90deg, hsl(${center} 0% 50%), hsl(${center} 90% 50%))`;
  return `linear-gradient(90deg, hsl(${center} 70% 15%), hsl(${center} 70% 50%), hsl(${center} 70% 85%))`;
}

interface Props {
  recipe: Recipe;
  onChange: (r: Recipe) => void;
}

/** HSL per color, with "Matiz / Saturação / Luminância" tabs like Lightroom. */
export default function HslPanel({ recipe, onChange }: Props) {
  const [tab, setTab] = useState<"h" | "s" | "l">(() => stored("hsl.tab", "h"));
  const select = (t: "h" | "s" | "l") => {
    setTab(t);
    store("hsl.tab", t);
  };
  return (
    <div>
      <div role="tablist" className="mb-2 flex rounded bg-neutral-900 p-0.5 text-xs">
        {TABS.map((t) => (
          <button
            key={t.field}
            type="button"
            role="tab"
            aria-selected={tab === t.field}
            onClick={() => select(t.field)}
            className={`flex-1 rounded py-1 ${
              tab === t.field ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {HSL_COLORS.map((c) => (
        <Slider
          key={`${tab}-${c.key}`}
          spec={{ key: c.key, label: c.label, min: -100, max: 100, step: 1, neutral: 0 }}
          value={recipe.hsl[c.key]?.[tab] ?? 0}
          track={gradient(tab, c.center)}
          ariaLabel={`${TABS.find((t) => t.field === tab)!.label} ${c.label}`}
          onChange={(v) => onChange(withHsl(recipe, c.key, tab, v))}
        />
      ))}
    </div>
  );
}
