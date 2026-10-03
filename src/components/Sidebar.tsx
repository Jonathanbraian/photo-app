import type { Folder } from "../lib/api";

interface Props {
  folders: Folder[];
  totalPhotos: number;
  selectedFolder: number | null;
  onSelectFolder: (id: number | null) => void;
}

export default function Sidebar({ folders, totalPhotos, selectedFolder, onSelectFolder }: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-800 text-sm">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Pastas
        </h2>
        <ul className="space-y-0.5">
          <FolderItem
            label="Todas as fotos"
            count={totalPhotos}
            active={selectedFolder === null}
            onClick={() => onSelectFolder(null)}
          />
          {folders.map((f) => (
            <FolderItem
              key={f.id}
              label={f.name}
              title={f.path}
              count={f.photoCount}
              active={selectedFolder === f.id}
              onClick={() => onSelectFolder(f.id)}
            />
          ))}
        </ul>
        {folders.length === 0 && (
          <p className="mt-2 px-2 text-neutral-500">Nenhuma pasta importada.</p>
        )}

        <h2 className="mt-6 mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Presets
        </h2>
        <p className="px-2 text-neutral-500">Nenhum preset.</p>
      </div>
    </aside>
  );
}

function FolderItem(props: {
  label: string;
  title?: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={props.onClick}
        title={props.title}
        className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left ${
          props.active ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-900"
        }`}
      >
        <span className="truncate">{props.label}</span>
        <span className="text-xs tabular-nums text-neutral-500">{props.count}</span>
      </button>
    </li>
  );
}
