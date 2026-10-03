import { describe, expect, it } from "vitest";
import { clickSelect, emptySelection, selectAll } from "./selection";

const ids = [10, 11, 12, 13, 14];

describe("selection", () => {
  it("click, shift-range and toggle", () => {
    let s = clickSelect(emptySelection, ids, 1, { shift: false, toggle: false });
    expect([...s.ids]).toEqual([11]);
    s = clickSelect(s, ids, 3, { shift: true, toggle: false });
    expect([...s.ids].sort()).toEqual([11, 12, 13]);
    s = clickSelect(s, ids, 2, { shift: false, toggle: true });
    expect([...s.ids].sort()).toEqual([11, 13]);
  });

  it("select all", () => {
    expect(selectAll(ids).ids.size).toBe(5);
  });
});
