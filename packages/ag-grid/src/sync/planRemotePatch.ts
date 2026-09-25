/**
 * Pure planning for applying a `ChangeFeedEntry` (from polling or a push
 * channel) onto the local `RowStore`. Produces a plan; nothing here mutates
 * any store — that's `applyRemotePatch`'s (T28) job.
 *
 * Rules (plan T15):
 *  - a remote row whose `version` is not strictly newer than the local copy
 *    is our own echo and is ignored entirely.
 *  - a remote row with no local counterpart becomes an `add`, but only if it
 *    matches the current view; otherwise it is ignored (there is nothing
 *    sensible to show for a row we've never fetched and that isn't visible).
 *  - cells are compared per schema column (via `column.key`) using deep
 *    equality, so unchanged arrays/objects don't count as changed.
 *  - if any changed cell is the actively-edited cell or a pending
 *    (in-flight write) cell, the whole row is deferred instead of updated —
 *    applying it now would clobber local state; leaving the local version
 *    alone means the eventual write attempt surfaces a proper conflict. Only
 *    the conflicting cells are marked `remoteChanged` (for a flash/badge).
 *  - a row that changed but no longer matches the view is still included in
 *    `updates` (its data changed) and its id is also listed in
 *    `notInViewRowIds` so the caller can style it instead of removing it.
 *  - a deleted id is only reported in `removes` if it exists locally.
 */
import type { ChangeFeedEntry, GridRow, GridSchema } from "../internal/core";
import type { CellRef } from "../state/cellStatusStore";
import { cellKey } from "../state/cellStatusStore";
import type { RowStore } from "../state/rowStore";

export interface PlanRemotePatchOptions<Row extends GridRow> {
  entry: ChangeFeedEntry<Row>;
  rowStore: Pick<RowStore<Row>, "getRow">;
  schema: GridSchema;
  editingCell?: CellRef | null;
  pendingCells: ReadonlySet<string> | ((cell: CellRef) => boolean);
  matchesView(row: Row): boolean;
  currentSchemaVersion: number;
}

export interface RemotePatchPlan<Row extends GridRow> {
  /** Rows that changed remotely and can be applied as-is. */
  updates: Row[];
  /** Rows the local store has never seen, matching the current view. */
  adds: Row[];
  /** Ids to delete locally (were present locally, deleted remotely). */
  removes: string[];
  /** Cells whose value changed, for rows in `updates`. */
  changedCells: CellRef[];
  /** Cells whose value changed but were being edited/pending (row deferred). */
  remoteChangedCells: CellRef[];
  /**
   * Rows whose changes were withheld because a cell was being edited or
   * pending. Consumer contract: these are FULL remote rows (not deltas),
   * not yet applied to the local store (its version is untouched). Keep a
   * `Map<rowId, Row>` of them across polls — see `mergeDeferred`, which
   * keeps the higher `version` (last-write-wins) when the same row is
   * deferred again on a later poll. Once editing/pending clears for a row,
   * don't blindly apply the cached deferred row: the local copy may have
   * moved on in the meantime (e.g. the user's own edit committed), so
   * either re-run `planRemotePatch` for it or otherwise confirm its
   * `version` is still greater than the local copy's before applying it.
   */
  deferred: Row[];
  /** Ids of updated rows that no longer match the current view. */
  notInViewRowIds: string[];
  /** True when the feed reports a different schemaVersion than the caller's. */
  schemaChanged: boolean;
}

function isPendingCell(pendingCells: ReadonlySet<string> | ((cell: CellRef) => boolean), cell: CellRef): boolean {
  if (typeof pendingCells === "function") return pendingCells(cell);
  return pendingCells.has(cellKey(cell.rowId, cell.columnId));
}

function isEditingCell(editingCell: CellRef | null | undefined, cell: CellRef): boolean {
  return !!editingCell && editingCell.rowId === cell.rowId && editingCell.columnId === cell.columnId;
}

// Assumes cell values are plain JSON-shaped data (primitives, arrays,
// plain objects — e.g. LinkRef) with no cycles; that's the only shape cells
// take per §4, so a simple recursive structural walk is sufficient here.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export function planRemotePatch<Row extends GridRow>(options: PlanRemotePatchOptions<Row>): RemotePatchPlan<Row> {
  const { entry, rowStore, schema, editingCell, pendingCells, matchesView, currentSchemaVersion } = options;

  const updates: Row[] = [];
  const adds: Row[] = [];
  const changedCells: CellRef[] = [];
  const remoteChangedCells: CellRef[] = [];
  const deferred: Row[] = [];
  const notInViewRowIds: string[] = [];

  for (const remoteRow of entry.rows) {
    const localRow = rowStore.getRow(remoteRow.id);

    if (!localRow) {
      if (matchesView(remoteRow)) adds.push(remoteRow);
      continue;
    }

    if (remoteRow.version <= localRow.version) continue; // our own echo

    const rowChangedCells: CellRef[] = [];
    for (const column of schema.columns) {
      const prevValue = localRow.cells[column.key];
      const nextValue = remoteRow.cells[column.key];
      if (!deepEqual(prevValue, nextValue)) {
        rowChangedCells.push({ rowId: remoteRow.id, columnId: column.id });
      }
    }

    const conflictingCells = rowChangedCells.filter(
      (cell) => isEditingCell(editingCell, cell) || isPendingCell(pendingCells, cell),
    );

    if (conflictingCells.length > 0) {
      deferred.push(remoteRow);
      remoteChangedCells.push(...conflictingCells);
      continue;
    }

    updates.push(remoteRow);
    changedCells.push(...rowChangedCells);
    if (!matchesView(remoteRow)) notInViewRowIds.push(remoteRow.id);
  }

  const removes = entry.deletedRowIds.filter((id) => rowStore.getRow(id) !== undefined);

  return {
    updates,
    adds,
    removes,
    changedCells,
    remoteChangedCells,
    deferred,
    notInViewRowIds,
    schemaChanged: entry.schemaVersion !== currentSchemaVersion,
  };
}

/**
 * Pure helper implementing the `deferred` consumer contract: merge newly
 * deferred rows into a caller-held `Map<rowId, Row>`, keeping the higher
 * `version` per row (last-write-wins across polls). Does not mutate
 * `existing`; returns a new Map.
 */
export function mergeDeferred<Row extends GridRow>(
  existing: ReadonlyMap<string, Row>,
  incoming: readonly Row[],
): Map<string, Row> {
  const next = new Map(existing);
  for (const row of incoming) {
    const current = next.get(row.id);
    if (!current || row.version > current.version) {
      next.set(row.id, row);
    }
  }
  return next;
}
