import type { ComponentType } from "react";
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
  type CustomFilterProps,
  type UiFieldType,
  type UiFieldTypeRegistry,
  type WidgetEntry,
  createDefaultUiRegistry,
  extendWithWidgets,
  toInlineToggleGridEditor,
} from "../internal/grid-contracts";
import { BooleanRenderer } from "../renderers/BooleanRenderer";
import { createFormattedRenderer } from "../renderers/FormattedRenderer";
import { FormulaRenderer } from "../renderers/FormulaRenderer";
import { MultiSelectRenderer } from "../renderers/MultiSelectRenderer";
import { SelectRenderer } from "../renderers/SelectRenderer";
import { UrlRenderer } from "../renderers/UrlRenderer";
import { UserRenderer } from "../renderers/UserRenderer";
import { ShadcnConditionFilter } from "./ShadcnConditionFilter";
import { ShadcnSetFilter } from "./ShadcnSetFilter";

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

/** Types whose column filter is the searchable checkbox list (`ShadcnSetFilter`). */
const SET_FILTER_TYPES: ReadonlySet<FieldTypeId> = new Set(["select", "multiSelect", "user", "boolean"]);

export interface CreateShadcnUiRegistryOptions {
  /** Core field types used for `format` in formatted renderers. Defaults to `createDefaultRegistry()`. */
  fieldTypes?: FieldTypeRegistry;
  /** Per-type ui-shadcn widget replacements (adapted to AG Grid for you). */
  widgets?: Partial<Record<FieldTypeId, WidgetEntry>>;
  /** Per-type raw AG Grid `UiFieldType` partials, applied last. */
  overrides?: Partial<Record<FieldTypeId, Partial<UiFieldType<GridRow>>>>;
}

/** The built-in widget set, before adaptation. */
export function shadcnWidgetEntries(fieldTypes: FieldTypeRegistry = createDefaultRegistry()): Record<string, WidgetEntry> {
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
    // Inline 16px checkbox — never a popup, never "true/false" text.
    boolean: entry(BooleanEditor as AnyEditorWidget, BooleanRenderer),
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

/** Radix column filters for every built-in type (floating filters stay ag-grid's). */
function shadcnFilterOverrides(ids: readonly FieldTypeId[]): Partial<Record<FieldTypeId, Partial<UiFieldType<GridRow>>>> {
  const out: Partial<Record<FieldTypeId, Partial<UiFieldType<GridRow>>>> = {};
  for (const id of ids) {
    out[id] = {
      filterComponent: (SET_FILTER_TYPES.has(id) ? ShadcnSetFilter : ShadcnConditionFilter) as ComponentType<CustomFilterProps<GridRow>>,
    };
  }
  return out;
}

/**
 * The real `@masai/schema-grid-ag-grid` UI registry with ui-shadcn renderers,
 * editors AND column filters for all 16 built-in types:
 * `createDefaultUiRegistry().extend()` with each widget adapted to AG Grid's
 * cell renderer / editor props (popup types through ag-grid's
 * `createPopupEditor`).
 *
 * Unlike ui-mantine (which keeps ag-grid's filters), every type also gets a
 * Radix `filterComponent` — `ShadcnSetFilter` for select / multiSelect /
 * user / boolean, `ShadcnConditionFilter` elsewhere — emitting the same core
 * `FilterCondition` model as ag-grid's own filters. `floatingFilter` stays
 * ag-grid's default. The boolean editor toggles in place on open.
 */
export function createShadcnUiRegistry(options: CreateShadcnUiRegistryOptions = {}): UiFieldTypeRegistry<GridRow> {
  const widgets = shadcnWidgetEntries(options.fieldTypes);
  for (const [id, entry] of Object.entries(options.widgets ?? {})) {
    if (entry) widgets[id] = { ...widgets[id], ...entry };
  }
  let registry = extendWithWidgets(createDefaultUiRegistry<GridRow>(), widgets);
  const ids = createDefaultRegistry()
    .list()
    .map((t) => t.id);
  const partials = shadcnFilterOverrides(ids);
  // Our own checkbox widget toggles in place (Space / click opens and flips at once).
  if (widgets.boolean?.editor === BooleanEditor) {
    partials.boolean = { ...partials.boolean, editor: toInlineToggleGridEditor(BooleanEditor), editorPopup: false };
  }
  registry = registry.extend(partials);
  return options.overrides ? registry.extend(options.overrides) : registry;
}
