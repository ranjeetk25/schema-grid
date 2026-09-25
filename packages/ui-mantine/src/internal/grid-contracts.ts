/**
 * ag-grid adapter. The ONLY file in ui-mantine that imports
 * `@masai/schema-grid-ag-grid` (and `ag-grid-react`).
 *
 * ui-mantine's widgets are written against its own small, grid-agnostic
 * contracts (`UiEditorProps`, `UiRendererProps`, `UiFilterInputProps`) so the
 * same component serves a grid cell, a form field (column builder default
 * value / preview) and a filter-builder value input. This file adapts those
 * widgets to AG Grid's prop shapes for the real `UiFieldTypeRegistry`, and
 * tags each adapter with its widget so in-package forms can get it back.
 */
import {
  type ConflictResolution,
  type SchemaCellRendererParams,
  type UiFieldType,
  type UiFieldTypeRegistry,
  createDefaultUiRegistry,
  getSchemaGridContext,
} from "@masai/schema-grid-ag-grid";
import {
  type CreatePopupEditorOptions,
  type PopupEditorEntry,
  type PopupEditorInnerProps,
  createPopupEditor,
} from "@masai/schema-grid-ag-grid/editors";
import { type CustomCellEditorProps, type CustomCellRendererProps, useGridCellEditor } from "ag-grid-react";
import { type ComponentType, createElement, useCallback, useRef } from "react";
import {
  type ColumnDef,
  type DataSource,
  type FieldTypeId,
  type FieldTypeRegistry,
  type FilterOperatorDef,
  type GridRow,
  type Option,
  createDefaultRegistry,
} from "./core-contracts";

// Real ag-grid contracts
export {
  createDefaultUiRegistry,
  createPopupEditor,
  getSchemaGridContext,
  type ConflictResolution,
  type CreatePopupEditorOptions,
  type PopupEditorEntry,
  type PopupEditorInnerProps,
  type SchemaCellRendererParams,
  type UiFieldType,
  type UiFieldTypeRegistry,
};
export type { ClipboardReport, SchemaGridEvents } from "@masai/schema-grid-ag-grid";

// ---------------------------------------------------------------------------
// Widget contracts (owned by ui-mantine)
// ---------------------------------------------------------------------------

export interface UiEditorProps<TValue = unknown, TConfig = unknown> {
  value: TValue | null;
  onChange(value: TValue | null): void;
  /** Commit the edit. An explicit value wins over the last `onChange` value. */
  onCommit(value?: TValue | null): void;
  onCancel(): void;
  column: ColumnDef;
  config: TConfig;
  dataSource?: DataSource;
  /** `false` = form/filter mode: don't grab focus or auto-open dropdowns. */
  autoFocus?: boolean;
  error?: string;
  onOptionCreate?(option: Option): void;
}

export interface UiRendererProps<TValue = unknown, TConfig = unknown> {
  value: TValue | null | undefined;
  column: ColumnDef;
  config: TConfig;
  row?: GridRow;
  fieldType: FieldTypeId;
}

export interface UiFilterInputProps<TValue = unknown> {
  column: ColumnDef;
  operator: FilterOperatorDef;
  value: TValue | null | undefined;
  onChange(value: TValue | null): void;
  dataSource?: DataSource;
}

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous widget registry
export type AnyEditorWidget = ComponentType<UiEditorProps<any, any>>;
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous widget registry
export type AnyRendererWidget = ComponentType<UiRendererProps<any, any>>;

type GridEditor = ComponentType<CustomCellEditorProps<GridRow>>;
type GridRenderer = ComponentType<CustomCellRendererProps<GridRow>>;
type SchemaExtras = Partial<SchemaCellRendererParams>;

const WIDGET = Symbol.for("@masai/schema-grid-ui-mantine/widget");
type Tagged<W> = { [WIDGET]?: W };

function tag<C extends object, W>(component: C, widget: W): C {
  (component as Tagged<W>)[WIDGET] = widget;
  return component;
}

/** The ui-mantine widget behind a registry editor, when it came from this package. */
export function resolveEditorComponent(editor: unknown): AnyEditorWidget | undefined {
  if (!editor || (typeof editor !== "function" && typeof editor !== "object")) return undefined;
  return (editor as Tagged<AnyEditorWidget>)[WIDGET];
}

/** Used only when AG Grid calls an editor without `cellEditorParams` (not compiled by `compileColumns`). */
const FALLBACK_COLUMN: ColumnDef = { id: "", key: "", label: "", type: "text", config: {}, order: 0, createdAt: "", updatedAt: "" };

/** Grid context → the widget's data source and option-create hook. */
function contextExtras(context: unknown, column: ColumnDef | undefined) {
  const ctx = getSchemaGridContext(context);
  return {
    dataSource: ctx?.dataSource as DataSource | undefined,
    onOptionCreate: (option: Option) => {
      if (column) ctx?.events()?.onOptionCreate?.(column.id, option);
    },
  };
}

// ---------------------------------------------------------------------------
// Renderer adapter
// ---------------------------------------------------------------------------

/** Wraps a `UiRendererProps` widget as an AG Grid cell renderer (reads `params.schemaColumn` / `params.fieldType`). */
export function toGridRenderer(widget: AnyRendererWidget): GridRenderer {
  function MantineCellRenderer(props: CustomCellRendererProps<GridRow> & SchemaExtras) {
    const column = props.schemaColumn;
    if (!column) return props.value == null ? null : String(props.value);
    return createElement(widget, {
      value: props.value,
      column,
      config: column.config,
      row: props.data,
      fieldType: props.fieldType?.id ?? column.type,
    });
  }
  MantineCellRenderer.displayName = `GridRenderer(${widget.displayName ?? widget.name ?? "Widget"})`;
  return tag(MantineCellRenderer, widget);
}

const rendererCache = new WeakMap<object, AnyRendererWidget>();
let defaultFieldTypes: FieldTypeRegistry | undefined;
/** Built-in core field types, for AG Grid renderers that format through `params.fieldType`. */
const coreFieldTypes = (): FieldTypeRegistry => {
  defaultFieldTypes ??= createDefaultRegistry();
  return defaultFieldTypes;
};

/**
 * A `UiRendererProps` view of any registry renderer: this package's widget
 * when tagged, otherwise the AG Grid renderer called with the minimal params
 * the schema renderers read (`value`, `schemaColumn`, `fieldType`, `data`).
 */
export function resolveRendererWidget(renderer: unknown): AnyRendererWidget | undefined {
  if (!renderer || typeof renderer !== "function") return undefined;
  const tagged = (renderer as Tagged<AnyRendererWidget>)[WIDGET];
  if (tagged) return tagged;
  const cached = rendererCache.get(renderer);
  if (cached) return cached;
  const Grid = renderer as ComponentType<Record<string, unknown>>;
  function GridRendererWidget({ value, column, row, fieldType }: UiRendererProps) {
    return createElement(Grid, {
      value,
      data: row,
      schemaColumn: column,
      fieldType: coreFieldTypes().get(fieldType),
      valueFormatted: null,
    });
  }
  rendererCache.set(renderer, GridRendererWidget);
  return GridRendererWidget;
}

// ---------------------------------------------------------------------------
// Editor adapters
// ---------------------------------------------------------------------------

/** Wraps a widget as an in-cell AG Grid editor (text, number, checkbox, …). */
export function toInlineGridEditor(widget: AnyEditorWidget): GridEditor {
  function MantineInlineEditor(props: CustomCellEditorProps<GridRow> & SchemaExtras) {
    const cancelled = useRef(false);
    const latest = useRef<unknown>(props.value ?? null);
    const propsRef = useRef(props);
    propsRef.current = props;
    useGridCellEditor({ isCancelAfterEnd: () => cancelled.current });
    const column = props.schemaColumn ?? FALLBACK_COLUMN;
    const onChange = useCallback((v: unknown) => {
      latest.current = v;
      propsRef.current.onValueChange(v);
    }, []);
    const onCommit = useCallback((v?: unknown) => {
      if (v !== undefined) {
        latest.current = v;
        propsRef.current.onValueChange(v);
      }
      cancelled.current = false;
      propsRef.current.stopEditing();
    }, []);
    const onCancel = useCallback(() => {
      cancelled.current = true;
      const p = propsRef.current;
      p.onValueChange(p.initialValue);
      p.api.stopEditing(true);
    }, []);
    return createElement(widget, {
      value: props.value ?? null,
      onChange,
      onCommit,
      onCancel,
      column,
      config: column.config,
      autoFocus: true,
      ...contextExtras(props.context, props.schemaColumn),
    });
  }
  MantineInlineEditor.displayName = `GridEditor(${widget.displayName ?? widget.name ?? "Widget"})`;
  return tag(MantineInlineEditor, widget);
}

/** Inner component for `createPopupEditor`: maps `PopupEditorInnerProps` onto the widget. */
function popupInner(widget: AnyEditorWidget): ComponentType<PopupEditorInnerProps<GridRow, unknown>> {
  function MantinePopupInner(props: PopupEditorInnerProps<GridRow, unknown>) {
    const latest = useRef<unknown>(props.value);
    latest.current = props.value;
    const column = props.schemaColumn ?? FALLBACK_COLUMN;
    const { onChange, commit, cancel } = props;
    const handleChange = useCallback(
      (v: unknown) => {
        latest.current = v;
        onChange(v);
      },
      [onChange],
    );
    const handleCommit = useCallback((v?: unknown) => commit(v !== undefined ? v : (latest.current ?? null)), [commit]);
    return createElement(widget, {
      value: props.value,
      onChange: handleChange,
      onCommit: handleCommit,
      onCancel: cancel,
      column,
      config: column.config,
      autoFocus: true,
      ...contextExtras(props.editorProps.context, props.schemaColumn),
    });
  }
  MantinePopupInner.displayName = `PopupInner(${widget.displayName ?? widget.name ?? "Widget"})`;
  return MantinePopupInner;
}

/** Wraps a widget as an AG Grid popup editor (dropdowns render inside the popup layer). */
export function toPopupGridEditor(widget: AnyEditorWidget, opts: CreatePopupEditorOptions = {}): PopupEditorEntry<GridRow> {
  const entry = createPopupEditor<unknown, GridRow>(popupInner(widget), opts);
  tag(entry.component, widget);
  return tag(entry, widget);
}

export type WidgetEntry = {
  renderer?: AnyRendererWidget;
  editor?: AnyEditorWidget | null;
  /** Render the editor in AG Grid's popup layer. */
  popup?: boolean;
  popupPosition?: "over" | "under";
};

/** Converts widget overrides into AG Grid `UiFieldType` partials. `editor: null` removes the editor. */
export function widgetsToUiFieldType(entry: WidgetEntry): Partial<UiFieldType<GridRow>> {
  const out: Partial<UiFieldType<GridRow>> = {};
  if (entry.renderer) out.renderer = toGridRenderer(entry.renderer);
  if (entry.editor === null) {
    out.editor = undefined;
    out.editorPopup = undefined;
  } else if (entry.editor) {
    if (entry.popup) {
      const popup = toPopupGridEditor(entry.editor, { position: entry.popupPosition ?? "over" });
      out.editor = popup.component;
      out.editorPopup = true;
      out.editorPopupPosition = popup.cellEditorPopupPosition;
    } else {
      out.editor = toInlineGridEditor(entry.editor);
      out.editorPopup = false;
    }
  }
  return out;
}

/** `registry.extend(...)` with ui-mantine widgets instead of AG Grid components. */
export function extendWithWidgets(
  registry: UiFieldTypeRegistry<GridRow>,
  overrides: Partial<Record<FieldTypeId, WidgetEntry>>,
): UiFieldTypeRegistry<GridRow> {
  const partials: Partial<Record<FieldTypeId, Partial<UiFieldType<GridRow>>>> = {};
  for (const [id, entry] of Object.entries(overrides)) {
    if (entry) partials[id] = widgetsToUiFieldType(entry);
  }
  return registry.extend(partials);
}

// ---------------------------------------------------------------------------
// Filter value inputs (filter builder)
// ---------------------------------------------------------------------------

const noop = () => {};
const filterInputCache = new WeakMap<object, ComponentType<UiFilterInputProps>>();

/**
 * The inline value-input variant of an editor widget, for the filter builder:
 * no commit/cancel semantics, never grabs focus or auto-opens
 * (`autoFocus: false`), and the column's own config. Cached per widget so the
 * returned component identity is stable across renders.
 */
export function toFilterInput(widget: AnyEditorWidget): ComponentType<UiFilterInputProps> {
  const cached = filterInputCache.get(widget);
  if (cached) return cached;
  function FilterInput({ column, value, onChange, dataSource }: UiFilterInputProps) {
    return createElement(widget, {
      value: value ?? null,
      onChange,
      onCommit: (v?: unknown) => {
        if (v !== undefined) onChange(v);
      },
      onCancel: noop,
      column,
      config: column.config,
      dataSource,
      autoFocus: false,
    });
  }
  FilterInput.displayName = `FilterInput(${widget.displayName ?? widget.name ?? "Widget"})`;
  filterInputCache.set(widget, FilterInput);
  return FilterInput;
}

/**
 * Filter-builder value input for a field type: derived from the registry
 * editor's ui-mantine widget. AG Grid's own `filterComponent` is a whole
 * column filter (model = core `FilterCondition`), not a value input, so it is
 * not used here. Undefined when the registry editor is not a ui-mantine widget.
 */
export function filterInputFor(registry: UiFieldTypeRegistry<GridRow>, type: FieldTypeId): ComponentType<UiFilterInputProps> | undefined {
  const widget = resolveEditorComponent(registry.get(type).editor);
  return widget ? toFilterInput(widget) : undefined;
}

export type { GridEditor, GridRenderer };
