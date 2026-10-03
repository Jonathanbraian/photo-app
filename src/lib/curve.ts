/** Tone curves: monotone piecewise cubic Hermite (PCHIP), docs/ADJUSTMENTS.md §7. */

export type Point = [number, number];

export const IDENTITY: Point[] = [
  [0, 0],
  [255, 255],
];

/** Sorted by x, clamped to 0…255, strictly increasing x (last duplicate wins). */
export function normalizePoints(points: readonly Point[]): Point[] {
  const clamped = points
    .map(([x, y]) => [Math.min(255, Math.max(0, x)), Math.min(255, Math.max(0, y))] as Point)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p[0] - b.p[0] || a.i - b.i)
    .map(({ p }) => p);
  const out: Point[] = [];
  for (const p of clamped) {
    if (out.length && out[out.length - 1][0] === p[0]) out[out.length - 1] = p;
    else out.push(p);
  }
  return out.length >= 2 ? out : IDENTITY.map((p) => [...p] as Point);
}

export function isIdentity(points: readonly Point[]): boolean {
  const n = normalizePoints(points);
  return n.length === 2 && n[0][0] === 0 && n[0][1] === 0 && n[1][0] === 255 && n[1][1] === 255;
}

/** Returns C(x) for x in 0…255 (result in 0…255). */
export function pchip(points: readonly Point[]): (x: number) => number {
  const p = normalizePoints(points);
  const n = p.length;
  const h: number[] = [];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    h.push(p[k + 1][0] - p[k][0]);
    d.push((p[k + 1][1] - p[k][1]) / h[k]);
  }
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) m[k] = 0;
    else {
      const w1 = 2 * h[k] + h[k - 1];
      const w2 = h[k] + 2 * h[k - 1];
      m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
    }
  }
  return (x: number) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let k = 0;
    while (k < n - 2 && x > p[k + 1][0]) k++;
    const t = (x - p[k][0]) / h[k];
    const t2 = t * t;
    const t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * p[k][1] +
      (t3 - 2 * t2 + t) * h[k] * m[k] +
      (-2 * t3 + 3 * t2) * p[k + 1][1] +
      (t3 - t2) * h[k] * m[k + 1];
    return Math.min(255, Math.max(0, y));
  };
}

export interface Curves {
  rgb: Point[];
  r: Point[];
  g: Point[];
  b: Point[];
}

export function curvesIdentity(c: Curves): boolean {
  return isIdentity(c.rgb) && isIdentity(c.r) && isIdentity(c.g) && isIdentity(c.b);
}

/** Per-channel functions on encoded values 0…1: e' = C_c(C_rgb(255e))/255. */
export function curveFunctions(c: Curves): [(e: number) => number, (e: number) => number, (e: number) => number] {
  const master = pchip(c.rgb);
  const chans = [pchip(c.r), pchip(c.g), pchip(c.b)];
  return chans.map((f) => (e: number) => f(master(255 * e)) / 255) as [
    (e: number) => number,
    (e: number) => number,
    (e: number) => number,
  ];
}

/** Table for the GPU: `size` samples per channel, RGBA float (alpha unused). */
export function curveTable(c: Curves, size = 1024): Float32Array {
  const fns = curveFunctions(c);
  const out = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const e = i / (size - 1);
    out[i * 4] = fns[0](e);
    out[i * 4 + 1] = fns[1](e);
    out[i * 4 + 2] = fns[2](e);
    out[i * 4 + 3] = 1;
  }
  return out;
}
