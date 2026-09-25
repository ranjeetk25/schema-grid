/**
 * In-place cell interactions that bypass AG Grid's editor lifecycle:
 *
 * - Boolean toggle: booleans never open an editor (`compileColumns` sets
 *   AG Grid `editable: false` for them); a click on the checkbox, or
 *   Space / Enter on the focused cell, flips the value through the normal
 *   edit pipeline (`controller.submit(..., "edit")` → undo stack, announcer).
 * - Read-only feedback: `sg-cell-formula` / `sg-cell-readonly` cell classes,
 *   and when Enter / F2 / typing / double-click hits a non-editable cell, a
 *   live-region message plus a short `sg-cell-readonly-hint` flash.
 *
 * Editability is decided by `readOnlyReason` from the schema column, the
 * column access and the row-level `canEditCell` — never by AG Grid's
 * `colDef.editable` (false for booleans on purpose).
 */
import type {
  CellClassParams,
  CellClassRules,
  CellClickedEvent,
  CellDoubleClickedEvent,
  IRowNode,
  SuppressKeyboardEventParams,
} from "ag-grid-community";
import type { Access, ColumnDef, GridRow, GridSchema } from "../internal/core";
import { SG_CLASSES } from "../theme/classNames";

export type ReadOnlyReason = "formula" | "permission";

export const READ_ONLY_MESSAGES: Record<ReadOnlyReason, string> = {
  formula: "Read-only: computed by formula",
  permission: "Read-only: you don't have edit access",
};

/** Why a cell can't be edited, or null when it can. */
export function readOnlyReason<Row extends GridRow>(
  column: ColumnDef | undefined,
  access: Access | undefined,
  row: Row | undefined,
  canEditCell?: (row: Row, columnId: string) => boolean,
): ReadOnlyReason | null {
  if (!column) return null;
  if (column.type === "formula") return "formula";
  if (access !== "edit") return "permission";
  if (row && canEditCell && !canEditCell(row, column.id)) return "permission";
  return null;
}

/** True for columns whose value toggles in place (no editor). */
export function isInPlaceToggleColumn(column: ColumnDef | undefined): boolean {
  return column?.type === "boolean";
}

const columnIndex = new WeakMap<GridSchema, Map<string, ColumnDef>>();

/** Schema column by id (memoised per schema object). */
export function schemaColumnById(schema: GridSchema | undefined, id: string | undefined): ColumnDef | undefined {
  if (!schema || id === undefined) return undefined;
  let index = columnIndex.get(schema);
  if (!index) {
    index = new Map(schema.columns.map((c) => [c.id, c]));
    columnIndex.set(schema, index);
  }
  return index.get(id);
}

function isDataRow<Row extends GridRow>(data: unknown): data is Row {
  return typeof data === "object" && data !== null && "cells" in data && "id" in data;
}

/** The context fields the rules/handlers read (a subset of `SchemaGridHookContext`). */
export interface InPlaceContext<Row extends GridRow = GridRow> {
  schema?: GridSchema;
  access?: Map<string, Access>;
  canEditCell?(row: Row, columnId: string): boolean;
}

function contextOf<Row extends GridRow>(ctx: unknown): InPlaceContext<Row> | undefined {
  if (!ctx || typeof ctx !== "object" || !("schema" in ctx)) return undefined;
  return ctx as InPlaceContext<Row>;
}

/** Reason for the cell a params-like object points at (schema/access from `params.context`). */
export function cellReadOnlyReason<Row extends GridRow>(p: {
  context?: unknown;
  data?: unknown;
  colDef?: { colId?: string } | null;
  column?: { getColId(): string } | null;
}): ReadOnlyReason | null {
  const ctx = contextOf<Row>(p.context);
  if (!ctx) return null;
  const colId = p.colDef?.colId ?? p.column?.getColId();
  const column = schemaColumnById(ctx.schema, colId);
  if (!column || !isDataRow<Row>(p.data)) return null;
  return readOnlyReason<Row>(column, ctx.access?.get(column.id), p.data, ctx.canEditCell);
}

/** Pure rules: `sg-cell-formula` for formula cells, `sg-cell-readonly` for permission read-only cells. */
export function createReadOnlyCellClassRules<Row extends GridRow = GridRow>(): CellClassRules<Row> {
  return {
    [SG_CLASSES.formula]: (p: CellClassParams<Row>) => cellReadOnlyReason<Row>(p) === "formula",
    [SG_CLASSES.readOnly]: (p: CellClassParams<Row>) => cellReadOnlyReason<Row>(p) === "permission",
  };
}

const HINT_MS = 600;

/** Restarts the transient read-only flash on a cell element. */
export function flashReadOnlyHint(cell: Element | null | undefined): void {
  if (!cell) return;
  const cls = SG_CLASSES.readOnlyHint;
  cell.classList.remove(cls);
  // Force a reflow so re-adding restarts the animation.
  void (cell as HTMLElement).offsetWidth;
  cell.classList.add(cls);
  setTimeout(() => cell.classList.remove(cls), HINT_MS);
}

function cellElementFrom(target: EventTarget | null | undefined): Element | null {
  return target instanceof Element ? target.closest(".ag-cell") : null;
}

function isPrintable(event: KeyboardEvent): boolean {
  return event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
}

export interface InPlaceHandlersOptions<Row extends GridRow = GridRow> {
  getContext(): InPlaceContext<Row>;
  /** Submits one cell change through the edit controller. */
  submit(change: { rowId: string; columnId: string; prev: unknown; next: unknown }): void;
  /** Current stored value (row store first, then the row object). */
  getValue(row: Row, column: ColumnDef): unknown;
  announce?(message: string, politeness?: "polite" | "assertive"): void;
}

export interface InPlaceHandlers<Row extends GridRow = GridRow> {
  /** Register on the keyboard registry (`keyboard.register`). */
  keyHandler(params: SuppressKeyboardEventParams<Row>): boolean;
  onCellClicked(event: CellClickedEvent<Row>): void;
  onCellDoubleClicked(event: CellDoubleClickedEvent<Row>): void;
  /** Toggles a boolean cell; returns false when it is read-only (and gives feedback). */
  toggle(node: IRowNode<Row> | null | undefined, columnId: string, cell?: Element | null): boolean;
}

/** Slop around the 16px checkbox that still counts as a click on it. */
const HIT_SLOP = 4;

function hitsCheckbox(cell: Element, event: Event | null | undefined): boolean {
  const box = cell.querySelector(".sg-bool");
  if (!box || !event || !("clientX" in event)) return false;
  const { clientX, clientY } = event as MouseEvent;
  const r = box.getBoundingClientRect();
  // jsdom has no layout: an all-zero rect means "can't tell", accept the click.
  if (r.width === 0 && r.height === 0) return true;
  return (
    clientX >= r.left - HIT_SLOP && clientX <= r.right + HIT_SLOP && clientY >= r.top - HIT_SLOP && clientY <= r.bottom + HIT_SLOP
  );
}

export function createInPlaceHandlers<Row extends GridRow = GridRow>(opts: InPlaceHandlersOptions<Row>): InPlaceHandlers<Row> {
  const resolve = (node: IRowNode<Row> | null | undefined, columnId: string) => {
    const ctx = opts.getContext();
    const column = schemaColumnById(ctx.schema, columnId);
    const row = node?.data;
    if (!column || !isDataRow<Row>(row)) return undefined;
    return { ctx, column, row, reason: readOnlyReason<Row>(column, ctx.access?.get(column.id), row, ctx.canEditCell) };
  };

  const feedback = (reason: ReadOnlyReason, cell: Element | null | undefined): void => {
    opts.announce?.(READ_ONLY_MESSAGES[reason], "polite");
    flashReadOnlyHint(cell);
  };

  const toggle: InPlaceHandlers<Row>["toggle"] = (node, columnId, cell) => {
    const r = resolve(node, columnId);
    if (!r || !isInPlaceToggleColumn(r.column)) return false;
    if (r.reason) {
      feedback(r.reason, cell);
      return false;
    }
    const prev = opts.getValue(r.row, r.column);
    opts.submit({ rowId: r.row.id, columnId, prev, next: !(prev === true) });
    return true;
  };

  return {
    toggle,
    keyHandler(params) {
      if (params.editing) return false;
      const event = params.event;
      if (event.type !== "keydown") return false;
      const columnId = params.column.getColId();
      const r = resolve(params.node, columnId);
      if (!r) return false;
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      const cell = cellElementFrom(event.target);
      if (isInPlaceToggleColumn(r.column) && plain && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        toggle(params.node, columnId, cell);
        return true;
      }
      if (r.reason && ((plain && (event.key === "Enter" || event.key === "F2")) || isPrintable(event))) {
        feedback(r.reason, cell);
      }
      return false;
    },
    onCellClicked(event) {
      const columnId = event.column.getColId();
      const r = resolve(event.node, columnId);
      if (!r || !isInPlaceToggleColumn(r.column)) return;
      const cell = cellElementFrom(event.event?.target ?? null);
      if (!cell || !hitsCheckbox(cell, event.event)) return;
      toggle(event.node, columnId, cell);
    },
    onCellDoubleClicked(event) {
      const columnId = event.column.getColId();
      const r = resolve(event.node, columnId);
      if (!r || !r.reason || isInPlaceToggleColumn(r.column)) return;
      feedback(r.reason, cellElementFrom(event.event?.target ?? null));
    },
  };
}
