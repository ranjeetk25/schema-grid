import { describe, expect, it, vi } from "vitest";
import type { Access, GridRow } from "../../src/internal/core";
import {
  createInPlaceHandlers,
  createReadOnlyCellClassRules,
  READ_ONLY_MESSAGES,
  readOnlyReason,
} from "../../src/editing/inPlace";
import { compileColumns } from "../../src/compile/compileColumns";
import { createDefaultUiRegistry } from "../../src/compile/uiRegistry";
import { createDefaultRegistry } from "../../src/internal/core";
import { SG_CLASSES } from "../../src/theme/classNames";
import { fixtureSchema, row } from "../fixtures/schema";

const col = (id: string) => {
  const c = fixtureSchema.columns.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

const allEdit = new Map<string, Access>(fixtureSchema.columns.map((c) => [c.id, "edit"]));

function ctx(access: Map<string, Access> = allEdit, canEditCell?: (r: GridRow, id: string) => boolean) {
  return { schema: fixtureSchema, access, ...(canEditCell ? { canEditCell } : {}) };
}

describe("readOnlyReason", () => {
  it("classifies formula, permission (column and row) and editable cells", () => {
    const r = row("r1", {});
    expect(readOnlyReason(col("total"), "edit", r)).toBe("formula");
    expect(readOnlyReason(col("name"), "read", r)).toBe("permission");
    expect(readOnlyReason(col("name"), "edit", r, () => false)).toBe("permission");
    expect(readOnlyReason(col("name"), "edit", r, () => true)).toBeNull();
    expect(readOnlyReason(undefined, "edit", r)).toBeNull();
  });
});

describe("createReadOnlyCellClassRules", () => {
  const rules = createReadOnlyCellClassRules();
  const params = (colId: string, context: unknown) =>
    ({ context, data: row("r1", {}), colDef: { colId } }) as unknown as Parameters<
      Extract<(typeof rules)[string], (...args: never[]) => unknown>
    >[0];
  const apply = (cls: string, colId: string, context: unknown) =>
    (rules[cls] as (p: unknown) => boolean)(params(colId, context));

  it("marks formula cells sg-cell-formula and permission read-only cells sg-cell-readonly", () => {
    const readOnlyName = new Map(allEdit);
    readOnlyName.set("name", "read");
    expect(apply(SG_CLASSES.formula, "total", ctx())).toBe(true);
    expect(apply(SG_CLASSES.readOnly, "total", ctx())).toBe(false);
    expect(apply(SG_CLASSES.readOnly, "name", ctx(readOnlyName))).toBe(true);
    expect(apply(SG_CLASSES.readOnly, "name", ctx())).toBe(false);
    expect(apply(SG_CLASSES.readOnly, "name", ctx(allEdit, () => false))).toBe(true);
  });
});

function keyParams(colId: string, key: string, data: GridRow, extra: Partial<KeyboardEvent> = {}) {
  const event = { type: "keydown", key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, preventDefault: vi.fn(), ...extra };
  return { editing: false, event, node: { data }, column: { getColId: () => colId } } as never;
}

describe("createInPlaceHandlers", () => {
  const setup = (context = ctx()) => {
    const submit = vi.fn();
    const announce = vi.fn();
    const handlers = createInPlaceHandlers<GridRow>({
      getContext: () => context,
      submit,
      getValue: (r, c) => r.cells[c.key],
      announce,
    });
    return { handlers, submit, announce };
  };

  it("Space and Enter toggle an editable boolean through submit and suppress the grid default", () => {
    const { handlers, submit } = setup();
    const data = row("r1", { active: true });
    expect(handlers.keyHandler(keyParams("active", " ", data))).toBe(true);
    expect(submit).toHaveBeenLastCalledWith({ rowId: "r1", columnId: "active", prev: true, next: false });
    expect(handlers.keyHandler(keyParams("active", "Enter", row("r2", {})))).toBe(true);
    expect(submit).toHaveBeenLastCalledWith({ rowId: "r2", columnId: "active", prev: undefined, next: true });
  });

  it("does not toggle a read-only boolean and announces why", () => {
    const readOnly = new Map(allEdit);
    readOnly.set("active", "read");
    const { handlers, submit, announce } = setup(ctx(readOnly));
    expect(handlers.keyHandler(keyParams("active", " ", row("r1", { active: false })))).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(READ_ONLY_MESSAGES.permission, "polite");
  });

  it("announces read-only on Enter / typing into a formula cell without suppressing the key", () => {
    const { handlers, submit, announce } = setup();
    expect(handlers.keyHandler(keyParams("total", "Enter", row("r1", {})))).toBe(false);
    expect(announce).toHaveBeenLastCalledWith(READ_ONLY_MESSAGES.formula, "polite");
    announce.mockClear();
    expect(handlers.keyHandler(keyParams("total", "x", row("r1", {})))).toBe(false);
    expect(announce).toHaveBeenCalledTimes(1);
    announce.mockClear();
    handlers.keyHandler(keyParams("total", "c", row("r1", {}), { metaKey: true }));
    handlers.keyHandler(keyParams("total", "ArrowDown", row("r1", {})));
    expect(announce).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("leaves editable non-boolean cells and open editors alone", () => {
    const { handlers, announce } = setup();
    expect(handlers.keyHandler(keyParams("name", "Enter", row("r1", {})))).toBe(false);
    const editing = { ...(keyParams("active", " ", row("r1", {})) as object), editing: true } as never;
    expect(handlers.keyHandler(editing)).toBe(false);
    expect(announce).not.toHaveBeenCalled();
  });

  it("flashes the read-only hint class on the cell", () => {
    vi.useFakeTimers();
    try {
      const { handlers } = setup();
      const cell = document.createElement("div");
      cell.className = "ag-cell";
      const target = document.createElement("span");
      cell.append(target);
      handlers.keyHandler(keyParams("total", "Enter", row("r1", {}), { target } as Partial<KeyboardEvent>));
      expect(cell.classList.contains(SG_CLASSES.readOnlyHint)).toBe(true);
      vi.advanceTimersByTime(700);
      expect(cell.classList.contains(SG_CLASSES.readOnlyHint)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("double-click on a read-only cell announces; click on the checkbox toggles", () => {
    const { handlers, submit, announce } = setup();
    const cell = document.createElement("div");
    cell.className = "ag-cell";
    const box = document.createElement("input");
    box.className = "sg-bool";
    cell.append(box);
    const click = { clientX: 0, clientY: 0, target: box } as unknown as MouseEvent;
    handlers.onCellClicked({ column: { getColId: () => "active" }, node: { data: row("r1", { active: false }) }, event: click } as never);
    expect(submit).toHaveBeenCalledWith({ rowId: "r1", columnId: "active", prev: false, next: true });
    handlers.onCellDoubleClicked({ column: { getColId: () => "total" }, node: { data: row("r1", {}) }, event: click } as never);
    expect(announce).toHaveBeenCalledWith(READ_ONLY_MESSAGES.formula, "polite");
  });
});

describe("compileColumns boolean columns", () => {
  it("never let AG Grid open an editor for booleans (they toggle in place)", () => {
    const defs = compileColumns(fixtureSchema, allEdit, createDefaultRegistry(), createDefaultUiRegistry());
    const active = defs.find((d) => d.colId === "active");
    expect(active?.editable).toBe(false);
    const name = defs.find((d) => d.colId === "name");
    expect(typeof name?.editable).toBe("function");
  });
});
