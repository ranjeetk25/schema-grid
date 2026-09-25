import type { ComponentType } from "react";
import type { CellClassRules, ColDef, EditableCallbackParams, ValueGetterParams } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import type { Access, ColumnDef, FieldTypeRegistry, FormulaEnv, GridRow, GridSchema, Pinned, ViewDef } from "../internal/core";
import { longTextSuppressKeyboardEvent } from "../editors/LongTextEditor";
import type { SchemaCellRendererParams } from "./defaultRenderers";
import { compileFormulaColumns, type CompiledFormulas } from "./formulaColumns";
import type { UiFieldTypeRegistry } from "./uiRegistry";

export interface CompileColumnsOptions<Row extends GridRow = GridRow> {
  view?: ViewDef | null;
  cellClassRules?: CellClassRules<Row>;
  formulaEnv?: FormulaEnv;
  /** Row-level edit check (see `createCellAccess`). Only consulted for columns whose access is "edit". */
  canEditCell?(row: Row, columnId: string): boolean;
  /**
   * Precompiled formulas. Callers that recompile columns (view/resize changes)
   * MUST pass a memoised instance — getters memoise per row object, and a
   * fresh compile throws that cache away. Compiled ad hoc when omitted.
   */
  formulas?: CompiledFormulas<Row>;
  /**
   * Hook to wrap every column's renderer (e.g. the range/fill `CellShell`).
   * Must return a STABLE component per input renderer (cache it), otherwise
   * every cell remounts on recompile.
   */
  wrapRenderer?(renderer: ComponentType<CustomCellRendererProps<Row>>): ComponentType<CustomCellRendererProps<Row>>;
}

function isDataRow<Row extends GridRow>(data: unknown): data is Row {
  return typeof data === "object" && data !== null && "cells" in data;
}

/**
 * Pure schema → AG Grid ColDef compiler. Hidden columns are omitted; edits
 * never go through AG Grid's value setter (always false) but through the edit
 * pipeline — the grid MUST set `readOnlyEdit: true` so AG Grid raises
 * `cellEditRequest` instead of calling the setter.
 *
 * Row-level permission results (`canEditCell`) only gate editing; a row-level
 * "hidden" does not blank the value (column-level hidden omits the column).
 *
 * Ordering: columns with view state come first (by view order); columns the
 * view doesn't know (added after it was saved) follow by `ColumnDef.order`.
 */
export function compileColumns<Row extends GridRow = GridRow>(
  schema: GridSchema,
  access: Map<string, Access>,
  registry: FieldTypeRegistry,
  uiRegistry: UiFieldTypeRegistry<Row>,
  options: CompileColumnsOptions<Row> = {},
): ColDef<Row>[] {
  const { view, cellClassRules, canEditCell, wrapRenderer } = options;
  const hasFormula = schema.columns.some((c) => c.type === "formula");
  const formulas = options.formulas ?? (hasFormula ? compileFormulaColumns<Row>(schema, options.formulaEnv) : undefined);
  const viewState = new Map((view?.columnState ?? []).map((s) => [s.id, s]));

  const compiled: { def: ColDef<Row>; inView: number; order: number; index: number }[] = [];
  schema.columns.forEach((column: ColumnDef, index) => {
    const columnAccess = access.get(column.id) ?? "hidden";
    if (columnAccess === "hidden") return;
    const isFormula = column.type === "formula";
    const state = viewState.get(column.id);
    const entry = uiRegistry.get(column.type);
    const params: SchemaCellRendererParams = { schemaColumn: column, fieldType: registry.get(column.type) };

    const formulaGetter = isFormula ? formulas?.getters.get(column.id) : undefined;
    const valueGetter = (p: ValueGetterParams<Row>): unknown => {
      const data: unknown = p.data;
      if (!isDataRow<Row>(data)) return undefined;
      if (isFormula) return formulaGetter ? formulaGetter(data) : undefined;
      return data.cells[column.key];
    };

    const editable: ColDef<Row>["editable"] =
      columnAccess === "edit" && !isFormula
        ? (p: EditableCallbackParams<Row>) => {
            const data: unknown = p.data;
            if (!isDataRow<Row>(data)) return false;
            return canEditCell ? canEditCell(data, column.id) : true;
          }
        : false;

    const pinned: Pinned = state ? state.pinned : (column.pinned ?? null);
    const width = state?.width ?? column.width;

    const def: ColDef<Row> = {
      colId: column.id,
      headerName: column.label,
      valueGetter,
      valueSetter: () => false,
      editable,
      sortable: true,
      hide: state ? state.hidden : (column.hidden ?? false),
      pinned,
      cellRenderer: wrapRenderer ? wrapRenderer(entry.renderer) : entry.renderer,
      cellRendererParams: params,
      cellEditor: entry.editor,
      cellEditorParams: params,
      cellEditorPopup: entry.editorPopup,
      cellEditorPopupPosition: entry.editorPopupPosition,
      filter: entry.filterComponent ?? false,
      floatingFilterComponent: entry.floatingFilter,
      floatingFilter: entry.filterComponent !== undefined && entry.floatingFilter !== undefined,
    };
    if (width !== undefined) def.width = width;
    if (cellClassRules) def.cellClassRules = cellClassRules;
    if (column.type === "longText") def.suppressKeyboardEvent = longTextSuppressKeyboardEvent;
    compiled.push({ def, inView: state ? 0 : 1, order: state?.order ?? column.order, index });
  });

  compiled.sort((a, b) => a.inView - b.inView || a.order - b.order || a.index - b.index);
  return compiled.map((c) => c.def);
}
