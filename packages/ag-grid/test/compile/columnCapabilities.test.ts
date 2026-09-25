import type { ColDef, EditableCallbackParams } from "ag-grid-community";
import { describe, expect, it } from "vitest";
import { compileColumns } from "../../src/compile/compileColumns";
import { createDefaultUiRegistry } from "../../src/compile/uiRegistry";
import { type Access, createDefaultRegistry, type GridRow, type GridSchema } from "../../src/internal/core";
import { col, row } from "../fixtures/schema";

const registry = createDefaultRegistry();
const ui = createDefaultUiRegistry();

const schema: GridSchema = {
  id: "caps",
  schemaVersion: 1,
  columns: [
    col({ id: "name", type: "text" }, 0),
    col({ id: "fixedOrder", type: "text", sortable: false }, 1),
    col({ id: "noFilter", type: "select", filterable: false, config: { options: [] } }, 2),
    col({ id: "computed", type: "text", settable: false }, 3),
  ],
};

function byId(defs: ColDef<GridRow>[], id: string): ColDef<GridRow> {
  const d = defs.find((x) => x.colId === id);
  if (!d) throw new Error(`no coldef ${id}`);
  return d;
}

function isEditable(def: ColDef<GridRow>, data: unknown): boolean {
  if (typeof def.editable === "function") return def.editable({ data } as EditableCallbackParams<GridRow>);
  return def.editable === true;
}

// Every column "edit" on purpose: compile must not trust access alone for settable:false.
const access = new Map<string, Access>(schema.columns.map((c) => [c.id, "edit"]));

describe("compileColumns — column capabilities (C1)", () => {
  it("sortable:false → ColDef sortable false; others stay sortable", () => {
    const defs = compileColumns(schema, access, registry, ui);
    expect(byId(defs, "fixedOrder").sortable).toBe(false);
    expect(byId(defs, "name").sortable).toBe(true);
  });

  it("filterable:false → filter false and no floating filter, even with floatingFilters on", () => {
    const defs = compileColumns(schema, access, registry, ui, { floatingFilters: true });
    const def = byId(defs, "noFilter");
    expect(def.filter).toBe(false);
    expect(def.floatingFilter).toBe(false);
    expect(def.floatingFilterComponent).toBeUndefined();
    expect(byId(defs, "name").filter).not.toBe(false);
  });

  it("settable:false → never editable, even when access says edit", () => {
    const defs = compileColumns(schema, access, registry, ui);
    const data = row("r1", { name: "a", computed: "x" });
    expect(isEditable(byId(defs, "computed"), data)).toBe(false);
    expect(isEditable(byId(defs, "name"), data)).toBe(true);
  });
});
