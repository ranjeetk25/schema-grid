/**
 * ag-grid adapter. The ONLY file in ui-mantine allowed to import from
 * `@masai/schema-grid-ag-grid`.
 *
 * `@masai/schema-grid-ag-grid` is being built concurrently and currently only
 * exports a placeholder, so each symbol here is a local minimal fallback
 * marked `TODO(ag-grid)`. Once ag-grid ships them, delete the fallback and
 * re-export the real symbol. Dependency direction: ui-mantine → ag-grid,
 * never the reverse.
 */
import type { ComponentType } from "react";
import type { ColumnDef, DataSource, FieldTypeId, FilterOperatorDef, GridRow, Option } from "./core-contracts";

// ---------------------------------------------------------------------------
// Widget prop contracts (owned by ui-mantine, consumed by the ag-grid bridge)
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
type AnyEditorProps = UiEditorProps<any, any>;
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous widget registry
type AnyRendererProps = UiRendererProps<any, any>;
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous widget registry
type AnyFilterInputProps = UiFilterInputProps<any>;

// ---------------------------------------------------------------------------
// createPopupEditor
// TODO(ag-grid): replace with real export — createPopupEditor, PopupEditor, isPopupEditor
// ---------------------------------------------------------------------------

export const POPUP_EDITOR_MARKER = "__schemaGridPopupEditor" as const;

export interface PopupEditor<P = AnyEditorProps> {
  component: ComponentType<P>;
  cellEditorPopup: true;
  isPopup: true;
  [POPUP_EDITOR_MARKER]: true;
}

/** Marks an editor to render in AG Grid's popup layer (not clipped by the cell). */
export function createPopupEditor<P>(component: ComponentType<P>): PopupEditor<P> {
  return { component, cellEditorPopup: true, isPopup: true, [POPUP_EDITOR_MARKER]: true };
}

export function isPopupEditor(value: unknown): value is PopupEditor {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>)[POPUP_EDITOR_MARKER] === true;
}

export type UiEditorEntry = ComponentType<AnyEditorProps> | PopupEditor<AnyEditorProps>;

/** Unwraps a popup editor to its plain component (for inline use in forms). */
export function resolveEditorComponent(editor: UiEditorEntry | undefined): ComponentType<AnyEditorProps> | undefined {
  if (!editor) return undefined;
  return isPopupEditor(editor) ? editor.component : editor;
}

// ---------------------------------------------------------------------------
// UiFieldTypeRegistry
// TODO(ag-grid): replace with real export — UiFieldTypeRegistry, UiFieldTypeEntry,
// createUiFieldTypeRegistry
// ---------------------------------------------------------------------------

export interface UiFieldTypeEntry {
  renderer?: ComponentType<AnyRendererProps>;
  editor?: UiEditorEntry;
  filterComponent?: ComponentType<AnyFilterInputProps>;
}

export interface UiFieldTypeRegistry {
  register(id: FieldTypeId, entry: UiFieldTypeEntry): void;
  get(id: FieldTypeId): UiFieldTypeEntry | undefined;
  has(id: FieldTypeId): boolean;
  list(): FieldTypeId[];
  /** Returns a NEW registry with `entries` merged over this one's (per key). */
  extend(entries: Partial<Record<FieldTypeId, UiFieldTypeEntry>>): UiFieldTypeRegistry;
}

export function createUiFieldTypeRegistry(initial?: Iterable<[FieldTypeId, UiFieldTypeEntry]>): UiFieldTypeRegistry {
  const map = new Map<FieldTypeId, UiFieldTypeEntry>(initial);
  const registry: UiFieldTypeRegistry = {
    register: (id, entry) => {
      map.set(id, entry);
    },
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    list: () => [...map.keys()],
    extend: (entries) => {
      const next = createUiFieldTypeRegistry(map);
      for (const [id, entry] of Object.entries(entries)) {
        if (entry) next.register(id, { ...map.get(id), ...entry });
      }
      return next;
    },
  };
  return registry;
}

// ---------------------------------------------------------------------------
// Clipboard + conflict contracts
// TODO(ag-grid): replace with real export — ClipboardReport, ConflictResolution
// ---------------------------------------------------------------------------

export interface ClipboardReportError {
  rowId?: string;
  columnId?: string;
  message: string;
}

export interface ClipboardReport {
  pastedCells: number;
  skippedReadOnly: number;
  errors: ClipboardReportError[];
}

export type ConflictResolution = "keepTheirs" | "overwrite";
