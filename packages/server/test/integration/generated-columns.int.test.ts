import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { ServerWarning } from "../../src/context";
import { createDrizzleDataSource } from "../../src/datasource/create-drizzle-data-source";
import {
  type ColumnDef,
  type DataSource,
  type FilterNode,
  type GridRow,
  type GridSchema,
  type SortSpec,
  createDefaultRegistry,
  createRolePermissionResolver,
} from "../../src/internal/core";
import type { GridTables } from "../../src/storage/tables";
import {
  FIXTURE_COLUMN_IDS,
  FIXTURE_GRID_ID,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  createServerFixtureRowPartials,
  createServerFixtureRows,
  serverFixtureSchema,
} from "../fixtures/admissions";
import { type StartedMysql, describeMysql, seedRows, setupGrid, startMysql } from "./mysql";
import { referenceIds } from "./reference";

const NOW = new Date(FIXTURE_NOW);
const col = FIXTURE_COLUMN_IDS;
const env = { now: NOW, tz: FIXTURE_TIME_ZONE, userId: "u1" };

/** Server fixture with `name` (text) and the `balance` formula (`{fee} - {paid}`) indexed → `gc_name`, `gc_balance`. */
const schema: GridSchema = {
  ...serverFixtureSchema,
  columns: serverFixtureSchema.columns.map(
    (c): ColumnDef => (c.id === col.name || c.id === col.balance ? { ...c, indexed: true } : c),
  ),
};
const rows = createServerFixtureRows();

const T = "2026-09-01T00:00:00.000Z";
const ACCENT_GRID = "accents-gc";
const accentRows: GridRow[] = [
  { id: "a1", version: 1, updatedAt: T, cells: { name: "José Ruiz" } },
  { id: "a2", version: 1, updatedAt: T, cells: { name: "JOSE Ortiz" } },
  { id: "a3", version: 1, updatedAt: T, cells: { name: "Renée" } },
  { id: "a4", version: 1, updatedAt: T, cells: { name: "renee" } },
];

describeMysql("generated columns (MySQL 8.4)", () => {
  let mysql: StartedMysql;
  let tables: GridTables;
  const warnings: ServerWarning[] = [];
  const ds = (gridId = FIXTURE_GRID_ID): DataSource<GridRow> =>
    createDrizzleDataSource({
      db: mysql.db,
      gridId,
      schema,
      registry: createDefaultRegistry(),
      resolver: createRolePermissionResolver(),
      user: { id: "u1", roles: ["admin"] },
      tz: FIXTURE_TIME_ZONE,
      now: () => NOW,
      tables,
      generatedColumns: "assumePresent",
      onWarning: (w) => warnings.push(w),
    });
  const ids = async (source: DataSource<GridRow>, filter: FilterNode | null, sort: SortSpec[] = []) =>
    (await source.fetch({ filter, sort, page: { offset: 0, limit: 1000 } })).rows.map((r) => r.id);

  /** EXPLAIN of the last SELECT the datasource ran against grid_rows. */
  const explainLastSelect = async () => {
    const q = [...mysql.queries].reverse().find((x) => /^select/i.test(x.sql) && x.sql.includes("grid_rows"));
    if (!q) throw new Error("no captured select");
    const [plan] = (await mysql.db.execute(sql.raw(`EXPLAIN ${inlineParams(q.sql, q.params)}`))) as unknown as [
      { key: string | null; possible_keys: string | null }[],
    ];
    return { sql: q.sql, plan };
  };

  beforeAll(async () => {
    mysql = await startMysql();
    tables = await setupGrid(mysql.db, schema, createServerFixtureRowPartials(), { gridId: FIXTURE_GRID_ID, now: NOW });
    await seedRows(mysql.db, tables, schema, accentRows, { gridId: ACCENT_GRID, now: NOW });
  }, 180_000);
  afterAll(async () => {
    await mysql?.stop();
  });

  it("creates gc_ columns + indexes for the indexed text column and the translatable formula", async () => {
    const [idx] = (await mysql.db.execute(sql`SHOW INDEX FROM grid_rows`)) as unknown as [{ Key_name: string }[]];
    expect(idx.map((i) => i.Key_name)).toEqual(expect.arrayContaining(["idx_gc_fee", "idx_gc_name", "idx_gc_balance"]));
  });

  it("the datasource's own SQL filters on gc_fee / gc_name / gc_balance and EXPLAIN offers the idx_gc_ index", async () => {
    const cases: [string, FilterNode][] = [
      ["fee", { columnId: col.fee, operator: "eq", value: 50000 }],
      ["name", { columnId: col.name, operator: "is", value: "asha verma" }],
      ["balance", { columnId: col.balance, operator: "eq", value: 0 }],
    ];
    for (const [key, filter] of cases) {
      mysql.queries.length = 0;
      await ids(ds(), filter);
      const { sql: text, plan } = await explainLastSelect();
      expect(text).toContain(`\`gc_${key}\``);
      expect({ key, possible: plan[0]?.possible_keys ?? "" }).toEqual({ key, possible: expect.stringContaining(`idx_gc_${key}`) });
    }
  });

  it("materialized formula (gc_balance) filters/sorts exactly like core in-memory, without fallback", async () => {
    warnings.length = 0;
    const cases: [FilterNode, SortSpec[]][] = [
      [{ columnId: col.balance, operator: "gt", value: 10000 }, [{ columnId: col.balance, dir: "desc" }]],
      [{ columnId: col.balance, operator: "eq", value: 0 }, []],
      [{ columnId: col.balance, operator: "isEmpty" }, []],
      [{ columnId: col.balance, operator: "neq", value: 0 }, [{ columnId: col.balance, dir: "asc" }]],
    ];
    for (const [filter, sort] of cases) {
      expect({ filter, ids: await ids(ds(), filter, sort) }).toEqual({
        filter,
        ids: await referenceIds(schema, rows, { filter, sort }, env),
      });
    }
    expect(warnings).toEqual([]);
  });

  it("indexed text column (gc_name) is case-insensitive but accent-sensitive, like core", async () => {
    const cases: FilterNode[] = [
      { columnId: col.name, operator: "is", value: "RENEE" },
      { columnId: col.name, operator: "is", value: "josé ruiz" },
      { columnId: col.name, operator: "contains", value: "jose" },
      { columnId: col.name, operator: "startsWith", value: "rené" },
    ];
    for (const filter of cases) {
      expect({ filter, ids: await ids(ds(ACCENT_GRID), filter) }).toEqual({
        filter,
        ids: await referenceIds(schema, accentRows, { filter, sort: [] }, env),
      });
    }
  });
});

/** Inlines `?` params for EXPLAIN (test-only; params are fixture values). */
function inlineParams(text: string, params: unknown[]): string {
  let i = 0;
  return text.replace(/\?/g, () => {
    const p = params[i++];
    if (p === null || p === undefined) return "NULL";
    if (typeof p === "number" || typeof p === "bigint") return String(p);
    if (typeof p === "boolean") return p ? "TRUE" : "FALSE";
    return `'${String(p).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
  });
}
