import { useMemo, useRef, useState, type PointerEvent } from "react";
import { isIdentity, normalizePoints, pchip, type Point } from "../lib/curve";
import type { Histogram } from "../lib/histogram";
import { withCurve, type Recipe } from "../lib/recipe";

type Channel = "rgb" | "r" | "g" | "b";

const CHANNELS: { key: Channel; label: string; color: string; hist: keyof Histogram }[] = [
  { key: "rgb", label: "RGB", color: "#e5e5e5", hist: "l" },
  { key: "r", label: "R", color: "#f87171", hist: "r" },
  { key: "g", label: "G", color: "#4ade80", hist: "g" },
  { key: "b", label: "B", color: "#60a5fa", hist: "b" },
];

const HIT = 9; // grab radius in curve units (0…255)

interface Props {
  recipe: Recipe;
  histogram: Histogram | null;
  onChange: (r: Recipe) => void;
}

/**
 * Tone curve editor (0…255 both axes). Click on an empty spot adds a point,
 * drag moves it, double click removes it. Interpolation: monotone PCHIP.
 */
export default function CurveEditor({ recipe, histogram, onChange }: Props) {
  const [channel, setChannel] = useState<Channel>("rgb");
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const points = normalizePoints(recipe.curve[channel]);
  const meta = CHANNELS.find((c) => c.key === channel)!;

  const path = useMemo(() => {
    const f = pchip(points);
    let d = "";
    for (let x = 0; x <= 255; x++) d += `${x ? "L" : "M"}${x},${255 - f(x)}`;
    return d;
  }, [points]);

  const histPath = useMemo(() => {
    if (!histogram) return "";
    const h = histogram[meta.hist];
    let peak = 1;
    for (let i = 1; i < 255; i++) peak = Math.max(peak, h[i]);
    let d = "M0,255";
    for (let i = 0; i < 256; i++) d += `L${i},${255 - Math.min(255, (Math.sqrt(h[i]) / Math.sqrt(peak)) * 230)}`;
    return `${d}L255,255Z`;
  }, [histogram, meta.hist]);

  const toCurve = (e: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 255;
    const y = 255 - ((e.clientY - rect.top) / rect.height) * 255;
    return [Math.round(Math.min(255, Math.max(0, x))), Math.round(Math.min(255, Math.max(0, y)))];
  };
  const hitIndex = (p: Point) => {
    let best = -1;
    let bestD = HIT;
    points.forEach(([x, y], i) => {
      const d = Math.hypot(x - p[0], y - p[1]);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };
  const set = (pts: Point[]) => onChange(withCurve(recipe, channel, pts));

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toCurve(e);
    let i = hitIndex(p);
    if (i < 0) {
      // Add a point (x must not collide with an existing one).
      if (points.some(([x]) => x === p[0])) return;
      const next = normalizePoints([...points, p]);
      i = next.findIndex(([x]) => x === p[0]);
      set(next);
    }
    drag.current = i;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const i = drag.current;
    if (i === null) return;
    const [x, y] = toCurve(e);
    const lo = i > 0 ? points[i - 1][0] + 1 : 0;
    const hi = i < points.length - 1 ? points[i + 1][0] - 1 : 255;
    const next = points.map((pt) => [...pt] as Point);
    next[i] = [Math.min(hi, Math.max(lo, x)), y];
    set(next);
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const i = hitIndex(toCurve(e));
    if (i > 0 && i < points.length - 1) set(points.filter((_, j) => j !== i));
  };

  return (
    <div>
      <div role="tablist" className="mb-2 flex items-center gap-1 text-xs">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={channel === c.key}
            onClick={() => setChannel(c.key)}
            className={`rounded px-2 py-0.5 ${channel === c.key ? "bg-neutral-700" : "hover:bg-neutral-800"}`}
            style={{ color: c.color }}
          >
            {c.label}
            {!isIdentity(recipe.curve[c.key]) && <span className="ml-0.5">•</span>}
          </button>
        ))}
        <button
          type="button"
          onClick={() => set([[0, 0], [255, 255]])}
          disabled={isIdentity(points)}
          title={`Zerar curva ${meta.label}`}
          className="ml-auto rounded px-1.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-30"
        >
          ↺
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox="-4 -4 263 263"
        role="img"
        aria-label={`Curva ${meta.label}`}
        className="aspect-square w-full touch-none select-none rounded bg-neutral-900"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={onDoubleClick}
      >
        {histPath && <path d={histPath} fill={meta.color} opacity={0.12} />}
        {[64, 128, 192].map((v) => (
          <g key={v} stroke="#404040" strokeWidth={0.6}>
            <line x1={v} y1={0} x2={v} y2={255} />
            <line x1={0} y1={v} x2={255} y2={v} />
          </g>
        ))}
        <rect x={0} y={0} width={255} height={255} fill="none" stroke="#525252" strokeWidth={0.8} />
        <line x1={0} y1={255} x2={255} y2={0} stroke="#525252" strokeWidth={0.6} strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={meta.color} strokeWidth={1.6} />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            data-testid="curve-point"
            cx={x}
            cy={255 - y}
            r={4.5}
            fill="#0a0a0a"
            stroke={meta.color}
            strokeWidth={1.5}
          />
        ))}
      </svg>
      <p className="mt-1 text-[11px] text-neutral-500">
        Clique para adicionar, arraste para mover, duplo clique para remover.
      </p>
    </div>
  );
}
