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
  FIXTURE_COLUMN_IDS,
  FIXTURE_GRID_ID,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  SECTION_8_EXPECTED_IDS,
  SECTION_8_FILTER,
  SECTION_8_NEXT_DAY_EXPECTED_IDS,
  SERVER_FIXTURE_COLUMN_IDS,
  createServerFixtureRowPartials,
  createServerFixtureRows,
  serverFixtureSchema,
} from "../fixtures/admissions";
import { type StartedMysql, describeMysql, seedRows, setupGrid, startMysql } from "./mysql";
import { referenceGroups, referenceIds } from "./reference";

const NOW = new Date(FIXTURE_NOW);
const rows = createServerFixtureRows();
const rowPartials = createServerFixtureRowPartials();
const col = FIXTURE_COLUMN_IDS;
const extra = SERVER_FIXTURE_COLUMN_IDS;

describeMysql("§8 acceptance + in-memory parity (MySQL 8.4)", () => {
  let mysql: StartedMysql;
  let tables: GridTables;
  const warnings: ServerWarning[] = [];
  const ds = (now: Date = NOW): DataSource<GridRow> =>
    createDrizzleDataSource({
      db: mysql.db,
      gridId: FIXTURE_GRID_ID,
      schema: serverFixtureSchema,
      registry: createDefaultRegistry(),
      resolver: createRolePermissionResolver(),
      user: { id: "u1", roles: ["admin"] },
      tz: FIXTURE_TIME_ZONE,
      now: () => now,
      tables,
      onWarning: (w) => warnings.push(w),
    });
  const ids = async (source: DataSource<GridRow>, filter: FilterNode | null, sort: SortSpec[] = []) =>
    (await source.fetch({ filter, sort, page: { offset: 0, limit: 1000 } })).rows.map((r) => r.id);
  const reference = (filter: FilterNode | null, sort: SortSpec[] = []) =>
    referenceIds(serverFixtureSchema, rows, { filter, sort }, { now: NOW, tz: FIXTURE_TIME_ZONE, userId: "u1" });

  beforeAll(async () => {
    mysql = await startMysql();
    tables = await setupGrid(mysql.db, serverFixtureSchema, rowPartials, { gridId: FIXTURE_GRID_ID, now: NOW });
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
    const nextDay = new Date(NOW.getTime() + 86_400_000);
    expect(await ids(ds(nextDay), reopened.filter)).toEqual(SECTION_8_NEXT_DAY_EXPECTED_IDS);
  });

  const parityCases: [string, FilterNode | null, SortSpec[]][] = [
    ["text contains (ci)", { columnId: col.name, operator: "contains", value: "a" }, [{ columnId: col.name, dir: "asc" }]],
    ["text notContains incl. empty", { columnId: col.email, operator: "notContains", value: "example.com" }, []],
    ["number neq incl. empty", { columnId: col.paid, operator: "neq", value: 55000 }, [{ columnId: col.paid, dir: "desc" }]],
    ["number between", { columnId: col.fee, operator: "between", value: { from: 30000, to: 50000 } }, [{ columnId: col.fee, dir: "asc" }]],
    ["select isNoneOf incl. empty", { columnId: col.status, operator: "isNoneOf", value: ["paid", "partial"] }, []],
    ["multi hasNoneOf incl. empty", { columnId: col.tags, operator: "hasNoneOf", value: ["scholar"] }, []],
    ["multi hasAllOf", { columnId: col.tags, operator: "hasAllOf", value: ["scholar", "referral"] }, []],
    ["user isNotMe incl. empty", { columnId: col.owner, operator: "isNotMe", value: { me: true } }, []],
    ["boolean isFalse excludes empty", { columnId: col.isActive, operator: "isFalse" }, []],
    ["date isBetween inclusive", { columnId: col.callDate, operator: "isBetween", value: { from: "2026-09-23", to: "2026-09-24" } }, [{ columnId: col.callDate, dir: "desc" }]],
    ["datetime isWithin yesterday", { columnId: col.calledAt, operator: "isWithin", value: { relative: "yesterday" } }, [{ columnId: col.calledAt, dir: "asc" }]],
    ["no filter, sort nulls last", null, [{ columnId: col.paid, dir: "asc" }]],
    // select sorts by the column's OPTION ORDER (paid, pending, partial), not alphabetically.
    ["select sort asc by option order", null, [{ columnId: col.status, dir: "asc" }]],
    ["select sort desc by option order", null, [{ columnId: col.status, dir: "desc" }]],
  ];
  for (const [name, filter, sort] of parityCases) {
    it(`parity: ${name}`, async () => {
      expect(await ids(ds(), filter, sort)).toEqual(await reference(filter, sort));
    });
  }

  it("search is case-insensitive across readable text columns", async () => {
    const res = await ds().fetch({ filter: null, sort: [], search: "ESHA", page: { offset: 0, limit: 100 } });
    expect(res.rows.map((r) => r.id)).toEqual(["r5"]);
  });

  it("cursor paging walks the whole result with no duplicates or gaps", async () => {
    const source = ds();
    const sort: SortSpec[] = [{ columnId: col.paid, dir: "desc" }, { columnId: col.name, dir: "asc" }];
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

  it("cursor paging over a select sort (option order) matches the in-memory order with no dups/gaps", async () => {
    const source = ds();
    const sort: SortSpec[] = [{ columnId: col.status, dir: "asc" }, { columnId: col.paid, dir: "desc" }];
    const seen: string[] = [];
    let page: GridQuery["page"] = { cursor: "", limit: 2 };
    for (let i = 0; i < 20; i++) {
      const res = await source.fetch({ filter: null, sort, page });
      seen.push(...res.rows.map((r) => r.id));
      if (!res.nextCursor) break;
      page = { cursor: res.nextCursor, limit: 2 };
    }
    expect(seen).toEqual(await reference(null, sort));
  });

  it("text matching is case-insensitive but accent-SENSITIVE, like core", async () => {
    const gridId = "accents";
    const accentRows: GridRow[] = [
      { id: "a1", version: 1, updatedAt: "2026-09-01T00:00:00.000Z", cells: { name: "José Ruiz" } },
      { id: "a2", version: 1, updatedAt: "2026-09-01T00:00:00.000Z", cells: { name: "JOSE Ortiz" } },
      { id: "a3", version: 1, updatedAt: "2026-09-01T00:00:00.000Z", cells: { name: "Renée" } },
      { id: "a4", version: 1, updatedAt: "2026-09-01T00:00:00.000Z", cells: { name: "renee" } },
    ];
    await seedRows(
      mysql.db,
      tables,
      serverFixtureSchema,
      accentRows.map((r) => ({ id: r.id, cells: r.cells })),
      { gridId, now: NOW },
    );
    const source = createDrizzleDataSource({
      db: mysql.db,
      gridId,
      schema: serverFixtureSchema,
      registry: createDefaultRegistry(),
      resolver: createRolePermissionResolver(),
      user: { id: "u1", roles: ["admin"] },
      tz: FIXTURE_TIME_ZONE,
      now: () => NOW,
      tables,
    });
    const env = { now: NOW, tz: FIXTURE_TIME_ZONE, userId: "u1" };
    const cases: FilterNode[] = [
      { columnId: col.name, operator: "contains", value: "jose" },
      { columnId: col.name, operator: "contains", value: "josé" },
      { columnId: col.name, operator: "is", value: "RENEE" },
      { columnId: col.name, operator: "isNot", value: "renée" },
      { columnId: col.name, operator: "startsWith", value: "rené" },
    ];
    for (const filter of cases) {
      const sort: SortSpec[] = [];
      const got = (await source.fetch({ filter, sort, page: { offset: 0, limit: 100 } })).rows.map((r) => r.id);
      expect({ filter, ids: got }).toEqual({
        filter,
        ids: await referenceIds(serverFixtureSchema, accentRows, { filter, sort }, env),
      });
    }
    const searched = (await source.fetch({ filter: null, sort: [], search: "JOSE", page: { offset: 0, limit: 100 } })).rows;
    expect(searched.map((r) => r.id)).toEqual(["a2"]);
  });

  it("grouping counts and aggregates match the in-memory reference", async () => {
    const res = await ds().fetch({
      filter: null,
      sort: [],
      groupBy: [{ columnId: col.status, aggregations: [{ columnId: col.fee, agg: "sum" }] }],
      page: { offset: 0, limit: 50 },
    });
    const expected = await referenceGroups(
      serverFixtureSchema,
      rows,
      col.status,
      [{ columnId: col.fee, agg: "sum" }],
      { now: NOW, tz: FIXTURE_TIME_ZONE, userId: "u1" },
    );
    expect(res.groups).toEqual(expected);
    expect(res.groups?.at(-1)?.value).toBeNull();
  });

  it("translatable formula filters in SQL and matches in-memory (÷0/empty → parity)", async () => {
    warnings.length = 0;
    const filter: FilterNode = { columnId: col.balance, operator: "gt", value: 10000 };
    expect(await ids(ds(), filter)).toEqual(await reference(filter));
    expect(warnings).toEqual([]);
  });

  it("non-translatable formula uses the fallback, warns, and matches in-memory", async () => {
    warnings.length = 0;
    const filter: FilterNode = { columnId: extra.activeFee, operator: "gt", value: 0 };
    expect(await ids(ds(), filter, [{ columnId: extra.activeFee, dir: "desc" }])).toEqual(
      await reference(filter, [{ columnId: extra.activeFee, dir: "desc" }]),
    );
    expect(warnings.map((w) => w.code)).toEqual(["FORMULA_FALLBACK"]);
  });
});
