/**
 * Per-cell UI status: pending writes, write errors and remote-changed flash
 * flags. Keyed by `cellKey(rowId, columnId)` so the grid can subscribe to a
 * minimal set of changed keys and call `refreshCells` only for those.
 */

export interface CellRef {
  rowId: string;
  columnId: string;
}

export interface CellStatus {
  pending: boolean;
  error?: string;
  remoteChanged: boolean;
}

export interface ClearPendingOptions {
  /**
   * When true, this call represents a successful write completing: any
   * existing error on the cell is cleared alongside `pending`.
   */
  success?: boolean;
}

export interface CellStatusStore {
  setPending(cells: CellRef[]): void;
  clearPending(cells: CellRef[], options?: ClearPendingOptions): void;
  setError(cell: CellRef, message: string): void;
  /** Sets several errors with ONE change notification. */
  setErrors(entries: { cell: CellRef; message: string }[]): void;
  clearError(cell: CellRef): void;
  markRemoteChanged(cell: CellRef): void;
  clearRemoteChanged(cell: CellRef): void;
  get(rowId: string, columnId: string): CellStatus;
  subscribeChanges(listener: (changedKeys: string[]) => void): () => void;
  clearAll(): void;
  version(): number;
}

const SEP = "\u0000";

export function cellKey(rowId: string, columnId: string): string {
  return `${rowId}${SEP}${columnId}`;
}

export function parseCellKey(key: string): CellRef {
  const idx = key.indexOf(SEP);
  if (idx === -1) {
    return { rowId: key, columnId: "" };
  }
  return { rowId: key.slice(0, idx), columnId: key.slice(idx + SEP.length) };
}

const DEFAULT_STATUS: CellStatus = { pending: false, remoteChanged: false };

export function createCellStatusStore(): CellStatusStore {
  const statuses = new Map<string, CellStatus>();
  const listeners = new Set<(changedKeys: string[]) => void>();
  let rev = 0;

  const notify = (changedKeys: Set<string>): void => {
    if (changedKeys.size === 0) return;
    rev += 1;
    const keys = Array.from(changedKeys);
    for (const listener of listeners) listener(keys);
  };

  const statusesEqual = (a: CellStatus, b: CellStatus): boolean =>
    a.pending === b.pending && a.error === b.error && a.remoteChanged === b.remoteChanged;

  const setStatus = (key: string, next: CellStatus, changed: Set<string>): void => {
    const prev = statuses.get(key) ?? DEFAULT_STATUS;
    if (statusesEqual(prev, next)) return;
    if (next.pending === false && next.error === undefined && next.remoteChanged === false) {
      statuses.delete(key);
    } else {
      statuses.set(key, next);
    }
    changed.add(key);
  };

  const setPending = (cells: CellRef[]): void => {
    const changed = new Set<string>();
    for (const cell of cells) {
      const key = cellKey(cell.rowId, cell.columnId);
      const prev = statuses.get(key) ?? DEFAULT_STATUS;
      setStatus(key, { ...prev, pending: true }, changed);
    }
    notify(changed);
  };

  const clearPending = (cells: CellRef[], options?: ClearPendingOptions): void => {
    const changed = new Set<string>();
    for (const cell of cells) {
      const key = cellKey(cell.rowId, cell.columnId);
      const prev = statuses.get(key) ?? DEFAULT_STATUS;
      const next: CellStatus = {
        pending: false,
        error: options?.success ? undefined : prev.error,
        remoteChanged: prev.remoteChanged,
      };
      setStatus(key, next, changed);
    }
    notify(changed);
  };

  const setError = (cell: CellRef, message: string): void => {
    const changed = new Set<string>();
    const key = cellKey(cell.rowId, cell.columnId);
    const prev = statuses.get(key) ?? DEFAULT_STATUS;
    setStatus(key, { ...prev, error: message }, changed);
    notify(changed);
  };

  const setErrors = (entries: { cell: CellRef; message: string }[]): void => {
    const changed = new Set<string>();
    for (const { cell, message } of entries) {
      const key = cellKey(cell.rowId, cell.columnId);
      const prev = statuses.get(key) ?? DEFAULT_STATUS;
      setStatus(key, { ...prev, error: message }, changed);
    }
    notify(changed);
  };

  const clearError = (cell: CellRef): void => {
    const changed = new Set<string>();
    const key = cellKey(cell.rowId, cell.columnId);
    const prev = statuses.get(key) ?? DEFAULT_STATUS;
    setStatus(key, { ...prev, error: undefined }, changed);
    notify(changed);
  };

  const markRemoteChanged = (cell: CellRef): void => {
    const changed = new Set<string>();
    const key = cellKey(cell.rowId, cell.columnId);
    const prev = statuses.get(key) ?? DEFAULT_STATUS;
    setStatus(key, { ...prev, remoteChanged: true }, changed);
    notify(changed);
  };

  const clearRemoteChanged = (cell: CellRef): void => {
    const changed = new Set<string>();
    const key = cellKey(cell.rowId, cell.columnId);
    const prev = statuses.get(key) ?? DEFAULT_STATUS;
    setStatus(key, { ...prev, remoteChanged: false }, changed);
    notify(changed);
  };

  const get = (rowId: string, columnId: string): CellStatus => {
    return statuses.get(cellKey(rowId, columnId)) ?? DEFAULT_STATUS;
  };

  const subscribeChanges = (listener: (changedKeys: string[]) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const clearAll = (): void => {
    const changed = new Set<string>(statuses.keys());
    statuses.clear();
    notify(changed);
  };

  const version = (): number => rev;

  return {
    setPending,
    clearPending,
    setError,
    setErrors,
    clearError,
    markRemoteChanged,
    clearRemoteChanged,
    get,
    subscribeChanges,
    clearAll,
    version,
  };
}
