import type { ComponentType } from "react";
import type { CellClassRules, ColDef, EditableCallbackParams, ValueGetterParams } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import type { Access, ColumnDef, FieldTypeRegistry, FormulaEnv, GridRow, GridSchema, Pinned, ViewDef } from "../internal/core";
import { longTextSuppressKeyboardEvent } from "../editors/LongTextEditor";
import { SchemaHeader, schemaHeaderKeyboardEvent } from "../grid/SchemaHeader";
import { isInPlaceToggleColumn } from "../editing/inPlace";
import type { SchemaCellRendererParams } from "./defaultRenderers";
import { compileFormulaColumns, type CompiledFormulas } from "./formulaColumns";
import type { UiFieldTypeRegistry } from "./uiRegistry";
import { AddColumnHeader } from "../grid/AddColumnHeader";
import { ADD_COLUMN_ID, DRAFT_COLUMN_ID, type DraftColumn, resolveInsertIndex } from "./syntheticColumns";

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
  /**
   * Show AG Grid's floating-filter row (the read-only `FloatingFilter` chip).
   * Default false: the filter lives in the header cell (`SchemaHeader`'s
   * filter button), which saves a whole 36px row.
   */
  floatingFilters?: boolean;
  /**
   * A column being built in the host's column builder (see `DraftColumn`):
   * "create" inserts a read-only ghost column (`__sg_draft__`), "edit"
   * renders the real column with the draft's label/config.
   */
  draft?: DraftColumn | null;
  /** Append the trailing "+" column (`__sg_add__`, header = "Add column at end"). */
  addColumn?: boolean;
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
 * Every column gets `SchemaHeader` (label + sort + filter button) and its
 * keyboard shortcut handler; the floating-filter row is opt-in
 * (`floatingFilters`).
 *
 * Column options (C1): `sortable: false` → ColDef `sortable: false` (no
 * header sort); `filterable: false` → `filter: false` (no filter button, no
 * floating filter); `settable: false` → never editable. `useSchemaGrid`
 * writes the data source's capabilities onto these options first
 * (`applyEffectiveCapabilities`).
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
  const { view, cellClassRules, canEditCell, wrapRenderer, floatingFilters = false, draft } = options;
  const hasFormula = schema.columns.some((c) => c.type === "formula");
  const formulas = options.formulas ?? (hasFormula ? compileFormulaColumns<Row>(schema, options.formulaEnv) : undefined);
  // Edit-mode draft: the real column renders with the draft's label/config.
  const editDraft = draft?.mode === "edit" ? draft.column : undefined;
  const editIndex = editDraft ? schema.columns.findIndex((c) => c.id === editDraft.id) : -1;
  const columns =
    editDraft && editIndex >= 0
      ? schema.columns.map((c, i) => (i === editIndex ? { ...c, ...editDraft, id: c.id, key: c.key } : c))
      : schema.columns;
  // A formula being edited previews through a compile of the patched schema.
  const editFormulaGetter =
    editDraft && editIndex >= 0 && columns[editIndex]?.type === "formula"
      ? compileFormulaColumns<Row>({ ...schema, columns }, options.formulaEnv).getters.get(editDraft.id)
      : undefined;
  const viewState = new Map((view?.columnState ?? []).map((s) => [s.id, s]));

  const compiled: { def: ColDef<Row>; inView: number; order: number; index: number }[] = [];
  columns.forEach((column: ColumnDef, index) => {
    const columnAccess = access.get(column.id) ?? "hidden";
    if (columnAccess === "hidden") return;
    const isFormula = column.type === "formula";
    const state = viewState.get(column.id);
    const entry = uiRegistry.get(column.type);
    const params: SchemaCellRendererParams = { schemaColumn: column, fieldType: registry.get(column.type) };

    const formulaGetter = isFormula
      ? index === editIndex && editFormulaGetter
        ? editFormulaGetter
        : formulas?.getters.get(column.id)
      : undefined;
    const valueGetter = (p: ValueGetterParams<Row>): unknown => {
      const data: unknown = p.data;
      if (!isDataRow<Row>(data)) return undefined;
      if (isFormula) return formulaGetter ? formulaGetter(data) : undefined;
      return data.cells[column.key];
    };

    // Booleans toggle in place (`editing/inPlace.ts`): AG Grid never opens an
    // editor for them; editability is checked by the toggle itself.
    const inPlaceToggle = isInPlaceToggleColumn(column);
    // `settable: false` (C1): the data source can't write it. Access already
    // caps it at "read"; checked here too so a hand-built access map can't
    // make it editable.
    const settable = column.settable !== false;
    const sortable = column.sortable !== false;
    const filterComponent = column.filterable === false ? undefined : entry.filterComponent;
    const editable: ColDef<Row>["editable"] =
      columnAccess === "edit" && settable && !isFormula && !inPlaceToggle
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
      sortable,
      // Stateful attributes use the `initial*` forms so recompiling ColDefs
      // (seams, access or formula changes) never resets the user's live column
      // layout; saved views are applied via `applyViewState` (applyColumnState).
      initialHide: state ? state.hidden : (column.hidden ?? false),
      initialPinned: pinned ?? undefined,
      cellRenderer: wrapRenderer ? wrapRenderer(entry.renderer) : entry.renderer,
      cellRendererParams: params,
      cellEditor: entry.editor,
      cellEditorParams: params,
      cellEditorPopup: entry.editorPopup,
      // Popups open under the cell by default so the cell stays readable.
      cellEditorPopupPosition: entry.editorPopupPosition ?? (entry.editorPopup ? "under" : undefined),
      filter: filterComponent ?? false,
      filterParams: params,
      floatingFilter: floatingFilters && filterComponent !== undefined && entry.floatingFilter !== undefined,
      headerComponent: SchemaHeader,
      suppressHeaderKeyboardEvent: schemaHeaderKeyboardEvent,
    };
    if (floatingFilters && filterComponent !== undefined && entry.floatingFilter !== undefined) {
      def.floatingFilterComponent = entry.floatingFilter;
    }
    if (width !== undefined) def.initialWidth = width;
    if (cellClassRules) def.cellClassRules = cellClassRules;
    if (column.type === "longText") def.suppressKeyboardEvent = longTextSuppressKeyboardEvent;
    compiled.push({ def, inView: state ? 0 : 1, order: state?.order ?? column.order, index });
  });

  compiled.sort((a, b) => a.inView - b.inView || a.order - b.order || a.index - b.index);
  const defs = compiled.map((c) => c.def);

  if (draft?.mode === "create") {
    const ghost = compileGhostColumn<Row>(schema, draft, registry, uiRegistry, options.formulaEnv);
    const at = resolveInsertIndex(
      defs.map((d) => d.colId ?? ""),
      draft.insertAt,
    );
    defs.splice(at, 0, ghost);
  }
  if (options.addColumn) defs.push(addColumnDef<Row>());
  return defs;
}

/** Ghost preview of a column being created: read-only, default value or live formula result. */
function compileGhostColumn<Row extends GridRow>(
  schema: GridSchema,
  draft: DraftColumn,
  registry: FieldTypeRegistry,
  uiRegistry: UiFieldTypeRegistry<Row>,
  formulaEnv: FormulaEnv | undefined,
): ColDef<Row> {
  const label = draft.column.label.trim() === "" ? "New column" : draft.column.label;
  const ghost: ColumnDef = { ...draft.column, id: DRAFT_COLUMN_ID, label };
  const entry = uiRegistry.has(ghost.type) ? uiRegistry.get(ghost.type) : uiRegistry.get("text");
  const formulaGetter =
    ghost.type === "formula"
      ? compileFormulaColumns<Row>({ ...schema, columns: [...schema.columns, ghost] }, formulaEnv).getters.get(DRAFT_COLUMN_ID)
      : undefined;
  const params: SchemaCellRendererParams = { schemaColumn: ghost, fieldType: registry.get(ghost.type) };
  return {
    colId: DRAFT_COLUMN_ID,
    headerName: label,
    headerClass: "sg-header-ghost",
    cellClass: "sg-cell-ghost",
    headerComponent: SchemaHeader,
    headerComponentParams: { ghost: true },
    valueGetter: (p: ValueGetterParams<Row>): unknown => {
      const data: unknown = p.data;
      if (!isDataRow<Row>(data)) return undefined;
      if (formulaGetter) return formulaGetter(data);
      return ghost.defaultValue ?? null;
    },
    valueSetter: () => false,
    editable: false,
    sortable: false,
    filter: false,
    suppressMovable: true,
    suppressNavigable: true,
    suppressFillHandle: true,
    cellRenderer: entry.renderer,
    cellRendererParams: params,
    ...(ghost.width !== undefined ? { width: ghost.width } : {}),
  };
}

/** The trailing "+" column. */
function addColumnDef<Row extends GridRow>(): ColDef<Row> {
  return {
    colId: ADD_COLUMN_ID,
    headerName: "",
    headerClass: "sg-header-add-cell",
    cellClass: "sg-cell-add",
    headerComponent: AddColumnHeader,
    valueGetter: () => null,
    valueSetter: () => false,
    width: 44,
    minWidth: 44,
    maxWidth: 44,
    resizable: false,
    sortable: false,
    filter: false,
    editable: false,
    suppressMovable: true,
    suppressNavigable: true,
    suppressFillHandle: true,
    lockPosition: "right",
  };
}
