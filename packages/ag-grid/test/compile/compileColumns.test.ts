import { describe, expect, it, vi } from "vitest";
import type { ColDef, EditableCallbackParams, ValueGetterParams } from "ag-grid-community";
import {
  createDefaultRegistry,
  createRolePermissionResolver,
  isFormulaError,
  resolveColumnAccess,
  type Access,
  type GridRow,
  type GridSchema,
  type ViewDef,
} from "../../src/internal/core";
import { compileColumns } from "../../src/compile/compileColumns";
import { createCellAccess } from "../../src/compile/cellAccess";
import { compileFormulaColumns } from "../../src/compile/formulaColumns";
import { createDefaultUiRegistry } from "../../src/compile/uiRegistry";
import { ADMIN, AGENT, col, fixtureSchema, row } from "../fixtures/schema";

const registry = createDefaultRegistry();
const ui = createDefaultUiRegistry();
const env = { now: new Date("2026-09-25T00:00:00.000Z"), tz: "Asia/Kolkata" };

function getValue(def: ColDef<GridRow>, data: GridRow | undefined): unknown {
  const getter = def.valueGetter as (p: ValueGetterParams<GridRow>) => unknown;
  return getter({ data } as ValueGetterParams<GridRow>);
}

function isEditable(def: ColDef<GridRow>, data: unknown): boolean {
  if (typeof def.editable === "function") return def.editable({ data } as EditableCallbackParams<GridRow>);
  return def.editable === true;
}

function byId(defs: ColDef<GridRow>[], id: string): ColDef<GridRow> {
  const d = defs.find((x) => x.colId === id);
  if (!d) throw new Error(`no coldef ${id}`);
  return d;
}

const adminAccess = resolveColumnAccess(fixtureSchema, createRolePermissionResolver(), ADMIN);
const agentAccess = resolveColumnAccess(fixtureSchema, createRolePermissionResolver(), AGENT);

describe("compileColumns", () => {
  it("omits columns with access hidden", () => {
    const defs = compileColumns(fixtureSchema, agentAccess, registry, ui);
    expect(defs.map((d) => d.colId)).not.toContain("salary");
    expect(defs).toHaveLength(fixtureSchema.columns.length - 1);
  });

  it("sets colId, headerName, no field, sortable, valueSetter false", () => {
    const defs = compileColumns(fixtureSchema, adminAccess, registry, ui);
    const name = byId(defs, "name");
    expect(name.headerName).toBe("Name");
    expect(name.field).toBeUndefined();
    expect(name.sortable).toBe(true);
    const setter = name.valueSetter as () => boolean;
    expect(setter()).toBe(false);
  });

  it("valueGetter reads cells.<key> and guards non-row data", () => {
    const schema: GridSchema = { id: "s", schemaVersion: 1, columns: [col({ id: "c1", key: "firstName", type: "text" })] };
    const defs = compileColumns(schema, new Map<string, Access>([["c1", "edit"]]), registry, ui);
    const def = byId(defs, "c1");
    expect(getValue(def, row("r1", { firstName: "Asha", c1: "wrong" }))).toBe("Asha");
    expect(getValue(def, undefined)).toBeUndefined();
    expect(getValue(def, { id: "g", group: true } as unknown as GridRow)).toBeUndefined();
  });

  it("read columns are not editable", () => {
    const defs = compileColumns(fixtureSchema, agentAccess, registry, ui);
    expect(isEditable(byId(defs, "status"), row("r1", {}))).toBe(false);
  });

  it("edit columns are editable, except where a row-level override returns read", () => {
    const base = createRolePermissionResolver();
    const rowResolver = (ctx: Parameters<typeof base>[0]): Access =>
      ctx.row?.id === "locked" ? "read" : base(ctx);
    const canEditCell = createCellAccess(fixtureSchema, adminAccess, rowResolver, ADMIN);
    const defs = compileColumns(fixtureSchema, adminAccess, registry, ui, { canEditCell });
    const status = byId(defs, "status");
    expect(isEditable(status, row("r1", {}))).toBe(true);
    expect(isEditable(status, row("locked", {}))).toBe(false);
    // no data / non-row data is never editable
    expect(isEditable(status, undefined)).toBe(false);
    expect(isEditable(status, { id: "g" })).toBe(false);
  });

  it("editable without canEditCell defaults to true for edit columns", () => {
    const defs = compileColumns(fixtureSchema, adminAccess, registry, ui);
    expect(isEditable(byId(defs, "name"), row("r1", {}))).toBe(true);
  });

  it("wires renderer/editor/filter from the ui registry with schema params", () => {
    const defs = compileColumns(fixtureSchema, adminAccess, registry, ui);
    const payment = byId(defs, "payment");
    const entry = ui.get("select");
    expect(payment.cellRenderer).toBe(entry.renderer);
    expect(payment.cellEditor).toBe(entry.editor);
    expect(payment.cellEditorPopup).toBe(entry.editorPopup);
    expect(payment.cellEditorPopupPosition).toBe(entry.editorPopupPosition);
    expect(payment.filter).toBe(entry.filterComponent ?? false);
    expect(payment.floatingFilterComponent).toBe(entry.floatingFilter);
    const column = fixtureSchema.columns.find((c) => c.id === "payment");
    expect(payment.cellRendererParams).toEqual({ schemaColumn: column, fieldType: registry.get("select") });
    expect(payment.cellEditorParams).toEqual({ schemaColumn: column, fieldType: registry.get("select") });
  });

  it("filter is false when the entry has no filter component", () => {
    const noFilter = ui.extend({ text: { filterComponent: undefined } });
    const defs = compileColumns(fixtureSchema, adminAccess, registry, noFilter);
    expect(byId(defs, "name").filter).toBe(false);
  });

  it("wrapRenderer wraps each renderer", () => {
    const Wrapped = () => null;
    const wrapRenderer = vi.fn(() => Wrapped);
    const defs = compileColumns(fixtureSchema, adminAccess, registry, ui, { wrapRenderer });
    expect(byId(defs, "name").cellRenderer).toBe(Wrapped);
    expect(wrapRenderer).toHaveBeenCalledWith(ui.get("text").renderer);
  });

  it("passes cellClassRules through", () => {
    const cellClassRules = { "sg-x": () => true };
    const defs = compileColumns(fixtureSchema, adminAccess, registry, ui, { cellClassRules });
    expect(byId(defs, "name").cellClassRules).toBe(cellClassRules);
  });

  it("falls back to ColumnDef width/pinned/hidden/order", () => {
    const schema: GridSchema = {
      id: "s",
      schemaVersion: 1,
      columns: [
        col({ id: "a", type: "text", width: 120, pinned: "left" }, 2),
        col({ id: "b", type: "text", hidden: true }, 1),
        col({ id: "c", type: "text" }, 1),
      ],
    };
    const access = new Map<string, Access>([["a", "edit"], ["b", "edit"], ["c", "edit"]]);
    const defs = compileColumns(schema, access, registry, ui);
    expect(defs.map((d) => d.colId)).toEqual(["b", "c", "a"]);
    expect(byId(defs, "a").initialWidth).toBe(120);
    expect(byId(defs, "a").initialPinned).toBe("left");
    expect(byId(defs, "a").initialHide).toBe(false);
    expect(byId(defs, "b").initialHide).toBe(true);
  });

  it("view columnState overrides width, pinned, hide and order", () => {
    const view: ViewDef = {
      id: "v",
      name: "v",
      filter: null,
      sort: [],
      groupBy: [],
      pageSize: 50,
      columnState: [
        { id: "name", hidden: true, width: 300, pinned: "right", order: 99 },
        { id: "score", hidden: false, width: 120, pinned: "left", order: -1 },
      ],
    };
    const defs = compileColumns(fixtureSchema, adminAccess, registry, ui, { view });
    // view-known columns first (by view order), then the rest by ColumnDef.order
    expect(defs.slice(0, 3).map((d) => d.colId)).toEqual(["score", "name", "notes"]);
    const name = byId(defs, "name");
    expect(name.initialHide).toBe(true);
    expect(name.initialWidth).toBe(300);
    expect(name.initialPinned).toBe("right");
    expect(byId(defs, "score").initialPinned).toBe("left");
    expect(byId(defs, "notes").initialPinned).toBeUndefined();
  });

  it("formula columns are never editable and compute from dependencies", () => {
    const allEdit = new Map<string, Access>(fixtureSchema.columns.map((c) => [c.id, "edit" as Access]));
    const defs = compileColumns(fixtureSchema, allEdit, registry, ui, { formulaEnv: env });
    const total = byId(defs, "total");
    expect(isEditable(total, row("r1", { score: 4 }))).toBe(false);
    expect(getValue(total, row("r1", { score: 4 }))).toBe(8);
    expect(getValue(total, undefined)).toBeUndefined();
  });

  it("uses precompiled formulas when given", () => {
    const formulas = compileFormulaColumns<GridRow>(fixtureSchema, env);
    const defs = compileColumns(fixtureSchema, adminAccess, registry, ui, { formulas });
    expect(getValue(byId(defs, "total"), row("r1", { score: 3 }))).toBe(6);
  });

  it("a formula parse error renders an error value without throwing", () => {
    const schema: GridSchema = {
      id: "s",
      schemaVersion: 1,
      columns: [col({ id: "bad", type: "formula", formula: "{score} *", config: { resultType: "number" } })],
    };
    const defs = compileColumns(schema, new Map<string, Access>([["bad", "read"]]), registry, ui);
    const v = getValue(byId(defs, "bad"), row("r1", { score: 1 }));
    expect(isFormulaError(v)).toBe(true);
  });
});

describe("compileFormulaColumns", () => {
  const schema: GridSchema = {
    id: "s",
    schemaVersion: 1,
    columns: [
      col({ id: "a", type: "number" }),
      col({ id: "b", type: "number" }),
      col({ id: "sum", key: "sumKey", type: "formula", formula: "{a} + {b}", config: { resultType: "number" } }),
      col({ id: "dbl", type: "formula", formula: "{sumKey} * 2", config: { resultType: "number" } }),
      col({ id: "div", type: "formula", formula: "{a} / {b}", config: { resultType: "number" } }),
      col({ id: "bad", type: "formula", formula: "(", config: { resultType: "number" } }),
      col({ id: "missing", type: "formula", formula: "{nope} + 1", config: { resultType: "number" } }),
    ],
  };

  it("builds getters that compute values", () => {
    const f = compileFormulaColumns<GridRow>(schema, env);
    const r = row("r1", { a: 2, b: 3 });
    expect(f.getters.get("sum")?.(r)).toBe(5);
    expect(f.getters.get("dbl")?.(r)).toBe(10);
  });

  it("dependents lists formula columns per referenced key, including transitive", () => {
    const f = compileFormulaColumns<GridRow>(schema, env);
    expect([...(f.dependents.get("a") ?? [])].sort()).toEqual(["dbl", "div", "sum"]);
    expect([...(f.dependents.get("b") ?? [])].sort()).toEqual(["dbl", "div", "sum"]);
    expect(f.dependents.get("sumKey")).toEqual(["dbl"]);
    expect(f.dependents.get("sum")).toBeUndefined();
  });

  it("records parse errors and the getter returns the error instead of throwing", () => {
    const f = compileFormulaColumns<GridRow>(schema, env);
    expect(isFormulaError(f.errors.get("bad"))).toBe(true);
    expect(f.errors.get("bad")?.code).toBe("syntax");
    expect(isFormulaError(f.getters.get("bad")?.(row("r1", {})))).toBe(true);
  });

  it("returns runtime errors as FormulaError values (core evaluate never throws)", () => {
    const f = compileFormulaColumns<GridRow>(schema, env);
    const v = f.getters.get("missing")?.(row("r1", { a: 1 }));
    expect(isFormulaError(v)).toBe(true);
    // core: division by zero is null, not an error
    expect(f.getters.get("div")?.(row("r1", { a: 1, b: 0 }))).toBeNull();
  });

  it("memoises per row object; a new row object recomputes", () => {
    const f = compileFormulaColumns<GridRow>(schema, env);
    const r = row("r1", { a: 1, b: 1 });
    const get = f.getters.get("sum");
    expect(get?.(r)).toBe(2);
    r.cells.a = 10; // mutation in place is not observed (memoised)
    expect(get?.(r)).toBe(2);
    expect(get?.({ ...r, cells: { ...r.cells } })).toBe(11);
  });
});

describe("review follow-ups", () => {
  it("columns unknown to the view sort after the view's columns", () => {
    const schema: GridSchema = {
      id: "s",
      schemaVersion: 1,
      columns: [col({ id: "x", type: "text" }, 0), col({ id: "y", type: "text" }, 1), col({ id: "z", type: "text" }, 2)],
    };
    const access = new Map<string, Access>([
      ["x", "edit"],
      ["y", "edit"],
      ["z", "edit"],
    ]);
    const view = {
      id: "v",
      name: "v",
      filter: null,
      sort: [],
      groupBy: [],
      pageSize: 50,
      columnState: [
        { id: "z", hidden: false, width: 100, pinned: null, order: 5 },
        { id: "y", hidden: false, width: 100, pinned: null, order: 6 },
      ],
    };
    const defs = compileColumns(schema, access, registry, ui, { view });
    expect(defs.map((d) => d.colId)).toEqual(["z", "y", "x"]);
  });

  it("enables floatingFilter only when a filter and floating filter component exist", () => {
    const Dummy = () => null;
    const custom = ui.extend({
      text: { filterComponent: Dummy, floatingFilter: Dummy },
      number: { filterComponent: undefined, floatingFilter: undefined },
    });
    const schema: GridSchema = { id: "s", schemaVersion: 1, columns: [col({ id: "x", type: "text" }), col({ id: "n", type: "number" })] };
    const access = new Map<string, Access>([
      ["x", "edit"],
      ["n", "edit"],
    ]);
    const defs = compileColumns(schema, access, registry, custom);
    expect(byId(defs, "x").floatingFilter).toBe(true);
    expect(byId(defs, "n").floatingFilter).toBe(false);
  });
});
