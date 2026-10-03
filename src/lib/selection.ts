/** Multi-selection rules for the photo grid (click, Shift, Ctrl/Cmd). */

export interface Selection {
  ids: Set<number>;
  /** Index of the last plain or Ctrl/Cmd click, the start of Shift ranges. */
  anchor: number | null;
}

export const emptySelection: Selection = { ids: new Set(), anchor: null };

export interface ClickModifiers {
  shift: boolean;
  /** Ctrl on Windows, Cmd on Mac. */
  toggle: boolean;
}

export function clickSelect(
  sel: Selection,
  ids: readonly number[],
  index: number,
  mods: ClickModifiers,
): Selection {
  const id = ids[index];
  if (mods.shift && sel.anchor !== null) {
    const [from, to] = sel.anchor < index ? [sel.anchor, index] : [index, sel.anchor];
    const range = ids.slice(from, to + 1);
    const next = mods.toggle ? new Set(sel.ids) : new Set<number>();
    range.forEach((r) => next.add(r));
    return { ids: next, anchor: sel.anchor };
  }
  if (mods.toggle) {
    const next = new Set(sel.ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { ids: next, anchor: index };
  }
  return { ids: new Set([id]), anchor: index };
}

export function selectAll(ids: readonly number[]): Selection {
  return { ids: new Set(ids), anchor: ids.length ? 0 : null };
}

/** Drops ids that are no longer visible (e.g. after changing folder). */
export function retain(sel: Selection, ids: readonly number[]): Selection {
  const visible = new Set(ids);
  const next = new Set([...sel.ids].filter((id) => visible.has(id)));
  return next.size === sel.ids.size ? sel : { ids: next, anchor: null };
}
