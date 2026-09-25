/**
 * Saved-view persistence. Framework-free (copied verbatim by ui-shadcn).
 */
import type { ViewDef } from "@ranjeetk25/schema-grid-core";
import type { WorkbenchViewStore } from "./types";

export const DEFAULT_VIEW_STORE_PREFIX = "schema-grid:views:";

export interface LocalStorageViewStoreOptions {
  /** Key prefix; the grid id is appended. Default "schema-grid:views:". */
  prefix?: string;
  /** Default `globalThis.localStorage`. */
  storage?: Pick<Storage, "getItem" | "setItem">;
}

function storageOf(options: LocalStorageViewStoreOptions): Pick<Storage, "getItem" | "setItem"> | null {
  if (options.storage) return options.storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Per-browser saved views (`localStorage["schema-grid:views:<gridId>"]`).
 * Every read and write is guarded: private windows and blocked storage keep
 * views in memory only.
 */
export function createLocalStorageViewStore(options: LocalStorageViewStoreOptions = {}): WorkbenchViewStore {
  const prefix = options.prefix ?? DEFAULT_VIEW_STORE_PREFIX;
  return {
    load(gridId) {
      try {
        const raw = storageOf(options)?.getItem(prefix + gridId);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return Array.isArray(parsed) && parsed.length > 0 ? (parsed as ViewDef[]) : null;
      } catch {
        return null;
      }
    },
    save(gridId, views) {
      try {
        storageOf(options)?.setItem(prefix + gridId, JSON.stringify(views));
      } catch {
        // Storage unavailable: views stay in memory.
      }
    },
  };
}

/** Views kept in memory only (tests, demos, or "don't persist"). */
export function createMemoryViewStore(initial: Record<string, ViewDef[]> = {}): WorkbenchViewStore & {
  snapshot(): Record<string, ViewDef[]>;
} {
  const data = new Map<string, ViewDef[]>(Object.entries(initial));
  return {
    load: (gridId) => data.get(gridId) ?? null,
    save: (gridId, views) => {
      data.set(gridId, views);
    },
    snapshot: () => Object.fromEntries(data),
  };
}

export const ALL_ROWS_VIEW: ViewDef = {
  id: "view_all",
  name: "All rows",
  filter: null,
  sort: [],
  columnState: [],
  groupBy: [],
  pageSize: 100,
};

/** Compares the parts of a view the "unsaved changes" dot cares about. */
export function comparableView(v: ViewDef | null | undefined): string {
  return v ? JSON.stringify({ f: v.filter, s: v.sort, q: v.search ?? "", g: v.groupBy }) : "";
}
