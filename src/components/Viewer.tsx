import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { PreviewRenderer } from "../gl/renderer";
import { computeHistogram, type Histogram } from "../lib/histogram";
import type { DecodedImage } from "../lib/imageDecode";
import type { Recipe } from "../lib/recipe";

export type Zoom = "fit" | "100";

interface Props {
  /** Image to show (null while loading). */
  image: DecodedImage | null;
  recipe: Recipe;
  bypass: boolean;
  zoom: Zoom;
  onZoomChange: (z: Zoom) => void;
  onHistogram: (h: Histogram) => void;
  onRenderer: (r: PreviewRenderer | null) => void;
  onError: (message: string) => void;
}

/**
 * Large preview. "fit" shows the whole photo; "100" shows the 2048 px preview
 * at one image pixel per screen pixel. Click toggles; drag pans at 100 %.
 */
export default function Viewer(props: Props) {
  const { image, recipe, bypass, zoom, onZoomChange } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number }; moved: boolean } | null>(
    null,
  );
  const cb = useRef(props);
  cb.current = props;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    try {
      const r = new PreviewRenderer(canvasRef.current!);
      rendererRef.current = r;
      cb.current.onRenderer(r);
      return () => {
        cb.current.onRenderer(null);
        r.dispose();
        rendererRef.current = null;
      };
    } catch (e: unknown) {
      cb.current.onError(String(e instanceof Error ? e.message : e));
    }
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !image) return;
    r.setImage(image.source, image.width, image.height);
    setSize({ w: image.width, h: image.height });
    setPan({ x: 0, y: 0 });
  }, [image]);

  // Render at most once per frame; the histogram comes from a 256 px readback.
  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (!image) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const r = rendererRef.current;
      if (!r) return;
      r.render(recipe, { bypass });
      const { pixels } = r.readPixels(recipe, { bypass }, 256);
      cb.current.onHistogram(computeHistogram(pixels));
    });
  }, [image, recipe, bypass]);

  const dpr = window.devicePixelRatio || 1;
  const fitScale = size.w && box.w ? Math.min(box.w / size.w, box.h / size.h, 1 / dpr) : 0;
  const scale = zoom === "fit" ? fitScale : 1 / dpr;
  const w = size.w * scale;
  const h = size.h * scale;
  const clampPan = (p: { x: number; y: number }) => {
    const mx = Math.max(0, (w - box.w) / 2);
    const my = Math.max(0, (h - box.h) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };
  const p = zoom === "100" ? clampPan(pan) : { x: 0, y: 0 };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pan: p, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
    if (d.moved && zoom === "100") setPan(clampPan({ x: d.pan.x + dx, y: d.pan.y + dy }));
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !size.w) return;
    if (zoom === "fit") {
      // Zoom to 100 % keeping the clicked point under the cursor.
      const rect = boxRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const fx = (cx - (box.w - w) / 2) / w;
      const fy = (cy - (box.h - h) / 2) / h;
      const w100 = size.w / dpr;
      const h100 = size.h / dpr;
      setPan({ x: cx - box.w / 2 - (fx - 0.5) * w100, y: cy - box.h / 2 - (fy - 0.5) * h100 });
      onZoomChange("100");
    } else {
      onZoomChange("fit");
    }
  };

  return (
    <div
      ref={boxRef}
      className={`relative h-full w-full overflow-hidden bg-neutral-950 ${
        zoom === "fit" ? "cursor-zoom-in" : drag.current?.moved ? "cursor-grabbing" : "cursor-grab"
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <canvas
        ref={canvasRef}
        className="absolute"
        style={{
          width: w,
          height: h,
          left: (box.w - w) / 2 + p.x,
          top: (box.h - h) / 2 + p.y,
          visibility: image ? "visible" : "hidden",
        }}
      />
    </div>
  );
}
