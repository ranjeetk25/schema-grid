import { describe, expect, it } from "vitest";
import { createInMemoryDataSource } from "../../src/memory/data-source";
import type { GridQuery } from "../../src/query/types";
import { createFixtureRows } from "../../src/testing/rows";
import {
  createFixtureSchema,
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_USERS,
} from "../../src/testing/schema";

const source = (user?: keyof typeof FIXTURE_USERS) =>
  createInMemoryDataSource({
    schema: createFixtureSchema(),
    rows: createFixtureRows(),
    now: () => new Date(FIXTURE_NOW),
    ...(user ? { user: { id: FIXTURE_USERS[user].id, roles: [...FIXTURE_USERS[user].roles] } } : {}),
  });
const q = (over: Partial<GridQuery>): GridQuery => ({
  filter: null,
  sort: [],
  page: { offset: 0, limit: 100 },
  ...over,
});
const feeAggs = [
  { columnId: C.fee, agg: "sum" as const },
  { columnId: C.fee, agg: "avg" as const },
  { columnId: C.name, agg: "count" as const },
];

describe("in-memory groupBy", () => {
  it("returns one group per status with aggregates, empty group last", async () => {
    const res = await source().fetch(q({ groupBy: [{ columnId: C.status, aggregations: feeAggs }] }));
    const summary = res.groups?.map((g) => [g.value, g.count, ...g.aggregates.map((a) => a.value)]);
    expect(summary).toEqual([
      ["paid", 2, 120000, 60000, 2],
      ["pending", 1, 60000, 60000, 1],
      ["partial", 1, 0, null, 1],
      [null, 1, 45000, 45000, 1],
    ]);
    expect(res.groups?.[0]?.aggregates[0]).toEqual({ columnId: C.fee, agg: "sum", value: 120000 });
    expect(new Set(res.groups?.map((g) => g.key)).size).toBe(4);
  });

  it("nests groups with children whose counts add up", async () => {
    const res = await source().fetch(q({ groupBy: [{ columnId: C.status }, { columnId: C.owner }] }));
    for (const g of res.groups ?? []) {
      const children = g.children ?? [];
      expect(children.length).toBeGreaterThan(0);
      expect(children.reduce((n, c) => n + c.count, 0)).toBe(g.count);
      for (const c of children) expect(c.columnId).toBe(C.owner);
    }
    expect(res.groups?.[0]?.children?.map((c) => (c.value as { id: string }).id)).toEqual(["u1", "u2"]);
  });

  it("aggregates ignore paging", async () => {
    const res = await source().fetch(
      q({ page: { offset: 0, limit: 1 }, groupBy: [{ columnId: C.status, aggregations: feeAggs }] }),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.groups?.[0]?.aggregates[0]?.value).toBe(120000);
  });

  it("date min/max aggregates return ISO strings", async () => {
    const res = await source().fetch(
      q({
        groupBy: [
          {
            columnId: C.isActive,
            aggregations: [
              { columnId: C.callDate, agg: "min" },
              { columnId: C.callDate, agg: "max" },
            ],
          },
        ],
      }),
    );
    const active = res.groups?.find((g) => g.value === true);
    expect(active?.aggregates.map((a) => a.value)).toEqual(["2026-09-20", "2026-09-24"]);
  });

  it("rejects sum on a date column", async () => {
    await expect(
      source().fetch(q({ groupBy: [{ columnId: C.status, aggregations: [{ columnId: C.callDate, agg: "sum" }] }] })),
    ).rejects.toMatchObject({ code: "invalidAggregation" });
  });

  it("rejects groupBy or aggregates on unreadable columns", async () => {
    await expect(source("counsellor").fetch(q({ groupBy: [{ columnId: C.notes }] }))).rejects.toMatchObject({
      code: "unreadableColumn",
    });
    await expect(
      source("counsellor").fetch(
        q({ groupBy: [{ columnId: C.status, aggregations: [{ columnId: C.notes, agg: "count" }] }] }),
      ),
    ).rejects.toMatchObject({ code: "unreadableColumn" });
  });

  it("still returns paged rows alongside groups", async () => {
    const res = await source().fetch(
      q({ page: { offset: 1, limit: 2 }, includeTotal: true, groupBy: [{ columnId: C.status }] }),
    );
    expect(res.rows.map((r) => r.id)).toEqual(["r2", "r3"]);
    expect(res.total).toBe(5);
    expect(res.groups).toHaveLength(4);
  });
});
