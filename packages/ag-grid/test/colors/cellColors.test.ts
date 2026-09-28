/**
 * v0.4 cell colors: the resolver (memoised shown color per cell / row), rule
 * sanitising and pruning, the color class rules and the adapters that carry
 * `colorRules` into core's filter matching.
 */
import type { CellClassParams, RowClassParams } from "ag-grid-community";
import { describe, expect, it, vi } from "vitest";
import { deriveClientRows } from "../../src/client/deriveClientRows";
import {
  cellColorClass,
  createCellColorClassRules,
  createCellColorResolver,
  createRowColorClassRules,
  pruneColorRules,
  sanitizeColorRules,
} from "../../src/colors/cellColors";
import {
  CELL_COLORS,
  type ColorRule,
  createDefaultRegistry,
  type GridRow,
  matchesFilter,
} from "../../src/internal/core";
import { compileFormulaColumns } from "../../src/compile/formulaColumns";
import { SG_CLASSES } from "../../src/theme/classNames";
import { fixtureRows, fixtureSchema } from "../fixtures/schema";

const registry = createDefaultRegistry();
const tz = "Asia/Kolkata";
const allIds = new Set(fixtureSchema.columns.map((c) => c.id));

const openRow: ColorRule = {
  id: "open",
  color: "green",
  target: { kind: "row" },
  when: { columnId: "status", operator: "is", value: "open" },
};
const hotName: ColorRule = {
  id: "hot",
  color: "red",
  target: { kind: "cells", columnIds: ["name"] },
  when: { columnId: "tags", operator: "hasAnyOf", value: ["hot"] },
};

const r = (id: string): GridRow => {
  const found = fixtureRows.find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe("matchesFilter / deriveClientRows carry colorRules", () => {
  it("colorIs matches the SHOWN color (manual > cells rule > row rule)", () => {
    const painted = { ...r("r3"), colors: { name: "blue" as const } };
    const rows = [r("r1"), r("r2"), painted, r("r4")];
    const ctx = { schema: fixtureSchema, registry, tz, colorRules: [hotName, openRow] };
    const ids = (node: Parameters<typeof matchesFilter>[1]) => rows.filter((x) => matchesFilter(x, node, ctx)).map((x) => x.id);
    expect(ids({ columnId: "name", operator: "colorIs", value: ["red"] })).toEqual(["r1"]);
    expect(ids({ columnId: "name", operator: "colorIs", value: ["blue"] })).toEqual(["r3"]);
    // r1's status cell falls back to its row rule (green).
    expect(ids({ columnId: "status", operator: "colorIs", value: ["green"] })).toEqual(["r1", "r3"]);
    expect(ids({ columnId: "name", operator: "colorIsNone" })).toEqual(["r2", "r4"]);
  });

  it("deriveClientRows filters by color with the context's rules", () => {
    const derived = deriveClientRows(
      fixtureRows,
      { filter: { columnId: "email", operator: "colorIs", value: ["green"] }, sort: [] },
      { schema: fixtureSchema, registry, readableColumnIds: allIds, tz, colorRules: [openRow] },
    );
    expect(derived.errors).toEqual([]);
    expect(derived.rows.map((x) => x.id)).toEqual(["r1", "r3"]);
  });
});

describe("createCellColorResolver", () => {
  it("resolves manual > cells rule > row rule, and the row tier", () => {
    const res = createCellColorResolver({ rules: [hotName, openRow], schema: fixtureSchema, registry, tz });
    expect(res.cellColor(r("r1"), "name")).toBe("red");
    expect(res.cellColor(r("r1"), "score")).toBe("green");
    expect(res.rowColor(r("r1"))).toBe("green");
    expect(res.cellColor(r("r2"), "name")).toBeNull();
    expect(res.rowColor(r("r2"))).toBeNull();
    expect(res.cellColor({ ...r("r2"), colors: { name: "purple" } }, "name")).toBe("purple");
  });

  it("ignores manual colors when manual is false (capabilities.cellColors.read false)", () => {
    const res = createCellColorResolver({ rules: [openRow], schema: fixtureSchema, registry, tz, manual: false });
    expect(res.cellColor({ ...r("r2"), colors: { name: "purple" } }, "name")).toBeNull();
    expect(res.cellColor({ ...r("r1"), colors: { name: "purple" } }, "name")).toBe("green");
  });

  it("evaluates rules on computed formula values", () => {
    const formulas = compileFormulaColumns<GridRow>(fixtureSchema, { now: new Date(), tz });
    const rule: ColorRule = {
      id: "big",
      color: "yellow",
      target: { kind: "cells", columnIds: ["total"] },
      when: { columnId: "total", operator: "gt", value: 30 },
    };
    const res = createCellColorResolver({
      rules: [rule],
      schema: fixtureSchema,
      registry,
      tz,
      getCellValue: (row, column) => (column.type === "formula" ? formulas.getters.get(column.id)?.(row) : row.cells[column.key]),
    });
    expect(res.cellColor(r("r4"), "total")).toBe("yellow");
    expect(res.cellColor(r("r1"), "total")).toBeNull();
  });

  it("memoises per row object (a new version / colors means a new object) and rules identity", () => {
    const getCellValue = vi.fn((row: GridRow, column: { key: string }) => row.cells[column.key]);
    const res = createCellColorResolver({ rules: [hotName, openRow], schema: fixtureSchema, registry, tz, getCellValue });
    const row1 = r("r1");
    res.cellColor(row1, "name");
    const calls = getCellValue.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      res.cellColor(row1, "name");
      res.rowColor(row1);
    }
    res.cellColor(row1, "score");
    const afterSameRow = getCellValue.mock.calls.length;
    // The same row object: nothing re-evaluated for name / row; score only once.
    expect(afterSameRow - calls).toBeLessThanOrEqual(1);
    const repainted = { ...row1, colors: { name: "teal" as const } };
    expect(res.cellColor(repainted, "name")).toBe("teal");
    const edited = { ...row1, version: 2, cells: { ...row1.cells, status: "closed" } };
    expect(res.rowColor(edited)).toBeNull();
    expect(res.cellColor(edited, "score")).toBeNull();
  });

  it("without rules or colors resolves null cheaply", () => {
    const res = createCellColorResolver({ rules: [], schema: fixtureSchema, registry, tz });
    expect(res.cellColor(r("r1"), "name")).toBeNull();
    expect(res.rowColor(r("r1"))).toBeNull();
    expect(res.hasRowRules).toBe(false);
  });
});

describe("sanitizeColorRules / pruneColorRules", () => {
  it("drops rules that reference unreadable or unknown columns, or are malformed", () => {
    const readable = new Set([...allIds].filter((id) => id !== "salary"));
    const secret: ColorRule = { id: "s", color: "red", target: { kind: "row" }, when: { columnId: "salary", operator: "gt", value: 1 } };
    const hiddenTarget: ColorRule = { id: "t", color: "red", target: { kind: "cells", columnIds: ["salary"] }, when: null };
    const bad = { id: "b", color: "chartreuse", target: { kind: "row" }, when: null } as unknown as ColorRule;
    const out = sanitizeColorRules([openRow, secret, hiddenTarget, bad, hotName], fixtureSchema, registry, readable);
    expect(out.map((x) => x.id)).toEqual(["open", "hot"]);
  });

  it("prunes targets and conditions on unknown columns; a rule without targets is removed", () => {
    const multi: ColorRule = {
      id: "m",
      color: "blue",
      target: { kind: "cells", columnIds: ["name", "gone"] },
      when: { op: "and", children: [{ columnId: "gone", operator: "isEmpty" }, { columnId: "name", operator: "isNotEmpty" }] },
    };
    const onlyGone: ColorRule = { id: "g", color: "blue", target: { kind: "cells", columnIds: ["gone"] }, when: null };
    const isKnown = (id: string) => id !== "gone";
    const out = pruneColorRules([multi, onlyGone, openRow], isKnown);
    expect(out).toEqual([
      {
        id: "m",
        color: "blue",
        target: { kind: "cells", columnIds: ["name"] },
        when: { op: "and", children: [{ columnId: "name", operator: "isNotEmpty" }] },
      },
      openRow,
    ]);
  });

  it("returns the same array when nothing was pruned", () => {
    const rules = [openRow, hotName];
    expect(pruneColorRules(rules, () => true)).toBe(rules);
  });
});

describe("color class rules", () => {
  const resolver = createCellColorResolver({ rules: [hotName, openRow], schema: fixtureSchema, registry, tz });
  const context = { stores: {}, cellColors: resolver };

  it("gives a colored cell sg-cell-colored + sg-color-<name>", () => {
    const rules = createCellColorClassRules();
    const params = (data: GridRow, colId: string) => ({ data, colDef: { colId }, context }) as unknown as CellClassParams<GridRow>;
    const on = (data: GridRow, colId: string) =>
      Object.entries(rules)
        .filter(([, fn]) => (fn as (p: CellClassParams<GridRow>) => boolean)(params(data, colId)))
        .map(([cls]) => cls);
    expect(on(r("r1"), "name")).toEqual([SG_CLASSES.cellColored, "sg-color-red"]);
    expect(on(r("r1"), "score")).toEqual([SG_CLASSES.cellColored, "sg-color-green"]);
    expect(on(r("r2"), "name")).toEqual([]);
    // Outside a colors-aware grid nothing matches.
    const bare = { data: r("r1"), colDef: { colId: "name" }, context: {} } as unknown as CellClassParams<GridRow>;
    expect(Object.values(rules).some((fn) => (fn as (p: CellClassParams<GridRow>) => boolean)(bare))).toBe(false);
  });

  it("gives a row-rule row sg-row-colored + sg-color-<name>; group rows never", () => {
    const rules = createRowColorClassRules();
    const on = (data: unknown) =>
      Object.entries(rules)
        .filter(([, fn]) => (fn as (p: RowClassParams<GridRow>) => boolean)({ data, context } as unknown as RowClassParams<GridRow>))
        .map(([cls]) => cls);
    expect(on(r("r1"))).toEqual([SG_CLASSES.rowColored, "sg-color-green"]);
    expect(on(r("r2"))).toEqual([]);
    expect(on({ __sg: "group", id: "g1" })).toEqual([]);
  });

  it("names one class per palette color", () => {
    expect(CELL_COLORS.map(cellColorClass)).toEqual(CELL_COLORS.map((c) => `sg-color-${c}`));
  });
});
