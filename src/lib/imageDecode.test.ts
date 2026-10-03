import { describe, expect, it } from "vitest";
import { checkJpeg, toBytes } from "./imageDecode";

describe("preview bytes", () => {
  it("accepts ArrayBuffer, typed arrays and number arrays", () => {
    const raw = [0xff, 0xd8, 0xff, 0xe0];
    expect([...toBytes(new Uint8Array(raw).buffer)]).toEqual(raw);
    expect([...toBytes(new Uint8Array(raw))]).toEqual(raw);
    expect([...toBytes(raw)]).toEqual(raw);
  });

  it("rejects other shapes with a clear message", () => {
    expect(() => toBytes("abc")).toThrow(/formato inesperado \(string\)/);
    expect(() => toBytes(null)).toThrow(/\(null\)/);
  });

  it("validates the JPEG header", () => {
    expect(() => checkJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).not.toThrow();
    expect(() => checkJpeg(new Uint8Array())).toThrow(/vazia \(0 bytes\)/);
    expect(() => checkJpeg(new TextEncoder().encode("255,216,255"))).toThrow(
      /não é um JPEG \(11 bytes, começa com 32 35 35 2C 32 31 36 2C; esperado FF D8 FF\)/,
    );
  });
});
