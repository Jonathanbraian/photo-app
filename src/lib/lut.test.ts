import { describe, expect, it } from "vitest";
import { applyLut, parseCube, sampleLut } from "./lut";

export function identityCube(n: number): string {
  const lines = [`TITLE "id"`, `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) lines.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`);
  return lines.join("\n");
}

describe(".cube LUTs", () => {
  it("parses 3D with red varying fastest", () => {
    const lut = parseCube(identityCube(3));
    expect(lut.kind).toBe("3d");
    expect(lut.size).toBe(3);
    expect(lut.title).toBe("id");
    expect([...lut.data.slice(3, 6)]).toEqual([0.5, 0, 0]);
  });

  it("identity 3D LUT is exact everywhere (trilinear)", () => {
    const lut = parseCube(identityCube(5));
    for (const e of [[0, 0, 0], [1, 1, 1], [0.13, 0.77, 0.5], [0.999, 0.001, 0.62]] as [number, number, number][]) {
      sampleLut(lut, e).forEach((v, i) => expect(v).toBeCloseTo(e[i], 6));
    }
  });

  it("parses 1D with comments and DOMAIN, interpolating per channel", () => {
    const lut = parseCube(`# comment\nLUT_1D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n1 0 0\n0 1 1\n`);
    expect(lut.kind).toBe("1d");
    // e = 1 → u = 0.5 → halfway between rows.
    expect(sampleLut(lut, [1, 1, 1])).toEqual([0.5, 0.5, 0.5]);
    expect(sampleLut(lut, [0, 0, 0])).toEqual([1, 0, 0]);
  });

  it("intensity blends toward the original", () => {
    const invert = parseCube("LUT_1D_SIZE 2\n1 1 1\n0 0 0");
    expect(applyLut(invert, [0.2, 0.2, 0.2], 0)).toEqual([0.2, 0.2, 0.2]);
    applyLut(invert, [0.2, 0.2, 0.2], 1).forEach((v) => expect(v).toBeCloseTo(0.8, 6));
    applyLut(invert, [0.2, 0.2, 0.2], 0.5).forEach((v) => expect(v).toBeCloseTo(0.5, 6));
  });

  it("rejects malformed files with useful messages", () => {
    expect(() => parseCube("0 0 0")).toThrow(/LUT_1D_SIZE nem LUT_3D_SIZE/);
    expect(() => parseCube("LUT_3D_SIZE 66")).toThrow(/3D vai de 2 a 65/);
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0")).toThrow(/Esperadas 8 linhas de dados, encontradas 1/);
    expect(() => parseCube("LUT_1D_SIZE 2\n0 0\n1 1 1")).toThrow(/Linha 2: esperado "r g b"/);
  });
});
