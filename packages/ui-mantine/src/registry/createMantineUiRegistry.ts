import { type ComponentType, createElement } from "react";
import { BooleanEditor } from "../editors/BooleanEditor";
import { EmailEditor, PhoneEditor, UrlEditor } from "../editors/ContactEditors";
import { CreatableSelectEditor, CreatableSelectPopupEditor } from "../editors/CreatableSelectEditor";
import { CurrencyEditor } from "../editors/CurrencyEditor";
import { DateEditor, DatePopupEditor, DateTimeEditor, DateTimePopupEditor } from "../editors/DateEditors";
import { LinkPickerEditor, LinkPickerPopupEditor } from "../editors/LinkPickerEditor";
import { LongTextPopupEditor } from "../editors/LongTextEditor";
import { MultiSelectEditor, MultiSelectPopupEditor } from "../editors/MultiSelectEditor";
import { NumberEditor } from "../editors/NumberEditor";
import { SelectEditor, SelectPopupEditor } from "../editors/SelectEditor";
import { TextEditor } from "../editors/TextEditor";
import { UserPickerEditor, UserPickerPopupEditor } from "../editors/UserPickerEditor";
import { type FieldTypeId, type FieldTypeRegistry, createDefaultRegistry } from "../internal/core-contracts";
import {
  type UiEditorProps,
  type UiFieldTypeEntry,
  type UiFieldTypeRegistry,
  type UiFilterInputProps,
  type UiRendererProps,
  createUiFieldTypeRegistry,
} from "../internal/grid-contracts";
import { createFormattedRenderer } from "../renderers/FormattedRenderer";
import { FormulaRenderer } from "../renderers/FormulaRenderer";
import { MultiSelectRenderer } from "../renderers/MultiSelectRenderer";
import { SelectRenderer } from "../renderers/SelectRenderer";
import { UrlRenderer } from "../renderers/UrlRenderer";
import { UserRenderer } from "../renderers/UserRenderer";

/** Types whose editor is registered through `createPopupEditor` (dropdown/picker/multi-line). */
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

// biome-ignore lint/suspicious/noExplicitAny: adapts heterogeneous editors
type AnyEditor = ComponentType<UiEditorProps<any, any>>;
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous renderers
type AnyRenderer = ComponentType<UiRendererProps<any, any>>;

const noop = () => {};

/**
 * The inline value-input variant of an editor, for filter builders: no
 * commit/cancel semantics, never grabs focus or auto-opens (`autoFocus: false`),
 * and the column's own config.
 */
export function toFilterInput(Editor: AnyEditor): ComponentType<UiFilterInputProps> {
  function FilterInput({ column, value, onChange, dataSource }: UiFilterInputProps) {
    return createElement(Editor, {
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
  FilterInput.displayName = `FilterInput(${Editor.displayName ?? Editor.name ?? "Editor"})`;
  return FilterInput;
}

export interface CreateMantineUiRegistryOptions {
  /** Core field types used for `format` in formatted renderers. Defaults to `createDefaultRegistry()`. */
  fieldTypes?: FieldTypeRegistry;
  /** Per-type replacements, merged over the defaults. */
  overrides?: Partial<Record<FieldTypeId, Partial<UiFieldTypeEntry>>>;
}

/** Mantine renderer/editor/filter widgets for all 16 built-in field types. */
export function createMantineUiRegistry(options: CreateMantineUiRegistryOptions = {}): UiFieldTypeRegistry {
  const Formatted: AnyRenderer = createFormattedRenderer(options.fieldTypes ?? createDefaultRegistry());
  const inline = (editor: AnyEditor, renderer: AnyRenderer = Formatted): UiFieldTypeEntry => ({
    renderer,
    editor,
    filterComponent: toFilterInput(editor),
  });
  const popup = (
    editor: UiFieldTypeEntry["editor"],
    inlineEditor: AnyEditor,
    renderer: AnyRenderer = Formatted,
  ): UiFieldTypeEntry => ({ renderer, editor, filterComponent: toFilterInput(inlineEditor) });

  const entries: Record<string, UiFieldTypeEntry> = {
    text: inline(TextEditor),
    longText: popup(LongTextPopupEditor, TextEditor),
    number: inline(NumberEditor),
    currency: inline(CurrencyEditor),
    boolean: inline(BooleanEditor),
    date: popup(DatePopupEditor, DateEditor),
    datetime: popup(DateTimePopupEditor, DateTimeEditor),
    select: popup(SelectPopupEditor, SelectEditor, SelectRenderer),
    multiSelect: popup(MultiSelectPopupEditor, MultiSelectEditor, MultiSelectRenderer),
    creatableSelect: popup(CreatableSelectPopupEditor, CreatableSelectEditor, SelectRenderer),
    user: popup(UserPickerPopupEditor, UserPickerEditor, UserRenderer),
    url: inline(UrlEditor, UrlRenderer),
    email: inline(EmailEditor),
    phone: inline(PhoneEditor),
    link: popup(LinkPickerPopupEditor, LinkPickerEditor),
    // Formula columns are read-only: renderer only (filter values use a text input).
    formula: { renderer: FormulaRenderer, filterComponent: toFilterInput(TextEditor) },
  };

  const registry = createUiFieldTypeRegistry(Object.entries(entries));
  return options.overrides ? registry.extend(options.overrides) : registry;
}
