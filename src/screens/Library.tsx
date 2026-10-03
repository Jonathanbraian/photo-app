import { useEffect, useState } from "react";
import { getAppStatus, isTauri, type AppStatus } from "../lib/api";

/** Biblioteca. Na etapa 1 mostra apenas o estado do motor Rust e do catálogo. */
export default function Library() {
  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 border-r border-neutral-800 p-4 text-sm text-neutral-500">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Pastas
        </h2>
        <p>Nenhuma pasta importada.</p>
        <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Presets
        </h2>
        <p>Nenhum preset.</p>
      </aside>
      <section className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-lg space-y-6 text-center">
          <div>
            <p className="text-lg text-neutral-300">Importe uma pasta para começar</p>
            <p className="mt-1 text-sm text-neutral-500">A importação chega na etapa 2.</p>
          </div>
          <StatusCard />
        </div>
      </section>
    </div>
  );
}

function StatusCard() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setError("Rodando no navegador: abra pelo app (npm run tauri dev) para conectar ao Rust.");
      return;
    }
    getAppStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const upToDate = status && status.schemaVersion === status.latestSchemaVersion;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-left text-sm">
      <h3 className="mb-3 flex items-center gap-2 font-medium text-neutral-200">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            error ? "bg-red-500" : upToDate ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
        Diagnóstico
      </h3>
      {error && <p className="text-red-400">{error}</p>}
      {!error && !status && <p className="text-neutral-500">Conectando ao motor…</p>}
      {status && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-neutral-500">Versão do app</dt>
          <dd>{status.appVersion}</dd>
          <dt className="text-neutral-500">SQLite</dt>
          <dd>{status.sqliteVersion}</dd>
          <dt className="text-neutral-500">Esquema</dt>
          <dd>
            v{status.schemaVersion} de v{status.latestSchemaVersion}
          </dd>
          <dt className="text-neutral-500">Tabelas</dt>
          <dd>{status.tables.join(", ")}</dd>
          <dt className="text-neutral-500">Catálogo</dt>
          <dd className="break-all font-mono text-xs select-text">{status.dbPath}</dd>
        </dl>
      )}
    </div>
  );
}
