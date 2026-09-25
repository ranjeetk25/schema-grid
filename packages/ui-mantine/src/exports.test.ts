import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("subpath exports", () => {
  it("./editors exposes editors, renderers and the registry", async () => {
    const m = await import("@ranjeetk25/schema-grid-ui-mantine/editors");
    for (const name of ["createMantineUiRegistry", "SelectEditor", "SelectPopupEditor", "SelectRenderer", "FormulaRenderer"]) {
      expect(m, name).toHaveProperty(name);
    }
  });

  it("./filter-builder exposes the builder, chips and button", async () => {
    const m = await import("@ranjeetk25/schema-grid-ui-mantine/filter-builder");
    for (const name of ["FilterBuilder", "FilterChips", "FilterButton", "toDraft", "fromDraft"]) expect(m, name).toHaveProperty(name);
  });

  it("./column-builder exposes the modal and ZodForm", async () => {
    const m = await import("@ranjeetk25/schema-grid-ui-mantine/column-builder");
    for (const name of ["ColumnBuilderModal", "ZodForm", "FormulaEditor", "introspectZod"]) expect(m, name).toHaveProperty(name);
  });

  it("./import-export exposes the wizard and export dialog", async () => {
    const m = await import("@ranjeetk25/schema-grid-ui-mantine/import-export");
    for (const name of ["ImportWizard", "ExportDialog"]) expect(m, name).toHaveProperty(name);
  });

  it("root exposes everything", async () => {
    const m = await import("@ranjeetk25/schema-grid-ui-mantine");
    for (const name of [
      "createMantineUiRegistry",
      "FilterBuilder",
      "FilterChips",
      "FilterButton",
      "ColumnBuilderModal",
      "ZodForm",
      "ImportWizard",
      "ExportDialog",
      "ViewSwitcher",
      "GroupByBar",
      "ConflictPopover",
      "RemoteChangedBadge",
      "useGridThemeFromMantine",
      "notifyClipboardReport",
      "useMantineConflictPrompt",
      "MantineHeaderMenu",
      "MantineConditionFilter",
      "MantineSetFilter",
      "schemaGridCssVariables",
      "LiveFilterController",
      "shouldApplyLive",
      "ColumnTypeIcon",
    ]) {
      expect(m, name).toHaveProperty(name);
    }
  });
});

describe("SCHEMA_GRID_UI_MANTINE_VERSION", () => {
  it("equals the package.json version (injected via tsup/vitest `define`)", async () => {
    const { version } = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")) as { version: string };
    const mod = await import("./index");
    expect(mod.SCHEMA_GRID_UI_MANTINE_VERSION).toBe(version);
  });
});
