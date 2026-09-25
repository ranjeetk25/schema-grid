import { describe, expect, it } from "vitest";
import { BooleanEditor } from "../editors/BooleanEditor";
import { MultiSelectEditor } from "../editors/MultiSelectEditor";
import { SelectEditor } from "../editors/SelectEditor";
import { TextEditor } from "../editors/TextEditor";
import { createDefaultRegistry } from "../internal/core-contracts";
import { createDefaultUiRegistry, resolveEditorComponent, resolveRendererWidget } from "../internal/grid-contracts";
import { BooleanRenderer } from "../renderers/BooleanRenderer";
import { SelectRenderer } from "../renderers/SelectRenderer";
import { ShadcnConditionFilter } from "./ShadcnConditionFilter";
import { ShadcnSetFilter } from "./ShadcnSetFilter";
import { POPUP_FIELD_TYPES, createShadcnUiRegistry, shadcnWidgetEntries } from "./createShadcnUiRegistry";

describe("createShadcnUiRegistry", () => {
  const ui = createShadcnUiRegistry();
  const ids = createDefaultRegistry()
    .list()
    .map((t) => t.id);

  it("registers a ui-shadcn renderer for every built-in type", () => {
    expect(ids).toHaveLength(16);
    for (const id of ids) {
      expect(ui.has(id), id).toBe(true);
      expect(resolveRendererWidget(ui.get(id).renderer), id).toBeTypeOf("function");
    }
    expect(resolveRendererWidget(ui.get("select").renderer)).toBe(SelectRenderer);
  });

  it("leaves boolean cells to ag-grid's in-place toggle renderer (never an opened editor)", () => {
    expect(ui.get("boolean").renderer).toBe(createDefaultUiRegistry().get("boolean").renderer);
    expect(resolveRendererWidget(ui.get("boolean").renderer)).not.toBe(BooleanRenderer);
  });

  it("registers a ui-shadcn editor for every type except formula", () => {
    for (const id of ids) {
      if (id === "formula") expect(ui.get(id).editor).toBeUndefined();
      else expect(resolveEditorComponent(ui.get(id).editor), id).toBeTypeOf("function");
    }
    expect(resolveEditorComponent(ui.get("select").editor)).toBe(SelectEditor);
    expect(resolveEditorComponent(ui.get("multiSelect").editor)).toBe(MultiSelectEditor);
    expect(resolveEditorComponent(ui.get("boolean").editor)).toBe(BooleanEditor);
  });

  it("marks exactly the popup set as AG Grid popup editors (boolean stays inline)", () => {
    expect([...POPUP_FIELD_TYPES].sort()).toEqual(
      ["creatableSelect", "date", "datetime", "link", "longText", "multiSelect", "select", "user"].sort(),
    );
    for (const id of ids) {
      if (id === "formula") continue;
      expect(ui.get(id).editorPopup === true, id).toBe(POPUP_FIELD_TYPES.has(id));
    }
    expect(ui.get("boolean").editorPopup).toBe(false);
  });

  it("registers Radix column filters for every type: set filter for option-likes, condition filter elsewhere", () => {
    for (const id of ids) {
      const expected = ["select", "multiSelect", "user", "boolean"].includes(id) ? ShadcnSetFilter : ShadcnConditionFilter;
      expect(ui.get(id).filterComponent, id).toBe(expected);
    }
  });

  it("keeps ag-grid's default floating filters", () => {
    const defaults = createDefaultUiRegistry();
    for (const id of ids) expect(ui.get(id).floatingFilter, id).toBe(defaults.get(id).floatingFilter);
  });

  it("is built on the real registry: unknown ids fall back to text, extend returns a new registry", () => {
    expect(resolveEditorComponent(ui.get("myCustomType").editor)).toBe(TextEditor);
    const ext = ui.extend({ select: { editorPopup: false } });
    expect(ext).not.toBe(ui);
    expect(ui.get("select").editorPopup).toBe(true);
  });

  it("accepts widget and raw AG Grid overrides", () => {
    const Custom = () => null;
    const custom = createShadcnUiRegistry({ widgets: { select: { renderer: Custom } } });
    expect(resolveRendererWidget(custom.get("select").renderer)).toBe(Custom);
    expect(resolveEditorComponent(custom.get("select").editor)).toBe(SelectEditor);
    const RawRenderer = () => null;
    const raw = createShadcnUiRegistry({ overrides: { select: { renderer: RawRenderer } } });
    expect(raw.get("select").renderer).toBe(RawRenderer);
    const RawFilter = () => null;
    const rawFilter = createShadcnUiRegistry({ overrides: { number: { filterComponent: RawFilter } } });
    expect(rawFilter.get("number").filterComponent).toBe(RawFilter);
  });

  it("a replaced boolean editor widget goes through the plain inline adapter", () => {
    const Custom = () => null;
    const custom = createShadcnUiRegistry({ widgets: { boolean: { editor: Custom } } });
    expect(resolveEditorComponent(custom.get("boolean").editor)).toBe(Custom);
  });

  it("exposes the widget set before adaptation", () => {
    const entries = shadcnWidgetEntries();
    expect(entries.formula?.editor).toBeNull();
    expect(entries.select?.popup).toBe(true);
    expect(entries.text?.popup).toBe(false);
  });
});
