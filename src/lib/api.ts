import { invoke, isTauri } from "@tauri-apps/api/core";

/** Mirrors `commands::system::AppStatus` in Rust. */
export interface AppStatus {
  appVersion: string;
  dbPath: string;
  sqliteVersion: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  tables: string[];
}

export { isTauri };

export function getAppStatus(): Promise<AppStatus> {
  return invoke<AppStatus>("app_status");
}
