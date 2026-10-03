/** `.cube` LUTs (1D and 3D, up to 65³), docs/ADJUSTMENTS.md §11. */

export interface Lut {
  kind: "1d" | "3d";
  size: number;
  title: string;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** RGB triples: n entries (1D) or n³ entries, red fastest (3D). */
  data: Float32Array;
}

export const MAX_LUT_SIZE = 65;
export const MAX_LUT_1D_SIZE = 4096;

export function parseCube(text: string): Lut {
  let kind: Lut["kind"] | null = null;
  let size = 0;
  let title = "";
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].replace(/#.*/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    const nums = () => parts.slice(1).map(Number);
    if (key === "TITLE") {
      title = line.slice(5).trim().replace(/^"|"$/g, "");
    } else if (key === "LUT_1D_SIZE" || key === "LUT_3D_SIZE") {
      if (kind) throw new Error(`Linha ${ln + 1}: o arquivo declara o tamanho duas vezes.`);
      kind = key === "LUT_1D_SIZE" ? "1d" : "3d";
      size = Number(parts[1]);
      if (!Number.isInteger(size) || size < 2 || size > (kind === "3d" ? MAX_LUT_SIZE : MAX_LUT_1D_SIZE)) {
        throw new Error(
          `Linha ${ln + 1}: tamanho ${parts[1]} inválido (${kind === "3d" ? `3D vai de 2 a ${MAX_LUT_SIZE}` : `1D vai de 2 a ${MAX_LUT_1D_SIZE}`}).`,
        );
      }
    } else if (key === "DOMAIN_MIN" || key === "DOMAIN_MAX") {
      const v = nums();
      if (v.length !== 3 || v.some((x) => !Number.isFinite(x))) throw new Error(`Linha ${ln + 1}: ${key} inválido.`);
      if (key === "DOMAIN_MIN") domainMin = v as [number, number, number];
      else domainMax = v as [number, number, number];
    } else if (/^[A-Z_]+$/.test(key)) {
      // Other keywords (LUT_3D_INPUT_RANGE etc.) are ignored.
    } else {
      const v = parts.map(Number);
      if (v.length !== 3 || v.some((x) => !Number.isFinite(x))) {
        throw new Error(`Linha ${ln + 1}: esperado "r g b", encontrado "${line.slice(0, 40)}".`);
      }
      values.push(v[0], v[1], v[2]);
    }
  }
  if (!kind) throw new Error("O arquivo não declara LUT_1D_SIZE nem LUT_3D_SIZE.");
  const expected = kind === "3d" ? size ** 3 : size;
  if (values.length / 3 !== expected) {
    throw new Error(`Esperadas ${expected} linhas de dados, encontradas ${values.length / 3}.`);
  }
  for (let c = 0; c < 3; c++) {
    if (!(domainMax[c] > domainMin[c])) throw new Error("DOMAIN_MAX deve ser maior que DOMAIN_MIN.");
  }
  return { kind, size, title, domainMin, domainMax, data: Float32Array.from(values) };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** LUT(e) for an encoded sRGB triple in 0…1. */
export function sampleLut(lut: Lut, e: [number, number, number]): [number, number, number] {
  const n = lut.size;
  const u = e.map((v, c) => clamp01((v - lut.domainMin[c]) / (lut.domainMax[c] - lut.domainMin[c])));
  const axis = (x: number) => {
    const p = x * (n - 1);
    const i0 = Math.min(Math.floor(p), n - 2);
    return [i0, p - i0] as const;
  };
  const d = lut.data;
  if (lut.kind === "1d") {
    return [0, 1, 2].map((c) => {
      const [i, f] = axis(u[c]);
      return d[i * 3 + c] * (1 - f) + d[(i + 1) * 3 + c] * f;
    }) as [number, number, number];
  }
  const [ri, rf] = axis(u[0]);
  const [gi, gf] = axis(u[1]);
  const [bi, bf] = axis(u[2]);
  const out: [number, number, number] = [0, 0, 0];
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? rf : 1 - rf) * (dy ? gf : 1 - gf) * (dz ? bf : 1 - bf);
        const idx = (ri + dx + n * (gi + dy) + n * n * (bi + dz)) * 3;
        out[0] += w * d[idx];
        out[1] += w * d[idx + 1];
        out[2] += w * d[idx + 2];
      }
  return out;
}

/** e + intensity·(LUT(e) − e), clamped. */
export function applyLut(lut: Lut, e: [number, number, number], intensity: number): [number, number, number] {
  const y = sampleLut(lut, e);
  return [0, 1, 2].map((c) => clamp01(e[c] + intensity * (y[c] - e[c]))) as [number, number, number];
}
