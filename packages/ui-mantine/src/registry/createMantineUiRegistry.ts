import { mantineFilterComponentFor } from "../column-filters";
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
import {
  BUILTIN_FIELD_TYPE_IDS,
  type FieldTypeId,
  type FieldTypeRegistry,
  type GridRow,
  createDefaultRegistry,
} from "../internal/core-contracts";
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
import { BooleanRenderer } from "../renderers/BooleanRenderer";

/** Types whose editor renders in AG Grid's popup layer (dropdown / picker / multi-line / validated contact). */
export const POPUP_FIELD_TYPES: ReadonlySet<FieldTypeId> = new Set([
  "longText",
  "date",
  "datetime",
  "select",
  "multiSelect",
  "creatableSelect",
  "user",
  "link",
  // Validated contact types: the popup card has room for the error message below the input.
  "url",
  "email",
  "phone",
]);

export interface CreateMantineUiRegistryOptions {
  /** Core field types used for `format` in formatted renderers. Defaults to `createDefaultRegistry()`. */
  fieldTypes?: FieldTypeRegistry;
  /** Per-type ui-mantine widget replacements (adapted to AG Grid for you). */
  widgets?: Partial<Record<FieldTypeId, WidgetEntry>>;
  /** Per-type raw AG Grid `UiFieldType` partials, applied last. */
  overrides?: Partial<Record<FieldTypeId, Partial<UiFieldType<GridRow>>>>;
  /**
   * `"mantine"` (default) registers ui-mantine column filters for every
   * built-in type; `"ag-grid"` keeps ag-grid's framework-free defaults.
   */
  columnFilters?: "mantine" | "ag-grid";
}

/** Mantine `filterComponent`s for all built-in types (floating filters stay ag-grid's `FloatingFilter`). */
export function mantineFilterEntries(): Partial<Record<FieldTypeId, Partial<UiFieldType<GridRow>>>> {
  return Object.fromEntries(
    BUILTIN_FIELD_TYPE_IDS.map((id) => [id, { filterComponent: mantineFilterComponentFor(id) as UiFieldType<GridRow>["filterComponent"] }]),
  );
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
    boolean: entry(BooleanEditor, BooleanRenderer),
    date: entry(DateEditor, Formatted, "date"),
    datetime: entry(DateTimeEditor, Formatted, "datetime"),
    select: entry(SelectEditor, SelectRenderer, "select"),
    multiSelect: entry(MultiSelectEditor, MultiSelectRenderer, "multiSelect"),
    creatableSelect: entry(CreatableSelectEditor, SelectRenderer, "creatableSelect"),
    user: entry(UserPickerEditor, UserRenderer, "user"),
    url: entry(UrlEditor, UrlRenderer, "url"),
    email: entry(EmailEditor, Formatted, "email"),
    phone: entry(PhoneEditor, Formatted, "phone"),
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
 * Column filters: every built-in type gets a Mantine `filterComponent`
 * (model = core `FilterCondition`, same semantics as ag-grid's):
 * `MantineSetFilter` (searchable checkbox list, applies on toggle) for
 * select, multiSelect, user and boolean; `MantineConditionFilter` (operator
 * picker + type-aware value + Clear/Apply) for the rest, formula included.
 * Their dropdowns render inside the AG Grid popup (`withinPortal: false`).
 * `floatingFilter` stays ag-grid's `FloatingFilter` (opt-in via the grid's
 * `floatingFilters`). Pass `columnFilters: "ag-grid"` to keep ag-grid's
 * framework-free filters. The FilterBuilder derives its value inputs from the
 * editor widgets instead (`filterInputFor`).
 */
export function createMantineUiRegistry(options: CreateMantineUiRegistryOptions = {}): UiFieldTypeRegistry<GridRow> {
  const widgets = mantineWidgetEntries(options.fieldTypes);
  for (const [id, entry] of Object.entries(options.widgets ?? {})) {
    if (entry) widgets[id] = { ...widgets[id], ...entry };
  }
  let registry = extendWithWidgets(createDefaultUiRegistry<GridRow>(), widgets);
  if ((options.columnFilters ?? "mantine") === "mantine") registry = registry.extend(mantineFilterEntries());
  return options.overrides ? registry.extend(options.overrides) : registry;
}
