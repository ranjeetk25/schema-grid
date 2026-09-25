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

/**
 * Computes the target range for a paste. When `selection` is at least as
 * large as the clipboard block in BOTH dimensions, and strictly larger in at
 * least one, the block tiles over the whole selection. Otherwise the target
 * starts at `anchor` and is exactly the size of the block, clipped to the
 * grid's edges.
 */
function computeTargetRange(
  matrixRows: number,
  matrixCols: number,
  anchor: CellPos,
  selection: NormalizedRange | null | undefined,
  displayedColIds: string[],
  rowCount: number,
): NormalizedRange {
  const startColIdx = displayedColIds.indexOf(anchor.colId);
  if (startColIdx === -1) return { rowStart: anchor.rowIndex, rowEnd: anchor.rowIndex, colIds: [] };

  if (selection) {
    // A stale selection may reference columns hidden since; never target them.
    const displayed = new Set(displayedColIds);
    selection = { ...selection, colIds: selection.colIds.filter((id) => displayed.has(id)) };
    const selRows = selection.rowEnd - selection.rowStart + 1;
    const selCols = selection.colIds.length;
    const fitsBoth = selRows >= matrixRows && selCols >= matrixCols;
    const largerInEither = selRows > matrixRows || selCols > matrixCols;
    if (fitsBoth && largerInEither) {
      return { rowStart: selection.rowStart, rowEnd: selection.rowEnd, colIds: [...selection.colIds] };
    }
  }

  const rowEnd = Math.min(rowCount - 1, anchor.rowIndex + matrixRows - 1);
  const colIds = displayedColIds.slice(startColIdx, startColIdx + matrixCols);
  return { rowStart: anchor.rowIndex, rowEnd: Math.max(anchor.rowIndex, rowEnd), colIds };
}

/** Plans a paste of `matrix` onto the grid. See module docs for tiling rules. */
export function planPaste<Row extends GridRow>(options: PlanPasteOptions<Row>): PastePlan {
  const { matrix, anchor, selection, displayedColIds, rowCount, getRowAt, columnsById, registry, canEditCell } = options;

  const matrixRows = matrix.length;
  const matrixCols = matrixRows > 0 ? Math.max(...matrix.map((r) => r.length)) : 0;

  const targetRange = computeTargetRange(matrixRows, matrixCols, anchor, selection, displayedColIds, rowCount);

  const changes: CellChange[] = [];
  const errors: PastePlanError[] = [];
  const pendingOptions: PastePendingOptions[] = [];
  let skippedReadOnly = 0;

  if (matrixRows === 0 || matrixCols === 0) {
    return { changes, errors, pendingOptions, skippedReadOnly, targetRange };
  }

  let rowOffset = 0;
  for (let rowIndex = targetRange.rowStart; rowIndex <= targetRange.rowEnd; rowIndex++, rowOffset++) {
    if (rowIndex < 0 || rowIndex >= rowCount) continue;
    const displayRow = getRowAt(rowIndex);
    if (displayRow === undefined || !isDataRow(displayRow)) continue;
    const row = displayRow;

    const sourceRow = matrix[rowOffset % matrixRows] ?? [];

    let colOffset = 0;
    for (const colId of targetRange.colIds) {
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

      if (parsed.pendingOptions && parsed.pendingOptions.length > 0) {
        pendingOptions.push({ rowId: row.id, columnId: colId, labels: [...parsed.pendingOptions] });
      }
      const prev = row.cells[column.key];
      changes.push({ rowId: row.id, columnId: colId, prev, next: parsed.value });
    }
  }

  return { changes, errors, pendingOptions, skippedReadOnly, targetRange };
}
