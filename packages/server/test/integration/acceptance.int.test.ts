import { afterAll, beforeAll, expect, it } from "vitest";
import type { ServerWarning } from "../../src/context";
import { createDrizzleDataSource } from "../../src/datasource/create-drizzle-data-source";
import {
  type DataSource,
  type FilterNode,
  type GridQuery,
  type GridRow,
  type SortSpec,
  type ViewDef,
  createDefaultRegistry,
  createRolePermissionResolver,
} from "../../src/internal/core";
import type { GridTables } from "../../src/storage/tables";
import {
  FIXTURE_GRID_ID,
  FIXTURE_NOW,
  FIXTURE_TZ,
  SECTION_8_EXPECTED_IDS,
  SECTION_8_FILTER,
  SECTION_8_NEXT_DAY_EXPECTED_IDS,
  admissionsRows,
  admissionsSchema,
} from "../fixtures/admissions";
import { type StartedMysql, describeMysql, setupGrid, startMysql } from "./mysql";
import { referenceIds } from "./reference";

describeMysql("§8 acceptance + in-memory parity (MySQL 8.4)", () => {
  let mysql: StartedMysql;
  let tables: GridTables;
  const warnings: ServerWarning[] = [];
  const ds = (now: Date = FIXTURE_NOW): DataSource<GridRow> =>
    createDrizzleDataSource({
      db: mysql.db,
      gridId: FIXTURE_GRID_ID,
      schema: admissionsSchema,
      registry: createDefaultRegistry(),
      resolver: createRolePermissionResolver(),
      user: { id: "u1", roles: ["admin"] },
      tz: FIXTURE_TZ,
      now: () => now,
      tables,
      onWarning: (w) => warnings.push(w),
    });
  const ids = async (source: DataSource<GridRow>, filter: FilterNode | null, sort: SortSpec[] = []) =>
    (await source.fetch({ filter, sort, page: { offset: 0, limit: 1000 } })).rows.map((r) => r.id);
  const reference = (filter: FilterNode | null, sort: SortSpec[] = []) =>
    referenceIds(admissionsSchema, admissionsRows, { filter, sort }, { now: FIXTURE_NOW, tz: FIXTURE_TZ, userId: "u1" });

  beforeAll(async () => {
    mysql = await startMysql();
    tables = await setupGrid(mysql.db, admissionsSchema, admissionsRows, { gridId: FIXTURE_GRID_ID, now: FIXTURE_NOW });
  }, 180_000);
  afterAll(async () => {
    await mysql?.stop();
  });

  it("§8: isNot Paid AND within yesterday (IST) includes empty status, excludes the UTC-yesterday day", async () => {
    expect(await ids(ds(), SECTION_8_FILTER)).toEqual(SECTION_8_EXPECTED_IDS);
  });

  it("§8: the saved view reopened the next day still means 'yesterday'", async () => {
    const view: ViewDef = {
      id: "v1",
      name: "Unpaid called yesterday",
      filter: SECTION_8_FILTER,
      sort: [],
      columnState: [],
      groupBy: [],
      pageSize: 50,
    };
    const reopened = JSON.parse(JSON.stringify(view)) as ViewDef;
    const nextDay = new Date(FIXTURE_NOW.getTime() + 86_400_000);
    expect(await ids(ds(nextDay), reopened.filter)).toEqual(SECTION_8_NEXT_DAY_EXPECTED_IDS);
  });

  const parityCases: [string, FilterNode | null, SortSpec[]][] = [
    ["text contains (ci)", { columnId: "name", operator: "contains", value: "A" }, [{ columnId: "name", dir: "asc" }]],
    ["text notContains incl. empty", { columnId: "email", operator: "notContains", value: "x.in" }, []],
    ["number neq incl. empty", { columnId: "paid", operator: "neq", value: 50000 }, [{ columnId: "paid", dir: "desc" }]],
    ["number between", { columnId: "fee", operator: "between", value: { from: 30000, to: 45000 } }, [{ columnId: "fee", dir: "asc" }]],
    ["select isNoneOf incl. empty", { columnId: "payment_status", operator: "isNoneOf", value: ["paid", "failed"] }, []],
    ["multi hasNoneOf incl. empty", { columnId: "tags", operator: "hasNoneOf", value: ["hot"] }, []],
    ["multi hasAllOf", { columnId: "tags", operator: "hasAllOf", value: ["hot", "cold"] }, []],
    ["user isNotMe incl. empty", { columnId: "owner", operator: "isNotMe", value: { me: true } }, []],
    ["boolean isFalse excludes empty", { columnId: "is_active", operator: "isFalse" }, []],
    ["date isBetween inclusive", { columnId: "call_date", operator: "isBetween", value: { from: "2026-09-23", to: "2026-09-24" } }, [{ columnId: "call_date", dir: "desc" }]],
    ["datetime isWithin yesterday", { columnId: "called_at", operator: "isWithin", value: { relative: "yesterday" } }, [{ columnId: "called_at", dir: "asc" }]],
    ["no filter, sort nulls last", null, [{ columnId: "paid", dir: "asc" }]],
  ];
  for (const [name, filter, sort] of parityCases) {
    it(`parity: ${name}`, async () => {
      expect(await ids(ds(), filter, sort)).toEqual(reference(filter, sort));
    });
  }

  it("search is case-insensitive across readable text columns", async () => {
    const res = await ds().fetch({ filter: null, sort: [], search: "ESHA", page: { offset: 0, limit: 100 } });
    expect(res.rows.map((r) => r.id)).toEqual(["r05"]);
  });

  it("cursor paging walks the whole result with no duplicates or gaps", async () => {
    const source = ds();
    const sort: SortSpec[] = [{ columnId: "paid", dir: "desc" }, { columnId: "name", dir: "asc" }];
    const all = await ids(source, null, sort);
    const seen: string[] = [];
    let page: GridQuery["page"] = { cursor: "", limit: 3 };
    for (let i = 0; i < 20; i++) {
      const res = await source.fetch({ filter: null, sort, page });
      seen.push(...res.rows.map((r) => r.id));
      if (!res.nextCursor) break;
      page = { cursor: res.nextCursor, limit: 3 };
    }
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("grouping counts and aggregates match the fixture", async () => {
    const res = await ds().fetch({
      filter: null,
      sort: [],
      groupBy: [{ columnId: "payment_status", aggregations: [{ columnId: "fee", agg: "sum" }] }],
      page: { offset: 0, limit: 50 },
    });
    const byValue = Object.fromEntries((res.groups ?? []).map((g) => [String(g.value), g.count]));
    expect(byValue).toEqual({ paid: 2, pending: 3, failed: 2, null: 3 });
    expect(res.groups?.at(-1)?.value).toBeNull();
  });

  it("translatable formula filters in SQL and matches in-memory (÷0/empty → parity)", async () => {
    warnings.length = 0;
    const filter: FilterNode = { columnId: "balance", operator: "gt", value: 10000 };
    expect(await ids(ds(), filter)).toEqual(reference(filter));
    expect(warnings).toEqual([]);
  });

  it("non-translatable formula uses the fallback, warns, and matches in-memory", async () => {
    warnings.length = 0;
    const filter: FilterNode = { columnId: "active_fee", operator: "gt", value: 0 };
    expect(await ids(ds(), filter, [{ columnId: "active_fee", dir: "desc" }])).toEqual(
      reference(filter, [{ columnId: "active_fee", dir: "desc" }]),
    );
    expect(warnings.map((w) => w.code)).toEqual(["FORMULA_FALLBACK"]);
  });
});
