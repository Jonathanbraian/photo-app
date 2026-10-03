import { useRef, type PointerEvent } from "react";
import { constrain, type CropRect } from "../lib/crop";

type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const MIN = 0.03;

interface Props {
  rect: CropRect;
  angle: number;
  /** Photo size in pixels (aspect math is done in pixels). */
  width: number;
  height: number;
  /** Locked pixel aspect (w/h) or null for free. */
  aspect: number | null;
  onChange: (r: CropRect) => void;
}

/**
 * Crop rectangle over the (rotated) photo: drag inside to move, handles to
 * resize, rule-of-thirds grid; never leaves the rotated photo.
 */
export default function CropOverlay({ rect, angle, width: W, height: H, aspect, onChange }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; x: number; y: number; start: CropRect } | null>(null);

  const begin = (handle: Handle) => (e: PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: rect };
  };

  const move = (e: PointerEvent) => {
    const d = drag.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.x) / box.width;
    const dy = (e.clientY - d.y) / box.height;
    const s = d.start;
    let next: CropRect;
    if (d.handle === "move") {
      next = { ...s, x: s.x + dx, y: s.y + dy };
    } else {
      let x0 = s.x;
      let y0 = s.y;
      let x1 = s.x + s.w;
      let y1 = s.y + s.h;
      if (d.handle.includes("w")) x0 = Math.min(x1 - MIN, s.x + dx);
      if (d.handle.includes("e")) x1 = Math.max(x0 + MIN, s.x + s.w + dx);
      if (d.handle.includes("n")) y0 = Math.min(y1 - MIN, s.y + dy);
      if (d.handle.includes("s")) y1 = Math.max(y0 + MIN, s.y + s.h + dy);
      let w = x1 - x0;
      let h = y1 - y0;
      if (aspect !== null) {
        // h (fraction) for a given w (fraction) at this pixel aspect, and back.
        const hFor = (wf: number) => (wf * W) / (aspect * H);
        const wFor = (hf: number) => (hf * H * aspect) / W;
        const horizontal = d.handle === "e" || d.handle === "w";
        const vertical = d.handle === "n" || d.handle === "s";
        if (horizontal || (!vertical && w / s.w >= h / s.h)) h = hFor(w);
        else w = wFor(h);
        // Anchor: the side or corner opposite to the handle; edges stay centered.
        if (horizontal) y0 = s.y + (s.h - h) / 2;
        else if (d.handle.includes("n")) y0 = s.y + s.h - h;
        if (vertical) x0 = s.x + (s.w - w) / 2;
        else if (d.handle.includes("w")) x0 = s.x + s.w - w;
      }
      next = { x: x0, y: y0, w, h };
    }
    onChange(constrain(s, next, angle, W, H));
  };

  const end = () => (drag.current = null);

  const pct = (v: number) => `${v * 100}%`;
  const handles: { h: Handle; style: React.CSSProperties; cursor: string }[] = [
    { h: "nw", style: { left: 0, top: 0 }, cursor: "nwse-resize" },
    { h: "n", style: { left: "50%", top: 0 }, cursor: "ns-resize" },
    { h: "ne", style: { left: "100%", top: 0 }, cursor: "nesw-resize" },
    { h: "e", style: { left: "100%", top: "50%" }, cursor: "ew-resize" },
    { h: "se", style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
    { h: "s", style: { left: "50%", top: "100%" }, cursor: "ns-resize" },
    { h: "sw", style: { left: 0, top: "100%" }, cursor: "nesw-resize" },
    { h: "w", style: { left: 0, top: "50%" }, cursor: "ew-resize" },
  ];

  return (
    <div ref={boxRef} className="absolute inset-0" onPointerMove={move} onPointerUp={end}>
      <div
        data-testid="crop-rect"
        className="absolute cursor-move border border-white/90"
        style={{
          left: pct(rect.x),
          top: pct(rect.y),
          width: pct(rect.w),
          height: pct(rect.h),
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
        }}
        onPointerDown={begin("move")}
      >
        {[1 / 3, 2 / 3].map((f) => (
          <div key={f}>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-white/40" style={{ left: pct(f) }} />
            <div className="pointer-events-none absolute inset-x-0 h-px bg-white/40" style={{ top: pct(f) }} />
          </div>
        ))}
        {handles.map(({ h, style, cursor }) => (
          <div
            key={h}
            data-handle={h}
            onPointerDown={begin(h)}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 border border-neutral-900 bg-white"
            style={{ ...style, cursor }}
          />
        ))}
      </div>
    </div>
  );
}
