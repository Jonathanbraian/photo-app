/** 256-bin histograms of an 8-bit RGBA buffer (see docs/ADJUSTMENTS.md). */
export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  l: Uint32Array;
}

export function computeHistogram(rgba: Uint8Array | Uint8ClampedArray): Histogram {
  const h: Histogram = {
    r: new Uint32Array(256),
    g: new Uint32Array(256),
    b: new Uint32Array(256),
    l: new Uint32Array(256),
  };
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    h.r[r]++;
    h.g[g]++;
    h.b[b]++;
    h.l[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
  }
  return h;
}
