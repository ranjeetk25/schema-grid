/**
 * RowStore: the canonical, framework-free store of grid rows. Rows are kept
 * in insertion order, and a monotonic `revision` counter bumps on every
 * mutation so callers can cheaply detect "something changed" without deep
 * comparisons.
 *
 * `notInView` is a per-row flag (not part of cells/version) set by remote
 * patch application (T28) when a remotely updated row no longer matches the
 * current view's filter. Such rows stay visible (styled) instead of vanishing,
 * and the flag is cleared on the next refetch.
 */
import type { GridRow } from "../internal/core";

export interface UpsertOptions {
  /** Replace even when the incoming version is older than the stored one. */
  force?: boolean;
}

export interface RowStore<Row extends GridRow> {
  getRow(id: string): Row | undefined;
  getVersion(id: string): number | undefined;
  /**
   * Insert or replace rows by id. New ids are appended, keeping insertion order.
   * By default an incoming row whose `version` is LOWER than the stored one is
   * skipped (a late page / refetch must never roll back a newer local or
   * remote state); equal versions replace. `{ force: true }` replaces
   * unconditionally.
   */
  upsert(rows: readonly Row[], options?: UpsertOptions): void;
  /**
   * Merge `cells` into the row's existing cells, returning a new row object
   * (never mutating the previous one). Returns undefined if the row is
   * unknown. `version`, if given, replaces the row's version; otherwise the
   * previous version is kept.
   */
  patchCells(rowId: string, cells: Record<string, unknown>, version?: number): Row | undefined;
  remove(ids: readonly string[]): void;
  all(): Row[];
  getRevision(): number;
  subscribe(listener: () => void): () => void;

  setNotInView(ids: readonly string[], flag: boolean): void;
  isNotInView(id: string): boolean;
  clearNotInView(): void;
}

export function createRowStore<Row extends GridRow>(): RowStore<Row> {
  const rowsById = new Map<string, Row>();
  const order: string[] = [];
  const notInView = new Set<string>();
  const listeners = new Set<() => void>();
  let revision = 0;

  const bump = (): void => {
    revision++;
    for (const listener of listeners) listener();
  };

  const getRow = (id: string): Row | undefined => rowsById.get(id);

  const getVersion = (id: string): number | undefined => rowsById.get(id)?.version;

  const upsert = (rows: readonly Row[], options?: UpsertOptions): void => {
    if (rows.length === 0) return;
    let changed = false;
    for (const r of rows) {
      const prev = rowsById.get(r.id);
      if (prev && !options?.force && r.version < prev.version) continue;
      if (!prev) order.push(r.id);
      rowsById.set(r.id, r);
      changed = true;
    }
    if (changed) bump();
  };

  const patchCells = (rowId: string, cells: Record<string, unknown>, version?: number): Row | undefined => {
    const prev = rowsById.get(rowId);
    if (!prev) return undefined;
    const next: Row = {
      ...prev,
      version: version ?? prev.version,
      cells: { ...prev.cells, ...cells },
    };
    rowsById.set(rowId, next);
    bump();
    return next;
  };

  const remove = (ids: readonly string[]): void => {
    if (ids.length === 0) return;
    let removedAny = false;
    for (const id of ids) {
      if (rowsById.delete(id)) {
        removedAny = true;
        notInView.delete(id);
        const idx = order.indexOf(id);
        if (idx !== -1) order.splice(idx, 1);
      }
    }
    if (removedAny) bump();
  };

  const all = (): Row[] => order.map((id) => rowsById.get(id)).filter((r): r is Row => r !== undefined);

  const getRevision = (): number => revision;

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const setNotInView = (ids: readonly string[], flag: boolean): void => {
    if (ids.length === 0) return;
    for (const id of ids) {
      if (flag) notInView.add(id);
      else notInView.delete(id);
    }
    bump();
  };

  const isNotInView = (id: string): boolean => notInView.has(id);

  const clearNotInView = (): void => {
    if (notInView.size === 0) return;
    notInView.clear();
    bump();
  };

  return {
    getRow,
    getVersion,
    upsert,
    patchCells,
    remove,
    all,
    getRevision,
    subscribe,
    setNotInView,
    isNotInView,
    clearNotInView,
  };
}
