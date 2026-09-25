import type { ComponentType } from "react";
import type { CustomCellEditorProps, CustomCellRendererProps, CustomFilterProps, CustomFloatingFilterProps } from "ag-grid-react";
import { BUILT_IN_FIELD_TYPE_IDS, type ColumnDef, type FieldType, type FieldTypeId, type GridRow } from "../internal/core";
import { DEFAULT_RENDERER_COMPONENTS } from "./defaultRenderers";
import { DEFAULT_EDITORS } from "../editors/defaultEditors";
import { DEFAULT_FILTERS } from "../filters/defaultFilters";

export type { SchemaCellRendererParams } from "./defaultRenderers";

/**
 * The per-field-type UI surface: renderer, editor, filter UI and export
 * formatting. `ui-mantine` (and any other UI package) implements these and
 * hands the result to `ag-grid` through `UiFieldTypeRegistry`/`extend`, so
 * this shape is a cross-package contract — change it deliberately.
 */
export interface UiFieldType<Row extends GridRow = GridRow> {
  renderer: ComponentType<CustomCellRendererProps<Row>>;
  editor?: ComponentType<CustomCellEditorProps<Row>>;
  editorPopup?: boolean;
  editorPopupPosition?: "over" | "under";
  filterComponent?: ComponentType<CustomFilterProps<Row>>;
  floatingFilter?: ComponentType<CustomFloatingFilterProps>;
  exportFormat?(value: unknown, column: ColumnDef, fieldType: FieldType<unknown, unknown> | undefined): string;
}

/** The subset of `UiFieldType` an editor module (e.g. `defaultEditors.ts`) registers per type. */
export type UiEditorEntry<Row extends GridRow = GridRow> = Pick<UiFieldType<Row>, "editor" | "editorPopup" | "editorPopupPosition">;

/** The subset of `UiFieldType` a filter module (e.g. `defaultFilters.ts`) registers per type. */
export type UiFilterEntry<Row extends GridRow = GridRow> = Pick<UiFieldType<Row>, "filterComponent" | "floatingFilter">;

export interface UiFieldTypeRegistry<Row extends GridRow = GridRow> {
  register(id: FieldTypeId, entry: UiFieldType<Row>): void;
  /** Never returns undefined: an unknown/custom id falls back to the "text" entry. */
  get(id: FieldTypeId): UiFieldType<Row>;
  /** True only for ids explicitly registered — does not count the text fallback. */
  has(id: FieldTypeId): boolean;
  list(): FieldTypeId[];
  /**
   * Returns a NEW registry with the given per-type partial overrides merged
   * onto each type's current entry (so overriding just `editor` keeps the
   * default `renderer`, etc). Does not mutate `this`.
   */
  extend(overrides: Partial<Record<FieldTypeId, Partial<UiFieldType<Row>>>>): UiFieldTypeRegistry<Row>;
}

/** Builds a registry from a starting map of entries. Register more via `.register()`, or branch via `.extend()`. */
export function createUiFieldTypeRegistry<Row extends GridRow = GridRow>(
  initial: Partial<Record<FieldTypeId, UiFieldType<Row>>> = {},
): UiFieldTypeRegistry<Row> {
  const map = new Map<FieldTypeId, UiFieldType<Row>>(Object.entries(initial) as [FieldTypeId, UiFieldType<Row>][]);

  const registry: UiFieldTypeRegistry<Row> = {
    register(id, entry) {
      map.set(id, entry);
    },
    get(id) {
      const found = map.get(id);
      if (found) return found;
      const fallback = map.get("text");
      if (!fallback) {
        throw new Error(
          `UiFieldTypeRegistry: no entry registered for "${String(id)}" and no "text" entry to fall back to.`,
        );
      }
      return fallback;
    },
    has(id) {
      return map.has(id);
    },
    list() {
      return [...map.keys()];
    },
    extend(overrides) {
      const merged: Partial<Record<FieldTypeId, UiFieldType<Row>>> = Object.fromEntries(map) as Partial<Record<FieldTypeId, UiFieldType<Row>>>;
      for (const [id, partial] of Object.entries(overrides) as [FieldTypeId, Partial<UiFieldType<Row>> | undefined][]) {
        if (!partial) continue;
        const base = registry.get(id);
        merged[id] = { ...base, ...partial };
      }
      return createUiFieldTypeRegistry<Row>(merged);
    },
  };
  return registry;
}

/** Default `exportFormat`: delegates to `fieldType.format`, falling back to `String(value)` with no field type. */
function defaultExportFormat(value: unknown, column: ColumnDef, fieldType: FieldType<unknown, unknown> | undefined): string {
  if (!fieldType) return value == null ? "" : String(value);
  return fieldType.format(value as never, (column.config ?? fieldType.defaultConfig) as never);
}

/**
 * Resolves a cell's export text: `entry.exportFormat` when set, else the same
 * default `createDefaultUiRegistry` entries use. Safe to call even on a
 * custom entry that never set `exportFormat`.
 */
export function resolveExportFormat<Row extends GridRow = GridRow>(
  entry: UiFieldType<Row>,
  value: unknown,
  column: ColumnDef,
  fieldType: FieldType<unknown, unknown> | undefined,
): string {
  if (entry.exportFormat) return entry.exportFormat(value, column, fieldType);
  return defaultExportFormat(value, column, fieldType);
}

/**
 * Renderers in `defaultRenderers.tsx` only read `props.value`/`.column`/`.fieldType`,
 * so they're safe for any `Row` shape — this cast is the one place that widens them.
 */
function rendererFor<Row extends GridRow>(component: ComponentType<CustomCellRendererProps<GridRow>>): ComponentType<CustomCellRendererProps<Row>> {
  return component as unknown as ComponentType<CustomCellRendererProps<Row>>;
}

function editorFor<Row extends GridRow>(
  component: ComponentType<CustomCellEditorProps<GridRow>> | undefined,
): ComponentType<CustomCellEditorProps<Row>> | undefined {
  return component as unknown as ComponentType<CustomCellEditorProps<Row>> | undefined;
}

function filterFor<Row extends GridRow>(
  component: ComponentType<CustomFilterProps<GridRow>> | undefined,
): ComponentType<CustomFilterProps<Row>> | undefined {
  return component as unknown as ComponentType<CustomFilterProps<Row>> | undefined;
}

/** Merges the default renderers with `DEFAULT_EDITORS` (T17) and `DEFAULT_FILTERS` (T19) — one entry per built-in id. */
export function createDefaultUiRegistry<Row extends GridRow = GridRow>(): UiFieldTypeRegistry<Row> {
  const initial: Partial<Record<FieldTypeId, UiFieldType<Row>>> = {};
  for (const id of BUILT_IN_FIELD_TYPE_IDS) {
    const editorEntry = DEFAULT_EDITORS[id];
    const filterEntry = DEFAULT_FILTERS[id];
    initial[id] = {
      renderer: rendererFor<Row>(DEFAULT_RENDERER_COMPONENTS[id]),
      editor: editorFor<Row>(editorEntry?.editor as ComponentType<CustomCellEditorProps<GridRow>> | undefined),
      editorPopup: editorEntry?.editorPopup,
      editorPopupPosition: editorEntry?.editorPopupPosition,
      filterComponent: filterFor<Row>(filterEntry?.filterComponent as ComponentType<CustomFilterProps<GridRow>> | undefined),
      floatingFilter: filterEntry?.floatingFilter as ComponentType<CustomFloatingFilterProps> | undefined,
      exportFormat: defaultExportFormat,
    };
  }
  return createUiFieldTypeRegistry<Row>(initial);
}
