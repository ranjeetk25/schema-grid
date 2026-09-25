import { describe, expect, it } from "vitest";
import { MultiSelectEditor } from "../editors/MultiSelectEditor";
import { SelectEditor } from "../editors/SelectEditor";
import { TextEditor } from "../editors/TextEditor";
import { createDefaultRegistry } from "../internal/core-contracts";
import { createDefaultUiRegistry, resolveEditorComponent, resolveRendererWidget } from "../internal/grid-contracts";
import { SelectRenderer } from "../renderers/SelectRenderer";
import { POPUP_FIELD_TYPES, createMantineUiRegistry } from "./createMantineUiRegistry";

describe("createMantineUiRegistry", () => {
  const ui = createMantineUiRegistry();
  const ids = createDefaultRegistry()
    .list()
    .map((t) => t.id);

  it("registers a ui-mantine renderer for every built-in type", () => {
    expect(ids).toHaveLength(16);
    for (const id of ids) {
      expect(ui.has(id), id).toBe(true);
      expect(resolveRendererWidget(ui.get(id).renderer), id).toBeTypeOf("function");
    }
    expect(resolveRendererWidget(ui.get("select").renderer)).toBe(SelectRenderer);
  });

  it("registers a ui-mantine editor for every type except formula", () => {
    for (const id of ids) {
      if (id === "formula") expect(ui.get(id).editor).toBeUndefined();
      else expect(resolveEditorComponent(ui.get(id).editor), id).toBeTypeOf("function");
    }
    expect(resolveEditorComponent(ui.get("select").editor)).toBe(SelectEditor);
    expect(resolveEditorComponent(ui.get("multiSelect").editor)).toBe(MultiSelectEditor);
  });

  it("marks exactly the popup set as AG Grid popup editors", () => {
    expect([...POPUP_FIELD_TYPES].sort()).toEqual(
      ["creatableSelect", "date", "datetime", "link", "longText", "multiSelect", "select", "user"].sort(),
    );
    for (const id of ids) {
      if (id === "formula") continue;
      expect(ui.get(id).editorPopup === true, id).toBe(POPUP_FIELD_TYPES.has(id));
    }
  });

  it("keeps ag-grid's default column filters", () => {
    const defaults = createDefaultUiRegistry();
    for (const id of ids) {
      expect(ui.get(id).filterComponent, id).toBe(defaults.get(id).filterComponent);
      expect(ui.get(id).floatingFilter, id).toBe(defaults.get(id).floatingFilter);
    }
  });

  it("is built on the real registry: unknown ids fall back to text, extend returns a new registry", () => {
    expect(resolveEditorComponent(ui.get("myCustomType").editor)).toBe(TextEditor);
    const ext = ui.extend({ select: { editorPopup: false } });
    expect(ext).not.toBe(ui);
    expect(ui.get("select").editorPopup).toBe(true);
  });

  it("accepts widget and raw AG Grid overrides", () => {
    const Custom = () => null;
    const custom = createMantineUiRegistry({ widgets: { select: { renderer: Custom } } });
    expect(resolveRendererWidget(custom.get("select").renderer)).toBe(Custom);
    expect(resolveEditorComponent(custom.get("select").editor)).toBe(SelectEditor);
    const RawRenderer = () => null;
    const raw = createMantineUiRegistry({ overrides: { select: { renderer: RawRenderer } } });
    expect(raw.get("select").renderer).toBe(RawRenderer);
  });
});
