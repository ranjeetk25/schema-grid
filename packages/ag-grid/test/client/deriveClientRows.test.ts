import type { IRowNode, PostSortRowsParams } from "ag-grid-community";
import { describe, expect, it } from "vitest";
import { combineFilters } from "../../src/client/combineFilters";
import { deriveClientRows, makePostSortRows, toGridQuery } from "../../src/client/deriveClientRows";
import {
  type FilterNode,
  type GridRow,
  type GridSchema,
  createDefaultRegistry,
  createRolePermissionResolver,
  resolveColumnAccess,
  validateFilter,
} from "../../src/internal/core";
import type { QueryState } from "../../src/state/queryStore";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { ADMIN, AGENT, fixtureRows, fixtureSchema } from "../fixtures/schema";

const registry = createDefaultRegistry();
const NOW = new Date("2026-09-24T06:00:00.000Z");
const TZ = "Asia/Kolkata";

function readableFor(user: typeof ADMIN, schema: GridSchema = fixtureSchema): Set<string> {
  const access = resolveColumnAccess(schema, createRolePermissionResolver(), user);
  return new Set([...access].filter(([, a]) => a !== "hidden").map(([id]) => id));
}

const adminCtx = {
  schema: fixtureSchema,
  registry,
  readableColumnIds: readableFor(ADMIN),
  user: { id: ADMIN.id },
  tz: TZ,
  now: NOW,
};

function q(partial: Partial<QueryState>): QueryState {
  return { filter: null, sort: [], groupBy: [], ...partial };
}

const ids = (rows: readonly GridRow[]) => rows.map((r) => r.id);

describe("deriveClientRows matches core's in-memory data source", () => {
  const cases: [string, QueryState][] = [
    ["no query", q({})],
    ["select is", q({ filter: { columnId: "payment", operator: "is", value: "paid" } })],
    ["number gt + sort desc", q({ filter: { columnId: "score", operator: "gt", value: 4 }, sort: [{ columnId: "score", dir: "desc" }] })],
    [
      "or group + sort by name desc",
      q({
        filter: {
          op: "or",
          children: [
            { columnId: "active", operator: "isTrue" },
            { columnId: "tags", operator: "hasAnyOf", value: ["cold"] },
          ],
        },
        sort: [{ columnId: "name", dir: "desc" }],
      }),
    ],
    ["date is", q({ filter: { columnId: "callDate", operator: "is", value: "2026-09-24" } })],
    ["search", q({ search: "ba" })],
    ["sort nulls last asc", q({ sort: [{ columnId: "score", dir: "asc" }] })],
    ["sort nulls last desc", q({ sort: [{ columnId: "payment", dir: "desc" }] })],
    [
      "multi-sort",
      q({
        sort: [
          { columnId: "callDate", dir: "desc" },
          { columnId: "name", dir: "asc" },
        ],
      }),
    ],
    ["isEmpty", q({ filter: { columnId: "payment", operator: "isEmpty" } })],
  ];

  it.each(cases)("%s", async (_name, state) => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, { registry, user: { id: ADMIN.id }, now: NOW, tz: TZ });
    const expected = await ds.fetch(toGridQuery(state, { offset: 0, limit: 1000 }));
    const out = deriveClientRows(fixtureRows, state, adminCtx);
    expect(out.errors).toEqual([]);
    expect(ids(out.rows)).toEqual(ids(expected.rows));
    expect([...out.orderIndex.entries()]).toEqual(ids(expected.rows).map((id, i) => [id, i]));
  });
});

describe("deriveClientRows semantics", () => {
  it("a negative operator includes empty values", () => {
    const out = deriveClientRows(fixtureRows, q({ filter: { columnId: "payment", operator: "isNot", value: "paid" } }), adminCtx);
    expect(ids(out.rows)).toEqual(["r2", "r3", "r4"]);
  });

  it("a filter on an unreadable column is rejected and reported, never applied", () => {
    const ctx = { ...adminCtx, readableColumnIds: readableFor(AGENT), user: { id: AGENT.id } };
    const filter: FilterNode = { columnId: "salary", operator: "gt", value: 60 };
    expect(validateFilter(filter, fixtureSchema, registry, ctx.readableColumnIds).length).toBeGreaterThan(0);
    const out = deriveClientRows(fixtureRows, q({ filter }), ctx);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatchObject({ code: "unreadableColumn", columnId: "salary" });
    // no filter applied (not silently narrowed): every row is still present
    expect(ids(out.rows)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("a filter on an unknown column is reported", () => {
    const out = deriveClientRows(fixtureRows, q({ filter: { columnId: "nope", operator: "is", value: "x" } }), adminCtx);
    expect(out.errors[0]).toMatchObject({ code: "unknownColumn" });
  });

  it("search only matches readable columns", () => {
    const agentCtx = { ...adminCtx, readableColumnIds: readableFor(AGENT) };
    // salary 70 is only on r2 and is hidden for agents
    expect(ids(deriveClientRows(fixtureRows, q({ search: "70" }), adminCtx).rows)).toEqual(["r2"]);
    expect(ids(deriveClientRows(fixtureRows, q({ search: "70" }), agentCtx).rows)).toEqual([]);
  });

  it("sort specs on unreadable columns are dropped", () => {
    const agentCtx = { ...adminCtx, readableColumnIds: readableFor(AGENT) };
    const out = deriveClientRows(fixtureRows, q({ sort: [{ columnId: "salary", dir: "desc" }] }), agentCtx);
    expect(ids(out.rows)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("uses getCellValue (e.g. computed formulas) for filter and sort", () => {
    const getCellValue = (row: GridRow, column: { key: string }) =>
      column.key === "total" ? ((row.cells.score as number | null) ?? 0) * 2 : row.cells[column.key];
    const out = deriveClientRows(
      fixtureRows,
      q({ filter: { columnId: "total", operator: "gte", value: 20 }, sort: [{ columnId: "total", dir: "desc" }] }),
      { ...adminCtx, getCellValue },
    );
    expect(ids(out.rows)).toEqual(["r4", "r1"]);
  });
});

describe("makePostSortRows", () => {
  it("restores core order after a simulated AG sort", () => {
    const out = deriveClientRows(fixtureRows, q({ sort: [{ columnId: "score", dir: "desc" }] }), adminCtx);
    expect(ids(out.rows)).toEqual(["r4", "r1", "r2", "r3"]);
    const nodes = [
      { data: fixtureRows[2] },
      { data: undefined },
      { data: fixtureRows[0] },
      { data: { ...fixtureRows[0], id: "unknown" } },
      { data: fixtureRows[3] },
      { data: fixtureRows[1] },
    ] as unknown as IRowNode<GridRow>[];
    const postSortRows = makePostSortRows<GridRow>(() => out.orderIndex);
    postSortRows({ nodes } as PostSortRowsParams<GridRow>);
    expect(nodes.map((n) => n.data?.id ?? "none")).toEqual(["r4", "r1", "r2", "r3", "none", "unknown"]);
  });
});

describe("toGridQuery", () => {
  it("builds a GridQuery from query state", () => {
    const state = q({
      filter: { columnId: "payment", operator: "is", value: "paid" },
      sort: [{ columnId: "name", dir: "asc" }],
      search: "a",
      groupBy: [{ columnId: "payment" }],
    });
    expect(toGridQuery(state, { cursor: null, limit: 50 }, { includeTotal: true })).toEqual({
      filter: state.filter,
      sort: state.sort,
      search: "a",
      groupBy: [{ columnId: "payment" }],
      page: { cursor: null, limit: 50 },
      includeTotal: true,
    });
    expect(toGridQuery(q({}), { offset: 0, limit: 10 })).toEqual({ filter: null, sort: [], page: { offset: 0, limit: 10 } });
  });
});

describe("combineFilters", () => {
  const a: FilterNode = { columnId: "payment", operator: "is", value: "paid" };
  const b: FilterNode = { columnId: "score", operator: "gt", value: 1 };
  const c: FilterNode = { columnId: "name", operator: "contains", value: "a" };
  const orAB: FilterNode = { op: "or", children: [a, b] };

  it("returns null when nothing to combine", () => {
    expect(combineFilters()).toBeNull();
    expect(combineFilters(null, undefined, { op: "and", children: [] })).toBeNull();
  });

  it("returns a single node unchanged", () => {
    expect(combineFilters(null, a)).toBe(a);
    expect(combineFilters(orAB, null)).toBe(orAB);
  });

  it("AND-combines and flattens AND groups; OR groups become one child", () => {
    expect(combineFilters({ op: "and", children: [a, b] }, c)).toEqual({ op: "and", children: [a, b, c] });
    expect(combineFilters(orAB, c)).toEqual({ op: "and", children: [orAB, c] });
  });

  it("keeps depth <= 2 when an OR of AND groups meets plain conditions", () => {
    const deep: FilterNode = { op: "or", children: [{ op: "and", children: [a, b] }, c] };
    const out = combineFilters(deep, { columnId: "active", operator: "isTrue" });
    expect(out).not.toBeNull();
    expect(validateFilter(out, fixtureSchema, registry, readableFor(ADMIN))).toEqual([]);
    for (const r of fixtureRows) {
      const viaCombined = deriveClientRows([r], q({ filter: out }), adminCtx).rows.length;
      const viaBoth =
        deriveClientRows([r], q({ filter: deep }), adminCtx).rows.length &&
        deriveClientRows([r], q({ filter: { columnId: "active", operator: "isTrue" } }), adminCtx).rows.length;
      expect(viaCombined).toBe(viaBoth);
    }
  });
});
