import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fileUrl, type Photo } from "../lib/api";

const GAP = 8;
const PADDING = 16;

interface Props {
  photos: Photo[];
  cellSize: number;
  selected: Set<number>;
  onCellClick: (index: number, e: MouseEvent) => void;
  onBackgroundClick: () => void;
}

/** Virtualized thumbnail grid: only the visible rows are in the DOM. */
export default function PhotoGrid({ photos, cellSize, selected, onCellClick, onBackgroundClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // `cellSize` is the target; cells grow slightly so the row fills the width.
  const inner = Math.max(0, width - 2 * PADDING);
  const columns = Math.max(1, Math.floor((inner + GAP) / (cellSize + GAP)));
  const size = Math.max(48, Math.floor((inner - (columns - 1) * GAP) / columns));
  const rowCount = Math.ceil(photos.length / columns);
  const rowHeight = size + GAP;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    paddingStart: PADDING,
    paddingEnd: PADDING,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, columns, virtualizer]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackgroundClick();
      }}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onBackgroundClick();
        }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * columns;
          return (
            <div
              key={row.key}
              className="absolute left-0 flex"
              style={{ top: row.start, gap: GAP, paddingLeft: PADDING, height: size }}
            >
              {photos.slice(start, start + columns).map((photo, i) => (
                <Cell
                  key={photo.id}
                  photo={photo}
                  size={size}
                  selected={selected.has(photo.id)}
                  onClick={(e) => onCellClick(start + i, e)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Cell(props: {
  photo: Photo;
  size: number;
  selected: boolean;
  onClick: (e: MouseEvent) => void;
}) {
  const { photo, size, selected } = props;
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={photo.cacheError ? `${photo.fileName}\n${photo.cacheError}` : undefined}
      className={`group relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-900 outline-none ${
        selected
          ? "ring-2 ring-sky-400 ring-offset-2 ring-offset-neutral-950"
          : "hover:bg-neutral-800"
      }`}
      style={{ width: size, height: size }}
    >
      {photo.cacheStatus === "ready" && photo.thumbPath ? (
        <img
          src={fileUrl(photo.thumbPath)}
          alt={photo.fileName}
          draggable={false}
          decoding="async"
          className="max-h-full max-w-full object-contain"
        />
      ) : photo.cacheStatus === "error" ? (
        <span className="px-2 text-center text-xs text-red-400">
          ⚠<br />
          {photo.fileName}
        </span>
      ) : (
        <span className="h-full w-full animate-pulse bg-neutral-800/60" />
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-left text-[11px] text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100">
        {photo.fileName}
      </span>
    </button>
  );
}
