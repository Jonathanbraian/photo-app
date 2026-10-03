import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fileUrl, type Photo } from "../lib/api";

const ITEM = 84;

interface Props {
  photos: Photo[];
  currentId: number | null;
  onSelect: (id: number) => void;
}

/** Horizontal, virtualized strip of thumbnails. */
export default function Filmstrip({ photos, currentId, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: photos.length,
    getScrollElement: () => ref.current,
    estimateSize: () => ITEM,
    overscan: 6,
    paddingStart: 8,
    paddingEnd: 8,
  });
  const index = photos.findIndex((p) => p.id === currentId);

  useEffect(() => {
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [index, virtualizer]);

  return (
    <div ref={ref} className="h-full overflow-x-auto overflow-y-hidden">
      <div className="relative h-full" style={{ width: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const photo = photos[item.index];
          const active = photo.id === currentId;
          return (
            <button
              key={photo.id}
              type="button"
              title={photo.fileName}
              onClick={() => onSelect(photo.id)}
              className={`absolute top-2 flex items-center justify-center overflow-hidden rounded bg-neutral-900 ${
                active ? "ring-2 ring-sky-400" : "opacity-70 hover:opacity-100"
              }`}
              style={{ left: item.start, width: ITEM - 8, height: ITEM - 8 }}
            >
              {photo.thumbPath ? (
                <img
                  src={fileUrl(photo.thumbPath)}
                  alt={photo.fileName}
                  draggable={false}
                  decoding="async"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="h-full w-full bg-neutral-800" />
              )}
              {photo.edited && (
                <span className="absolute top-0.5 right-0.5 text-[10px] text-amber-300">✎</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
