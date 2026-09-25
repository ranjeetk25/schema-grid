/**
 * Adapts AG Grid's `onCellEditRequest` (used with `readOnlyEdit: true`) into a
 * single-cell `"edit"` submit on the edit controller. This is the only file
 * that depends on the readOnlyEdit choice (plan deviation 1).
 *
 * - Only user edits are handled: events whose `source` is set and is not
 *   `"edit"` (AG's `"paste"`, `"undo"`, `"redo"`, `"data"`, ...) are ignored —
 *   our own clipboard/undo go through the controller directly.
 * - Rows without `cells` (full-width/group rows) and unknown columns are skipped.
 * - Value: `parseValue(newValue, column)` when given (opt-in override).
 *   Otherwise `newValue` passes through as-is — our editors emit typed values.
 *   Only when `newValue` is a string AND the column's value is not
 *   string-shaped (see STRING_VALUED_TYPES) is the registry type's `parse`
 *   run; a failed parse sets a cell error (when `cellStatus` is given) and
 *   nothing is submitted.
 * - prev: the row store's current cell value when the row is known, else
 *   `event.oldValue`.
 * - No-op edits (deep-equal prev/next) are skipped.
 */
import type { CellEditRequestEvent } from "ag-grid-community";
import type { ColumnDef, FieldTypeId, FieldTypeRegistry, GridRow, GridSchema } from "../internal/core";
import type { CellStatusStore } from "../state/cellStatusStore";
import type { RowStore } from "../state/rowStore";
import type { EditController } from "./editController";

export interface EditRequestHandlerOptions<Row extends GridRow = GridRow> {
  schema: GridSchema;
  registry?: FieldTypeRegistry;
  /** Where parse failures are reported. */
  cellStatus?: CellStatusStore;
  /** Source of truth for `prev` when the row is loaded. */
  rowStore?: RowStore<Row>;
  parseValue?(value: unknown, column: ColumnDef): unknown;
}

/**
 * Types whose stored value is itself a string — a string newValue is already
 * typed. (`user` is not: core stores `UserRef {id, name?}`, so a string is
 * parsed into one; `link` stores `LinkRef[]`.)
 */
const STRING_VALUED_TYPES: ReadonlySet<FieldTypeId> = new Set<FieldTypeId>([
  "text",
  "longText",
  "url",
  "email",
  "phone",
  "select",
  "creatableSelect",
  "date",
  "datetime",
]);

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

function hasCells(data: unknown): data is GridRow {
  if (typeof data !== "object" || data === null) return false;
  const cells = (data as { cells?: unknown }).cells;
  return typeof cells === "object" && cells !== null;
}

export function createEditRequestHandler<Row extends GridRow>(
  controller: Pick<EditController<Row>, "submit">,
  opts: EditRequestHandlerOptions<Row>,
): (event: CellEditRequestEvent<Row>) => void {
  return (event) => {
    if (event.source !== undefined && event.source !== "edit") return;
    const data: unknown = event.data;
    if (!hasCells(data)) return;
    const columnId = event.column.getColId();
    const column = opts.schema.columns.find((c) => c.id === columnId);
    if (!column) return;

    let next: unknown = event.newValue;
    if (opts.parseValue) {
      next = opts.parseValue(next, column);
    } else if (typeof next === "string" && !STRING_VALUED_TYPES.has(column.type) && opts.registry) {
      const type = opts.registry.get(column.type);
      if (type) {
        const parsed = type.parse(next, column.config);
        if (!parsed.ok) {
          opts.cellStatus?.setError({ rowId: data.id, columnId }, parsed.error);
          return;
        }
        next = parsed.value;
      }
    }

    const known = opts.rowStore?.getRow(data.id);
    const prev: unknown = known ? known.cells[column.key] : event.oldValue;
    if (deepEqual(prev, next)) return;
    void controller.submit([{ rowId: data.id, columnId, prev, next }], "edit");
  };
}
