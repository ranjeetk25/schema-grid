import { BooleanEditor } from "../editors/BooleanEditor";
import { EmailEditor, PhoneEditor, UrlEditor } from "../editors/ContactEditors";
import { CreatableSelectEditor } from "../editors/CreatableSelectEditor";
import { CurrencyEditor } from "../editors/CurrencyEditor";
import { DateEditor, DateTimeEditor } from "../editors/DateEditors";
import { LinkPickerEditor } from "../editors/LinkPickerEditor";
import { LongTextEditor } from "../editors/LongTextEditor";
import { MultiSelectEditor } from "../editors/MultiSelectEditor";
import { NumberEditor } from "../editors/NumberEditor";
import { SelectEditor } from "../editors/SelectEditor";
import { TextEditor } from "../editors/TextEditor";
import { UserPickerEditor } from "../editors/UserPickerEditor";
import { type FieldTypeId, type FieldTypeRegistry, type GridRow, createDefaultRegistry } from "../internal/core-contracts";
import {
  type AnyEditorWidget,
  type AnyRendererWidget,
  type UiFieldType,
  type UiFieldTypeRegistry,
  type WidgetEntry,
  createDefaultUiRegistry,
  extendWithWidgets,
} from "../internal/grid-contracts";
import { createFormattedRenderer } from "../renderers/FormattedRenderer";
import { FormulaRenderer } from "../renderers/FormulaRenderer";
import { MultiSelectRenderer } from "../renderers/MultiSelectRenderer";
import { SelectRenderer } from "../renderers/SelectRenderer";
import { UrlRenderer } from "../renderers/UrlRenderer";
import { UserRenderer } from "../renderers/UserRenderer";

/** Types whose editor renders in AG Grid's popup layer (dropdown / picker / multi-line). */
export const POPUP_FIELD_TYPES: ReadonlySet<FieldTypeId> = new Set([
  "longText",
  "date",
  "datetime",
  "select",
  "multiSelect",
  "creatableSelect",
  "user",
  "link",
]);

export interface CreateMantineUiRegistryOptions {
  /** Core field types used for `format` in formatted renderers. Defaults to `createDefaultRegistry()`. */
  fieldTypes?: FieldTypeRegistry;
  /** Per-type ui-mantine widget replacements (adapted to AG Grid for you). */
  widgets?: Partial<Record<FieldTypeId, WidgetEntry>>;
  /** Per-type raw AG Grid `UiFieldType` partials, applied last. */
  overrides?: Partial<Record<FieldTypeId, Partial<UiFieldType<GridRow>>>>;
}

/** The built-in widget set, before adaptation. */
export function mantineWidgetEntries(fieldTypes: FieldTypeRegistry = createDefaultRegistry()): Record<string, WidgetEntry> {
  const Formatted: AnyRendererWidget = createFormattedRenderer(fieldTypes);
  const entry = (editor: AnyEditorWidget, renderer: AnyRendererWidget = Formatted, id?: string): WidgetEntry => ({
    renderer,
    editor,
    popup: id ? POPUP_FIELD_TYPES.has(id) : false,
  });
  return {
    text: entry(TextEditor),
    longText: entry(LongTextEditor, Formatted, "longText"),
    number: entry(NumberEditor),
    currency: entry(CurrencyEditor),
    boolean: entry(BooleanEditor),
    date: entry(DateEditor, Formatted, "date"),
    datetime: entry(DateTimeEditor, Formatted, "datetime"),
    select: entry(SelectEditor, SelectRenderer, "select"),
    multiSelect: entry(MultiSelectEditor, MultiSelectRenderer, "multiSelect"),
    creatableSelect: entry(CreatableSelectEditor, SelectRenderer, "creatableSelect"),
    user: entry(UserPickerEditor, UserRenderer, "user"),
    url: entry(UrlEditor, UrlRenderer),
    email: entry(EmailEditor),
    phone: entry(PhoneEditor),
    link: entry(LinkPickerEditor, Formatted, "link"),
    // Formula columns are read-only: renderer only.
    formula: { renderer: FormulaRenderer, editor: null },
  };
}

/**
 * The real `@ranjeetk25/schema-grid-ag-grid` UI registry with ui-mantine renderers
 * and editors for all 16 built-in types: `createDefaultUiRegistry().extend()`
 * with each widget adapted to AG Grid's cell renderer / editor props (popup
 * types through ag-grid's `createPopupEditor`).
 *
 * Column filters (`filterComponent` / `floatingFilter`) are left as
 * ag-grid's defaults: their model is a core `FilterCondition`, which
 * ag-grid's `ConditionFilter` already edits. The FilterBuilder derives its
 * value inputs from the editor widgets instead (`filterInputFor`).
 */
export function createMantineUiRegistry(options: CreateMantineUiRegistryOptions = {}): UiFieldTypeRegistry<GridRow> {
  const widgets = mantineWidgetEntries(options.fieldTypes);
  for (const [id, entry] of Object.entries(options.widgets ?? {})) {
    if (entry) widgets[id] = { ...widgets[id], ...entry };
  }
  const registry = extendWithWidgets(createDefaultUiRegistry<GridRow>(), widgets);
  return options.overrides ? registry.extend(options.overrides) : registry;
}
