import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../internal/core-contracts";
import { isPopupEditor } from "../internal/grid-contracts";
import { SelectRenderer } from "../renderers/SelectRenderer";
import { POPUP_FIELD_TYPES, createMantineUiRegistry } from "./createMantineUiRegistry";

describe("createMantineUiRegistry", () => {
  const ui = createMantineUiRegistry();
  const ids = createDefaultRegistry()
    .list()
    .map((t) => t.id);

  it("registers a renderer and filter component for every built-in type", () => {
    expect(ids).toHaveLength(16);
    for (const id of ids) {
      expect(ui.get(id)?.renderer, id).toBeTypeOf("function");
      expect(ui.get(id)?.filterComponent, id).toBeTypeOf("function");
    }
  });

  it("registers an editor for every type except formula", () => {
    for (const id of ids) {
      if (id === "formula") expect(ui.get(id)?.editor).toBeUndefined();
      else expect(ui.get(id)?.editor, id).toBeDefined();
    }
  });

  it("marks exactly the popup set as popup editors", () => {
    expect([...POPUP_FIELD_TYPES].sort()).toEqual(
      ["creatableSelect", "date", "datetime", "link", "longText", "multiSelect", "select", "user"].sort(),
    );
    for (const id of ids) {
      if (id === "formula") continue;
      expect(isPopupEditor(ui.get(id)?.editor), id).toBe(POPUP_FIELD_TYPES.has(id));
    }
  });

  it("uses the select renderer by default and accepts overrides", () => {
    expect(ui.get("select")?.renderer).toBe(SelectRenderer);
    const Custom = () => null;
    const custom = createMantineUiRegistry({ overrides: { select: { renderer: Custom } } });
    expect(custom.get("select")?.renderer).toBe(Custom);
    expect(custom.get("select")?.editor).toBe(ui.get("select")?.editor);
  });
});
