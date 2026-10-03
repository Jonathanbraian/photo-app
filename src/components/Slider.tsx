import type { SliderSpec } from "../lib/recipe";

interface Props {
  spec: SliderSpec;
  value: number;
  onChange: (value: number) => void;
  /** CSS background for the track (e.g. a color gradient). */
  track?: string;
  /** Accessible name when the label alone is ambiguous. */
  ariaLabel?: string;
  /** Value shown instead of the default formatting. */
  display?: string;
}

/** Adjustment slider. Double click resets to the neutral value. */
export default function Slider({ spec, value, onChange, track, ariaLabel, display }: Props) {
  const changed = value !== spec.neutral;
  const shown =
    spec.digits !== undefined
      ? (value > 0 && spec.neutral === 0 ? "+" : "") + value.toFixed(spec.digits)
      : (value > 0 && spec.neutral === 0 ? "+" : "") + Math.round(value);
  // Fill from the neutral point, so it is clear which way the value moved.
  const pct = (v: number) => ((v - spec.min) / (spec.max - spec.min)) * 100;
  const a = pct(Math.min(value, spec.neutral));
  const b = pct(Math.max(value, spec.neutral));

  return (
    <div className="group py-1" onDoubleClick={() => onChange(spec.neutral)} title="Duplo clique para zerar">
      <div className="flex items-baseline justify-between text-xs">
        <span className={changed ? "text-neutral-200" : "text-neutral-400"}>{spec.label}</span>
        <span className="tabular-nums text-neutral-400">
          {display ?? (
            <>
              {shown}
              {spec.unit ? ` ${spec.unit}` : ""}
            </>
          )}
        </span>
      </div>
      <div className="relative mt-1 h-4">
        {track ? (
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded" style={{ background: track }} />
        ) : (
          <>
            <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-neutral-700" />
            <div
              className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded bg-sky-500"
              style={{ left: `${a}%`, width: `${b - a}%` }}
            />
          </>
        )}
        <input
          type="range"
          aria-label={ariaLabel ?? spec.label}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          // Don't keep focus after dragging, so ← → keep navigating photos.
          onPointerUp={(e) => e.currentTarget.blur()}
          className="slider absolute inset-0 w-full"
        />
      </div>
    </div>
  );
}
