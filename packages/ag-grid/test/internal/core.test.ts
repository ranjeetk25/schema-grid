/**
 * Tests for the ADAPTER / LOCAL pieces of the core facade (src/internal/core.ts)
 * and the in-memory data source fixture wrapper. Core's own semantics
 * (filters, formulas, field types, relative dates, permissions) are tested in
 * @masai/schema-grid-core; here we only check that our adapters agree with it.
 */
import { describe, expect, it } from "vitest";
import {
  type ColumnDef,
  type FilterNode,
  type GridRow,
  type SortSpec,
  createDefaultRegistry,
  effectiveFieldType,
  formulaError,
  isFormulaError,
  matchesFilter,
  NUMBER_OPERATORS,
  operatorsFor,
  searchRows,
  sortRows,
  TEXT_OPERATORS,
  validateFilter,
} from "../../src/internal/core";
import { compileFormulaColumns } from "../../src/compile/formulaColumns";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { col, fixtureRows, fixtureSchema, row } from "../fixtures/schema";

const registry = createDefaultRegistry();
const now = new Date("2026-09-25T06:00:00.000Z"); // 11:30 IST, Friday
const tz = "Asia/Kolkata";
const byId = new Map(fixtureSchema.columns.map((c) => [c.id, c]));
const column = (id: string): ColumnDef => {
  const c = byId.get(id);
  if (!c) throw new Error(`no column ${id}`);
  return c;
};

// Formula values as the grid computes them (fixture rows don't store `total`).
const formulas = compileFormulaColumns<GridRow>(fixtureSchema, { now, tz });
const getCellValue = (r: GridRow, c: ColumnDef): unknown =>
  c.type === "formula" ? formulas.getters.get(c.id)?.(r) : r.cells[c.key];

describe("matchesFilter adapter", () => {
  const ctx = { schema: fixtureSchema, registry, now, tz, user: { id: "u-agent" } };
  const ids = (node: FilterNode | null, c: Parameters<typeof matchesFilter>[2] = ctx) =>
    fixtureRows.filter((r) => matchesFilter(r, node, c)).map((r) => r.id);

  it("takes (row, node, ctx); a null node matches everything", () => {
    expect(ids(null)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(ids({ columnId: "payment", operator: "isNot", value: "paid" })).toEqual(["r2", "r3", "r4"]);
  });

  it("maps ctx.user to core's userId for isMe / isNotMe (UserRef cells)", () => {
    expect(ids({ columnId: "owner", operator: "isMe" })).toEqual(["r1", "r4"]);
    expect(ids({ columnId: "owner", operator: "isNotMe" })).toEqual(["r2", "r3"]);
  });

  it("defaults now/tz when omitted", () => {
    const loose = { schema: fixtureSchema, registry };
    expect(ids({ columnId: "score", operator: "gte", value: 10 }, loose)).toEqual(["r1", "r4"]);
  });

  it("feeds getCellValue overrides for formula columns to core", () => {
    const node: FilterNode = { columnId: "total", operator: "gte", value: 20 };
    // Without the override the formula cell is absent (empty) → a positive operator never matches.
    expect(ids(node)).toEqual([]);
    expect(ids(node, { ...ctx, getCellValue })).toEqual(["r1", "r4"]);
  });
});

describe("validateFilter adapter", () => {
  const node: FilterNode = {
    op: "and",
    children: [
      { columnId: "nope", operator: "is", value: "x" },
      { columnId: "salary", operator: "eq", value: 1 },
    ],
  };

  it("accepts an array or a Set of readable column ids", () => {
    const fromArray = validateFilter(node, fixtureSchema, registry, ["name", "payment"]);
    const fromSet = validateFilter(node, fixtureSchema, registry, new Set(["name", "payment"]));
    expect(fromArray.map((e) => e.code)).toEqual(["unknownColumn", "unreadableColumn"]);
    expect(fromSet).toEqual(fromArray);
  });
});

describe("operatorsFor / effectiveFieldType", () => {
  it("formula columns resolve through config.resultType", () => {
    const total = column("total"); // resultType: number
    const ft = effectiveFieldType(registry, total);
    expect(ft?.id).toBe("number");
    expect(operatorsFor(registry.get("formula")!, total).map((o) => o.id)).toEqual(NUMBER_OPERATORS.map((o) => o.id));
    const textFormula = col({ id: "t", type: "formula", formula: "{name}", config: { resultType: "text" } });
    expect(operatorsFor(registry.get("formula")!, textFormula).map((o) => o.id)).toEqual(TEXT_OPERATORS.map((o) => o.id));
  });

  it("other columns use their own type", () => {
    const name = column("name");
    expect(effectiveFieldType(registry, name)?.id).toBe("text");
    expect(operatorsFor(registry.get("text")!, name)).toBe(registry.get("text")!.operators);
  });
});

describe("sortRows / searchRows parity with core's in-memory data source", () => {
  const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { now, tz });
  const serverIds = async (sort: SortSpec[], search?: string) =>
    (await ds.fetch({ filter: null, sort, ...(search ? { search } : {}), page: { offset: 0, limit: 100 } })).rows.map((r) => r.id);
  const localSort = (rows: readonly GridRow[], sort: SortSpec[]) => sortRows(rows, sort, { schema: fixtureSchema, registry, getCellValue });

  const sorts: SortSpec[][] = [
    [],
    [{ columnId: "score", dir: "asc" }],
    [{ columnId: "score", dir: "desc" }],
    [{ columnId: "payment", dir: "asc" }],
    [{ columnId: "payment", dir: "desc" }],
    [{ columnId: "callDate", dir: "desc" }],
    [{ columnId: "owner", dir: "asc" }],
    [{ columnId: "tags", dir: "desc" }],
    [{ columnId: "total", dir: "desc" }],
    [
      { columnId: "active", dir: "asc" },
      { columnId: "score", dir: "desc" },
    ],
  ];

  for (const sort of sorts) {
    it(`sort ${JSON.stringify(sort)}`, async () => {
      // Shuffle the input so the id tie-break is actually exercised.
      const input = [...fixtureRows].reverse();
      expect(localSort(input, sort).map((r) => r.id)).toEqual(await serverIds(sort));
    });
  }

  it("empties go last in both directions, ties break by id", () => {
    const rows = [row("b", { score: 1 }), row("d", { score: null }), row("a", { score: 1 }), row("c", {})];
    expect(localSort(rows, [{ columnId: "score", dir: "asc" }]).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(localSort(rows, [{ columnId: "score", dir: "desc" }]).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    const withTwo = [...rows, row("e", { score: 2 })];
    expect(localSort(withTwo, [{ columnId: "score", dir: "desc" }]).map((r) => r.id)).toEqual(["e", "a", "b", "c", "d"]);
  });

  for (const search of ["a", "PAID", "agent", "hot", "2026-09-24", "40", "  "]) {
    it(`search ${JSON.stringify(search)}`, async () => {
      const local = searchRows(fixtureRows, search, { schema: fixtureSchema, registry, getCellValue });
      expect(localSort(local, []).map((r) => r.id)).toEqual(await serverIds([], search));
    });
  }

  it("searchRows honours readableColumnIds", () => {
    const out = searchRows(fixtureRows, "open", {
      schema: fixtureSchema,
      registry,
      readableColumnIds: new Set(["name"]),
    });
    expect(out).toEqual([]);
  });
});

describe("formulaError helper", () => {
  it("builds a core-shaped FormulaError value", () => {
    const e = formulaError("boom");
    expect(e).toEqual({ kind: "formulaError", code: "eval", message: "boom" });
    expect(isFormulaError(e)).toBe(true);
    expect(formulaError("bad", "syntax").code).toBe("syntax");
  });
});

describe("in-memory data source fixture", () => {
  const batch = (baseVersions: Record<string, number>) => ({
    id: "b1",
    source: "edit" as const,
    baseVersions,
    changes: [
      { rowId: "r1", columnId: "name", prev: "Asha", next: "A" },
      { rowId: "r2", columnId: "name", prev: "Bala", next: "B" },
    ],
  });

  it("a version conflict on one row doesn't block another; returns versions", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const result = await ds.applyChanges(batch({ r1: 1, r2: 99 }));
    expect(result.applied.map((c) => c.rowId)).toEqual(["r1"]);
    expect(result.conflicts).toMatchObject([{ rowId: "r2", columnId: "name", serverValue: "Bala", serverVersion: 1 }]);
    expect(result.versions).toEqual({ r1: 2 });
    expect(ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("A");
    expect(ds.rows().find((r) => r.id === "r2")?.cells.name).toBe("Bala");
  });

  it("getChanges feeds changed rows since a cursor", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    await ds.applyChanges(batch({ r1: 1, r2: 99 }));
    const feed = await ds.getChanges("");
    expect(feed.rows.map((r) => [r.id, r.version])).toEqual([["r1", 2]]);
    expect((await ds.getChanges(feed.cursor)).rows).toEqual([]);
    await ds.remoteEdit("r2", { name: "Bee" });
    await ds.remoteDelete("r3");
    const next = await ds.getChanges(feed.cursor);
    expect(next.rows.map((r) => [r.id, r.cells.name])).toEqual([["r2", "Bee"]]);
    expect(next.deletedRowIds).toEqual(["r3"]);
  });

  it("errorOn reports a scripted per-cell error and applies the rest", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    ds.errorOn("r2", "name", "Nope");
    const result = await ds.applyChanges(batch({ r1: 1, r2: 1 }));
    expect(result.applied.map((c) => c.rowId)).toEqual(["r1"]);
    expect(result.errors).toEqual([{ rowId: "r2", columnId: "name", message: "Nope" }]);
    // one-shot
    const again = await ds.applyChanges({ ...batch({ r2: 1 }), changes: [{ rowId: "r2", columnId: "name", prev: "Bala", next: "B" }] });
    expect(again.applied.map((c) => c.rowId)).toEqual(["r2"]);
  });

  it("failNextApply rejects once", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    ds.failNextApply(new Error("offline"));
    await expect(ds.applyChanges(batch({ r1: 1, r2: 1 }))).rejects.toThrow("offline");
    const ok = await ds.applyChanges(batch({ r1: 1, r2: 1 }));
    expect(ok.applied).toHaveLength(2);
    expect(ok.versions).toEqual({ r1: 2, r2: 2 });
  });
});
