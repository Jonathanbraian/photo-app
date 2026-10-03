import { useEffect, useRef } from "react";
import type { Histogram } from "../lib/histogram";

const W = 256;
const H = 96;

/** RGB histogram (additive) with the luminance outline. */
export default function HistogramView({ data }: { data: Histogram | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (!data) return;
    // Ignore the extreme bins when scaling, so clipped pixels don't flatten the rest.
    let peak = 1;
    for (const ch of [data.r, data.g, data.b]) {
      for (let i = 1; i < 255; i++) peak = Math.max(peak, ch[i]);
    }
    const y = (v: number) => H - Math.min(H, (Math.sqrt(v) / Math.sqrt(peak)) * (H - 2));
    ctx.globalCompositeOperation = "lighter";
    const channels: [Uint32Array, string][] = [
      [data.r, "rgba(220,60,60,0.75)"],
      [data.g, "rgba(60,200,90,0.75)"],
      [data.b, "rgba(70,110,230,0.75)"],
    ];
    for (const [ch, color] of channels) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) ctx.lineTo(i, y(ch[i]));
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(230,230,230,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) ctx[i ? "lineTo" : "moveTo"](i + 0.5, y(data.l[i]));
    ctx.stroke();
  }, [data]);

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      className="h-24 w-full rounded bg-neutral-900"
      aria-label="Histograma"
    />
  );
}
