/**
 * Pure helpers for write conflicts reported by `DataSource.applyChanges`.
 */
import type { CellChange, CellConflict, ConflictResolution } from "../internal/core";

export type { ConflictResolution } from "../internal/core";

/** Signature of `SchemaGridEvents.onConflict`. `resolve` may be called once; later calls are no-ops. */
export type ConflictHandler = (conflict: CellConflict, resolve: (resolution: ConflictResolution) => Promise<void>) => void;

/** Groups conflicts by rowId, preserving first-seen row order and in-row order. */
export function groupConflictsByRow(conflicts: readonly CellConflict[]): Map<string, CellConflict[]> {
  const out = new Map<string, CellConflict[]>();
  for (const c of conflicts) {
    const list = out.get(c.rowId);
    if (list) list.push(c);
    else out.set(c.rowId, [c]);
  }
  return out;
}

/** Rebases our original change on top of the server's value (used by "overwrite"). */
export function conflictToChange(conflict: CellConflict, ourChange: CellChange): CellChange {
  return {
    rowId: conflict.rowId,
    columnId: conflict.columnId,
    prev: conflict.serverValue,
    next: ourChange.next,
    ...(ourChange.meta ? { meta: ourChange.meta } : {}),
  };
}

/** Finds the change in `changes` that a conflict (or error) refers to (last match wins, mirroring optimistic apply order). */
export function findChangeForConflict(
  changes: readonly CellChange[],
  conflict: Pick<CellConflict, "rowId" | "columnId">,
): CellChange | undefined {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c && c.rowId === conflict.rowId && c.columnId === conflict.columnId) return c;
  }
  return undefined;
}
