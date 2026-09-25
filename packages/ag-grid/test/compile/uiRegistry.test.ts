import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { BUILT_IN_FIELD_TYPE_IDS, createDefaultRegistry, type FieldTypeId } from "../../src/internal/core";
import { createDefaultUiRegistry, createUiFieldTypeRegistry, resolveExportFormat, type UiFieldType } from "../../src/compile/uiRegistry";
import { col } from "../fixtures/schema";

describe("createDefaultUiRegistry", () => {
  it("has an entry for each of the 16 built-in ids, including formula", () => {
    const ui = createDefaultUiRegistry();
    for (const id of BUILT_IN_FIELD_TYPE_IDS) {
      expect(ui.has(id)).toBe(true);
      expect(ui.get(id).renderer).toBeTruthy();
    }
    expect(ui.has("formula")).toBe(true);
    expect(ui.list().sort()).toEqual([...BUILT_IN_FIELD_TYPE_IDS].sort());
  });

  it("falls back to the text renderer for an unknown custom id", () => {
    const ui = createDefaultUiRegistry();
    const textEntry = ui.get("text");
    const custom = ui.get("myCustomType" as FieldTypeId);
    expect(custom.renderer).toBe(textEntry.renderer);
    expect(ui.has("myCustomType" as FieldTypeId)).toBe(false);
  });

  it("exportFormat defaults to fieldType.format", () => {
    const registry = createDefaultRegistry();
    const ui = createDefaultUiRegistry();
    const numberFieldType = registry.get("number");
    expect(numberFieldType).toBeDefined();
    const column = col({ id: "score", type: "number", label: "Score" });
    const entry = ui.get("number");
    expect(entry.exportFormat).toBeTruthy();
    const formatted = entry.exportFormat?.(42, column, numberFieldType);
    expect(formatted).toBe(numberFieldType?.format(42, column.config ?? numberFieldType.defaultConfig));
  });

  it("resolveExportFormat falls back to String(value) when there's no fieldType", () => {
    const ui = createDefaultUiRegistry();
    const entry = ui.get("text");
    const column = col({ id: "name", type: "text", label: "Name" });
    // Force the entry to have no exportFormat, to exercise the fallback path.
    const strippedEntry: UiFieldType = { ...entry, exportFormat: undefined };
    expect(resolveExportFormat(strippedEntry, "hi", column, undefined)).toBe("hi");
    expect(resolveExportFormat(strippedEntry, null, column, undefined)).toBe("");
  });
});

describe("UiFieldTypeRegistry.extend", () => {
  it("overrides one type without touching others, keeping the default renderer when only overriding the editor", () => {
    const base = createDefaultUiRegistry();
    const baseTextEntry = base.get("text");
    const baseNumberEntry = base.get("number");

    // biome-ignore lint/suspicious/noExplicitAny: test-only stand-in editor component
    const CustomTextEditor = (() => null) as any;

    const extended = base.extend({
      text: { editor: CustomTextEditor },
    });

    expect(extended).not.toBe(base);
    expect(extended.get("text").editor).toBe(CustomTextEditor);
    expect(extended.get("text").renderer).toBe(baseTextEntry.renderer);
    expect(extended.get("number")).toEqual(baseNumberEntry);
    // The original registry is untouched.
    expect(base.get("text").editor).toBeUndefined();
  });
});

describe("createUiFieldTypeRegistry", () => {
  it("throws a clear error when asked for an id with no text fallback registered", () => {
    const empty = createUiFieldTypeRegistry();
    expect(() => empty.get("text")).toThrow(/text/);
  });
});

describe("default renderers", () => {
  it("renders boolean values as a read-only checkbox", async () => {
    const { BooleanRenderer } = await import("../../src/compile/defaultRenderers");
    const column = col({ id: "active", type: "boolean", label: "Active" });
    render(
      // biome-ignore lint/suspicious/noExplicitAny: minimal ag-grid renderer params stand-in for the test
      (BooleanRenderer as any)({ value: true, schemaColumn: column, fieldType: undefined }),
    );
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox).toBeDisabled();
    expect(checkbox).toHaveAttribute("readonly");
  });

  it("renders multiSelect values as chips using option labels", async () => {
    const { MultiSelectRenderer } = await import("../../src/compile/defaultRenderers");
    const column = col({
      id: "tags",
      type: "multiSelect",
      label: "Tags",
      config: { options: [{ value: "hot", label: "Hot" }, { value: "cold", label: "Cold" }] },
    });
    const { container } = render(
      // biome-ignore lint/suspicious/noExplicitAny: minimal ag-grid renderer params stand-in for the test
      (MultiSelectRenderer as any)({ value: ["hot", "cold"], schemaColumn: column, fieldType: undefined }),
    );
    const chips = container.querySelectorAll(".sg-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0]?.textContent).toBe("Hot");
    expect(chips[1]?.textContent).toBe("Cold");
  });

  it("renders formula errors as #ERROR with the message as a title", async () => {
    const { TextRenderer } = await import("../../src/compile/defaultRenderers");
    const { FormulaError } = await import("../../src/internal/core");
    const column = col({ id: "total", type: "formula", label: "Total" });
    const error = new FormulaError("Division by zero");
    render(
      // biome-ignore lint/suspicious/noExplicitAny: minimal ag-grid renderer params stand-in for the test
      (TextRenderer as any)({ value: error, schemaColumn: column, fieldType: undefined }),
    );
    const node = screen.getByText("#ERROR");
    expect(node).toHaveAttribute("title", "Division by zero");
  });
});
