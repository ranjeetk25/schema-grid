/**
 * Plans a paste of a TSV-derived matrix onto the grid: pure cell-by-cell
 * planning that produces a `CellChange[]` plus per-cell errors and a count
 * of read-only cells that were skipped.
 */
import type { CellChange, ColumnDef, FieldTypeRegistry, GridRow } from "../internal/core";
import { effectiveFieldType } from "../internal/core";
import type { CellPos, NormalizedRange } from "../range/geometry";
import type { DisplayRow } from "../grouping/clientGroups";
import { isDataRow } from "../grouping/clientGroups";

export interface PastePlanError {
  rowId: string;
  columnId: string;
  message: string;
}

/**
 * A pasted cell whose text named options that don't exist yet (core
 * creatableSelect / multiSelect-with-allowCreate `parse` → `pendingOptions`).
 * The matching change's `next` holds core's label placeholder(s); the caller
 * creates each option (`dataSource.createOption`) and swaps the label for the
 * new option id before applying.
 */
export interface PastePendingOptions {
  rowId: string;
  columnId: string;
  labels: string[];
}

export interface PastePlan {
  changes: CellChange[];
  errors: PastePlanError[];
  pendingOptions: PastePendingOptions[];
  skippedReadOnly: number;
  targetRange: NormalizedRange;
}

export interface PlanPasteOptions<Row extends GridRow> {
  matrix: string[][];
  anchor: CellPos;
  selection?: NormalizedRange | null;
  displayedColIds: string[];
  rowCount: number;
  getRowAt: (rowIndex: number) => DisplayRow<Row> | undefined;
  columnsById: Map<string, ColumnDef>;
  registry: FieldTypeRegistry;
  canEditCell(row: Row, columnId: string): boolean;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

/**
 * Computes the target columns and, when the block tiles, the row span. When
 * `selection` is at least as large as the clipboard block in BOTH dimensions
 * (rows counted as displayed rows), and strictly larger in at least one, the
 * block tiles over the whole selection. Otherwise the target starts at
 * `anchor` and is exactly the width of the block, clipped to the grid's
 * edges; its rows are the next `matrixRows` DATA rows (see `planPaste`).
 */
function computeTarget(
  matrixRows: number,
  matrixCols: number,
  anchor: CellPos,
  selection: NormalizedRange | null | undefined,
  displayedColIds: string[],
): { colIds: string[]; tileRows: { rowStart: number; rowEnd: number } | null } {
  const startColIdx = displayedColIds.indexOf(anchor.colId);
  if (startColIdx === -1) return { colIds: [], tileRows: null };

  if (selection) {
    // A stale selection may reference columns hidden since; never target them.
    const displayed = new Set(displayedColIds);
    const selColIds = selection.colIds.filter((id) => displayed.has(id));
    const selRows = selection.rowEnd - selection.rowStart + 1;
    const selCols = selColIds.length;
    const fitsBoth = selRows >= matrixRows && selCols >= matrixCols;
    const largerInEither = selRows > matrixRows || selCols > matrixCols;
    if (fitsBoth && largerInEither) {
      return { colIds: selColIds, tileRows: { rowStart: selection.rowStart, rowEnd: selection.rowEnd } };
    }
  }

  return { colIds: displayedColIds.slice(startColIdx, startColIdx + matrixCols), tileRows: null };
}

/**
 * Plans a paste of `matrix` onto the grid.
 *
 * - Only displayed columns that are schema columns are targeted (selection /
 *   row-number columns are ignored).
 * - Group, load-more and not-yet-loaded rows are skipped WITHOUT consuming a
 *   source row, mirroring `buildCopyMatrix` (which omits them), so a copy →
 *   paste across group rows round-trips. Untiled, the block lands on the next
 *   `matrix.length` data rows from the anchor (clipped at the last row);
 *   `targetRange` spans the displayed rows visited.
 * - Changes whose parsed `next` deep-equals `prev` are dropped (no-ops).
 */
export function planPaste<Row extends GridRow>(options: PlanPasteOptions<Row>): PastePlan {
  const { matrix, anchor, selection, rowCount, getRowAt, columnsById, registry, canEditCell } = options;
  const displayedColIds = options.displayedColIds.filter((id) => columnsById.has(id));

  const matrixRows = matrix.length;
  let matrixCols = 0;
  for (const r of matrix) if (r.length > matrixCols) matrixCols = r.length;

  const target = computeTarget(matrixRows, matrixCols, anchor, selection, displayedColIds);

  const changes: CellChange[] = [];
  const errors: PastePlanError[] = [];
  const pendingOptions: PastePendingOptions[] = [];
  let skippedReadOnly = 0;
  const targetRange: NormalizedRange = { rowStart: anchor.rowIndex, rowEnd: anchor.rowIndex, colIds: target.colIds };

  if (matrixRows === 0 || matrixCols === 0 || target.colIds.length === 0) {
    return { changes, errors, pendingOptions, skippedReadOnly, targetRange };
  }

  const rowStart = target.tileRows ? target.tileRows.rowStart : anchor.rowIndex;
  const rowLimit = target.tileRows ? Math.min(target.tileRows.rowEnd, rowCount - 1) : rowCount - 1;
  targetRange.rowStart = rowStart;
  targetRange.rowEnd = Math.max(rowStart, target.tileRows ? target.tileRows.rowEnd : rowStart);

  let sourceOffset = 0;
  for (let rowIndex = Math.max(0, rowStart); rowIndex <= rowLimit; rowIndex++) {
    if (!target.tileRows && sourceOffset >= matrixRows) break;
    if (!target.tileRows) targetRange.rowEnd = rowIndex;
    const displayRow = getRowAt(rowIndex);
    if (displayRow === undefined || !isDataRow(displayRow)) continue;
    const row = displayRow;

    const sourceRow = matrix[sourceOffset % matrixRows] ?? [];
    sourceOffset++;

    let colOffset = 0;
    for (const colId of target.colIds) {
      const cellText = sourceRow[colOffset % matrixCols] ?? "";
      colOffset++;

      const column = columnsById.get(colId);
      if (!column || column.type === "formula" || !canEditCell(row, colId)) {
        skippedReadOnly++;
        continue;
      }

      const fieldType = effectiveFieldType(registry, column);
      if (!fieldType) {
        skippedReadOnly++;
        continue;
      }

      const parsed = fieldType.parse(cellText, column.config ?? fieldType.defaultConfig);
      if (!parsed.ok) {
        errors.push({ rowId: row.id, columnId: colId, message: parsed.error });
        continue;
      }

      const prev = row.cells[column.key];
      if (deepEqual(prev ?? null, parsed.value ?? null)) continue;
      if (parsed.pendingOptions && parsed.pendingOptions.length > 0) {
        pendingOptions.push({ rowId: row.id, columnId: colId, labels: [...parsed.pendingOptions] });
      }
      changes.push({ rowId: row.id, columnId: colId, prev, next: parsed.value });
    }
  }

  return { changes, errors, pendingOptions, skippedReadOnly, targetRange };
}
