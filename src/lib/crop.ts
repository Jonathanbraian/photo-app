/** Crop & straighten geometry (docs/ADJUSTMENTS.md §13). Rects are fractions of W/H. */

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export const RATIOS = [
  { key: null, label: "Livre" },
  { key: "original", label: "Original" },
  { key: "1:1", label: "1:1" },
  { key: "4:5", label: "4:5" },
  { key: "3:2", label: "3:2" },
  { key: "16:9", label: "16:9" },
] as const;

/** Pixel aspect (width/height) for a ratio key, or null for free. */
export function ratioAspect(ratio: string | null, W: number, H: number): number | null {
  if (!ratio) return null;
  if (ratio === "original") return W / H;
  if (ratio === "original-flip") return H / W;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
  return m ? Number(m[1]) / Number(m[2]) : null;
}

/** "4:5" ↔ "5:4", "original" ↔ "original-flip"; free stays free. */
export function flipRatio(ratio: string | null): string | null {
  if (!ratio) return null;
  if (ratio === "original") return "original-flip";
  if (ratio === "original-flip") return "original";
  const [a, b] = ratio.split(":");
  return `${b}:${a}`;
}

/** Same ratio family regardless of orientation (for highlighting buttons). */
export function ratioBase(ratio: string | null): string | null {
  if (!ratio) return null;
  if (ratio.startsWith("original")) return "original";
  const [a, b] = ratio.split(":").map(Number);
  return a >= b ? `${a}:${b}` : `${b}:${a}`;
}

/** Frame point (pixels, relative to center) → unrotated photo (pixels, relative to center). */
export function toSource(fx: number, fy: number, angleDeg: number): [number, number] {
  const t = (angleDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c * fx - s * fy, s * fx + c * fy];
}

const EPS = 1e-9;

/** True when the whole rect lies inside the rotated photo. */
export function insideRotated(r: CropRect, angle: number, W: number, H: number): boolean {
  for (const [u, v] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ]) {
    const [sx, sy] = toSource(u * W - W / 2, v * H - H / 2, angle);
    if (Math.abs(sx) > W / 2 + EPS * W || Math.abs(sy) > H / 2 + EPS * H) return false;
  }
  return r.w > 0 && r.h > 0;
}

/**
 * Shrinks the rect around its center (keeping its aspect) until it fits the
 * rotated photo: the "automatic cut of empty borders" when straightening.
 */
export function fitInside(r: CropRect, angle: number, W: number, H: number): CropRect {
  if (insideRotated(r, angle, W, H)) return r;
  const cx = (r.x + r.w / 2) * W - W / 2;
  const cy = (r.y + r.h / 2) * H - H / 2;
  // Corner offsets from the center; constraint |source(c + s·o)| ≤ W/2, H/2 is linear in s.
  let smax = 1;
  const [scx, scy] = toSource(cx, cy, angle);
  for (const [ox, oy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const [dx, dy] = toSource((ox * r.w * W) / 2, (oy * r.h * H) / 2, angle);
    for (const [base, delta, lim] of [
      [scx, dx, W / 2],
      [scy, dy, H / 2],
    ]) {
      if (delta > 0) smax = Math.min(smax, (lim - base) / delta);
      else if (delta < 0) smax = Math.min(smax, (-lim - base) / delta);
    }
  }
  const s = Math.max(0, smax) * (1 - 1e-9);
  const w = r.w * s;
  const h = r.h * s;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/**
 * Moves from a valid rect toward a proposed one as far as it stays inside
 * (bisection). Used while dragging handles or moving the rect.
 */
export function constrain(from: CropRect, to: CropRect, angle: number, W: number, H: number): CropRect {
  if (insideRotated(to, angle, W, H)) return to;
  const lerp = (t: number): CropRect => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    w: from.w + (to.w - from.w) * t,
    h: from.h + (to.h - from.h) * t,
  });
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (insideRotated(lerp(mid), angle, W, H)) lo = mid;
    else hi = mid;
  }
  return lerp(lo);
}

/** Largest rect with pixel aspect `aspect` centered on `r`'s center, fitted. */
export function withAspect(r: CropRect, aspect: number | null, angle: number, W: number, H: number): CropRect {
  if (aspect === null) return fitInside(r, angle, W, H);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // Start from the largest rect of that aspect inside the whole frame.
  let wPx = W;
  let hPx = W / aspect;
  if (hPx > H) {
    hPx = H;
    wPx = H * aspect;
  }
  const w = wPx / W;
  const h = hPx / H;
  const x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  const y = Math.min(Math.max(cy - h / 2, 0), 1 - h);
  return fitInside({ x, y, w, h }, angle, W, H);
}

/** Output size in pixels of the crop on a W×H image. */
export function cropSize(r: CropRect, W: number, H: number): [number, number] {
  return [Math.max(1, Math.round(r.w * W)), Math.max(1, Math.round(r.h * H))];
}

export function isNeutralCrop(r: CropRect, angle: number): boolean {
  return angle === 0 && r.x === 0 && r.y === 0 && r.w === 1 && r.h === 1;
}
