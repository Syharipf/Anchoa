// The only module that talks to the Rust backend.
import { invoke } from "@tauri-apps/api/core";

export interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  parentId: string | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
}

export interface ItemSummary {
  id: string;
  type: string;
  title: string;
  dueAt: number | null;
  lastActivityAt: number;
}

/** Omitted fields stay unchanged; `dueAt: null` clears the due date. */
export interface ItemPatch {
  title?: string;
  body?: string;
  dueAt?: number | null;
}

/** A row of the dashboard "Hari ini" list. */
export interface DayTask {
  id: string;
  title: string;
  dueAt: number;
  completedAt: number | null;
  overdue: boolean;
}

export interface Dashboard {
  today: DayTask[];
  recent: ItemSummary[];
  inboxCount: number;
}

export interface DbStatus {
  path: string;
  error: string | null;
  backupError: string | null;
}

export interface DataPaths {
  dataDir: string;
  backupDir: string;
  logDir: string;
}

export type FolderKind = "data" | "backup" | "log";

export const api = {
  dbStatus: () => invoke<DbStatus>("db_status"),
  openFolder: (kind: FolderKind) => invoke<void>("open_folder", { kind }),
  captureNote: (text: string) => invoke<Item>("capture_note", { text }),
  openItem: (id: string) => invoke<Item>("open_item", { id }),
  updateItem: (id: string, patch: ItemPatch) => invoke<Item>("update_item", { id, patch }),
  completeItem: (id: string, done: boolean) => invoke<Item>("complete_item", { id, done }),
  deleteItem: (id: string) => invoke<void>("delete_item", { id }),
  listInbox: () => invoke<ItemSummary[]>("list_inbox"),
  getDashboard: () => invoke<Dashboard>("get_dashboard"),
  backupNow: () => invoke<string>("backup_now"),
  dataPaths: () => invoke<DataPaths>("data_paths"),
};

/** Backend errors arrive as `{ code, message }`. */
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
