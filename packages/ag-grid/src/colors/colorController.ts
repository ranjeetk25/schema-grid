/**
 * v0.4 manual cell colors: the framework-free paint controller behind
 * `SchemaGridHandle.setCellColor` (and color undo / redo).
 *
 * `apply(changes, source)`:
 *   1. drops what the client already knows it can't paint: unknown rows or
 *      columns and cells failing `canColor` (`canColorCell`). They are
 *      reported in the result's `rejected` (message "Read-only" /
 *      "Row not found" / "Column not found") and counted in `skipped`.
 *   2. applies the rest optimistically: the row store gets the rows with
 *      their new `colors` (same version: colors never bump it), and the
 *      cells are marked pending (`isPending`) so fetched / polled rows don't
 *      clobber them meanwhile (see `keepPendingColors`).
 *   3. sends ONE `setCellColors` batch. Batches go out in order (one queue),
 *      so the last paint of a cell is also the last write the server sees.
 *   4. rolls back (to the color before the paint) every cell the server
 *      rejected, or every cell when the call throws (the error is rethrown).
 *      A cell painted again meanwhile keeps the newer local color.
 *   5. `result.rows`, when sent, are handed to `upsertRows` (server truth).
 *   6. `onApplied` receives the applied cells with their previous color —
 *      `useSchemaGrid` records ONE undo entry per paint from it (sources
 *      "undo" / "redo" are not recorded again).
 *
 * `apply` resolves `null` when the data source has no `setCellColors`.
 */
import type { CellColor, CellColorChange, CellColorResult, ColumnDef, GridRow, GridSchema } from "../internal/core";
import { cellKey } from "../state/cellStatusStore";
import type { RowStore } from "../state/rowStore";
import type { ColorUndoChange } from "../undo/undoStack";

export type ColorSource = "paint" | "undo" | "redo";

export interface ColorApplyOutcome {
  /** `rejected` = cells skipped client-side followed by the server's rejections. */
  result: CellColorResult;
  /** How many of `rejected` were skipped client-side (never sent). */
  skipped: number;
}

export interface ColorControllerOptions<Row extends GridRow = GridRow> {
  /** The current source's `setCellColors` (read at call time), or undefined when it has none. */
  getSetCellColors(): ((batch: { id: string; changes: CellColorChange[] }) => Promise<CellColorResult>) | undefined;
  rowStore: RowStore<Row>;
  getSchema(): GridSchema;
  /** `canColorCell` for the current user (read at call time, so undo / redo re-check). */
  canColor(row: Row, column: ColumnDef): boolean;
  /** Receives `CellColorResult.rows` (after the pending marks are cleared). */
  upsertRows?(rows: Row[]): void;
  /** After a batch: the applied cells with their color before it. */
  onApplied?(info: { applied: ColorUndoChange[]; source: ColorSource }): void;
}

export interface ColorController {
  apply(changes: readonly CellColorChange[], source?: ColorSource): Promise<ColorApplyOutcome | null>;
  /** True while a paint of this cell is in flight. */
  isPending(rowId: string, columnId: string): boolean;
}

export const COLOR_READ_ONLY_MESSAGE = "Read-only";

/** The row's manual color for a column, or null. */
export function manualColorOf(row: GridRow | undefined, columnId: string): CellColor | null {
  const colors = row?.colors;
  if (!colors || !Object.hasOwn(colors, columnId)) return null;
  return colors[columnId] ?? null;
}

/** `row` with the given manual colors patched in (`null` clears); no `colors` key when none remain. */
export function withManualColors<Row extends GridRow>(row: Row, patch: Record<string, CellColor | null>): Row {
  const colors: Record<string, CellColor> = { ...(row.colors ?? {}) };
  for (const [columnId, color] of Object.entries(patch)) {
    if (color === null) delete colors[columnId];
    else colors[columnId] = color;
  }
  const { colors: _previous, ...rest } = row;
  return (Object.keys(colors).length > 0 ? { ...rest, colors } : rest) as Row;
}

/**
 * An incoming (fetched / polled) row with the LOCAL colors kept for cells
 * whose paint is still in flight. Returns `incoming` itself when none are.
 */
export function keepPendingColors<Row extends GridRow>(
  incoming: Row,
  local: Row | undefined,
  columnIds: readonly string[],
  isPending: (rowId: string, columnId: string) => boolean,
): Row {
  if (!local) return incoming;
  let patch: Record<string, CellColor | null> | undefined;
  for (const columnId of columnIds) {
    if (!isPending(incoming.id, columnId)) continue;
    const mine = manualColorOf(local, columnId);
    if (mine === manualColorOf(incoming, columnId)) continue;
    patch ??= {};
    patch[columnId] = mine;
  }
  return patch ? withManualColors(incoming, patch) : incoming;
}

let batchCounter = 0;

export function createColorController<Row extends GridRow = GridRow>(opts: ColorControllerOptions<Row>): ColorController {
  const pending = new Map<string, number>();
  let tail: Promise<unknown> = Promise.resolve();

  const mark = (cells: readonly CellColorChange[], delta: 1 | -1): void => {
    for (const c of cells) {
      const key = cellKey(c.rowId, c.columnId);
      const n = (pending.get(key) ?? 0) + delta;
      if (n > 0) pending.set(key, n);
      else pending.delete(key);
    }
  };

  /** Writes colors into the row store (one upsert, rows grouped). */
  const writeLocal = (cells: readonly CellColorChange[]): void => {
    const byRow = new Map<string, Record<string, CellColor | null>>();
    for (const c of cells) {
      const patch = byRow.get(c.rowId) ?? {};
      patch[c.columnId] = c.color;
      byRow.set(c.rowId, patch);
    }
    const rows: Row[] = [];
    for (const [rowId, patch] of byRow) {
      const row = opts.rowStore.getRow(rowId);
      if (row) rows.push(withManualColors(row, patch));
    }
    // Same version: colors never bump it; force keeps an older copy from being skipped.
    if (rows.length > 0) opts.rowStore.upsert(rows, { force: true });
  };

  /** Restores `prev` on cells still showing the color this batch painted. */
  const rollback = (cells: readonly ColorUndoChange[]): void => {
    const stillOurs = cells.filter((c) => manualColorOf(opts.rowStore.getRow(c.rowId), c.columnId) === c.next);
    writeLocal(stillOurs.map((c) => ({ rowId: c.rowId, columnId: c.columnId, color: c.prev })));
  };

  const apply = async (changes: readonly CellColorChange[], source: ColorSource = "paint"): Promise<ColorApplyOutcome | null> => {
    const send = opts.getSetCellColors();
    if (!send) return null;
    const schema = opts.getSchema();
    const byId = new Map(schema.columns.map((c) => [c.id, c]));

    // Last change per cell wins.
    const unique = new Map<string, CellColorChange>();
    for (const c of changes) unique.set(cellKey(c.rowId, c.columnId), c);

    const rejected: CellColorResult["rejected"] = [];
    const planned: ColorUndoChange[] = [];
    for (const c of unique.values()) {
      const row = opts.rowStore.getRow(c.rowId);
      const column = byId.get(c.columnId);
      const skip = (message: string) => rejected.push({ rowId: c.rowId, columnId: c.columnId, message });
      if (!row) skip("Row not found");
      else if (!column) skip("Column not found");
      else if (!opts.canColor(row, column)) skip(COLOR_READ_ONLY_MESSAGE);
      else planned.push({ rowId: c.rowId, columnId: c.columnId, prev: manualColorOf(row, c.columnId), next: c.color });
    }
    const skipped = rejected.length;
    if (planned.length === 0) return { result: { applied: [], rejected }, skipped };

    const batch = {
      id: `sg-colors-${Date.now().toString(36)}-${++batchCounter}`,
      changes: planned.map((p) => ({ rowId: p.rowId, columnId: p.columnId, color: p.next })),
    };
    writeLocal(batch.changes);
    mark(batch.changes, 1);

    const run = tail.then(() => send(batch));
    tail = run.catch(() => undefined);
    let result: CellColorResult;
    try {
      result = await run;
    } catch (error) {
      mark(batch.changes, -1);
      rollback(planned);
      throw error;
    }
    mark(batch.changes, -1);

    const refused = new Set(result.rejected.map((r) => cellKey(r.rowId, r.columnId)));
    if (result.rows && result.rows.length > 0 && opts.upsertRows) {
      opts.upsertRows(result.rows as Row[]);
    } else {
      rollback(planned.filter((p) => refused.has(cellKey(p.rowId, p.columnId))));
    }

    const appliedKeys = new Set(result.applied.map((a) => cellKey(a.rowId, a.columnId)));
    const applied = planned.filter((p) => appliedKeys.has(cellKey(p.rowId, p.columnId)) && p.prev !== p.next);
    opts.onApplied?.({ applied, source });

    return {
      result: {
        applied: result.applied,
        rejected: [...rejected, ...result.rejected],
        ...(result.rows ? { rows: result.rows } : {}),
      },
      skipped,
    };
  };

  return {
    apply,
    isPending: (rowId, columnId) => pending.has(cellKey(rowId, columnId)),
  };
}
