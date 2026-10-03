import { useEffect, useState } from "react";
import { getAppStatus, isTauri, type AppStatus } from "../lib/api";

/** Diagnóstico do motor Rust e do catálogo. */
export default function StatusCard() {
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
          <dt className="text-neutral-500">Catálogo</dt>
          <dd className="break-all font-mono text-xs select-text">{status.dbPath}</dd>
        </dl>
      )}
    </div>
  );
}
