import { sql } from "drizzle-orm";
import { datetime, decimal, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import type { GridDb } from "../../../src/changes/db";
import { createCellColorStore } from "../../../src/colors/color-store";
import { MissingTableError } from "../../../src/errors";
import { type GridSchema, createRolePermissionResolver } from "../../../src/internal/core";
import { type SqlViewDataSourceOptions, createSqlViewDataSource } from "../../../src/sqlview/create-sql-view-data-source";
import { type FakeCall, createFakeMysql } from "../../helpers/fake-mysql";
import { col } from "../../helpers/schemas";

const leads = mysqlTable("leads", {
  id: int("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  fee: decimal("fee", { precision: 10, scale: 2 }),
  secret: varchar("secret", { length: 16 }),
  version: int("version"),
  updatedAt: datetime("updated_at", { fsp: 3 }),
});

const admin = { roles: ["admin"] };
const schema: GridSchema = {
  id: "leads",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("fee", "number", { permissions: { read: "all", edit: admin } }),
    col("secret", "text", { permissions: { read: admin, edit: admin } }),
  ],
};
const COLUMNS = { name: { expr: leads.name }, fee: { expr: leads.fee }, secret: { expr: leads.secret } };
const COLORS = JSON.stringify({ name: "red", fee: "blue", secret: "green" });
const LOAD = "`sg_base`.`id` IN (";

/** `fetch` answers [id, sg_bv, m_name, m_fee, sg_colors]; the write path's row load also has m_secret and sg_ex. */
const respond = (c: FakeCall): unknown[][] | undefined => {
  if (!c.sql.startsWith("select")) return undefined;
  if (c.sql.includes(LOAD)) {
    const ids = c.params.filter((p) => p === "7" || p === "8");
    return ids.map((id) => [Number(id), 1, "Asha", "10.00", "s", id === "7" ? COLORS : null, null]);
  }
  return [[7, 1, "Asha", "10.00", COLORS], [8, 1, "Bo", null, null]];
};

function make(extra: Partial<SqlViewDataSourceOptions> = {}, roles = ["counsellor"], withStore = true) {
  const fake = createFakeMysql((c) => (c.rowsAsArray ? (respond(c) ?? []) : undefined));
  const db = fake.db as unknown as GridDb;
  const colors = createCellColorStore({ db, table: "grid_cell_colors" });
  const ds = createSqlViewDataSource({
    db,
    schema,
    resolver: createRolePermissionResolver(),
    user: { id: "u1", roles },
    baseQuery: () => sql`SELECT * FROM leads`,
    columns: COLUMNS,
    rowId: leads.id,
    version: leads.version,
    write: { update: async () => ({ applied: [], version: 1 }), delete: async () => {} },
    ...(withStore ? { colors } : {}),
    ...extra,
  });
  return { ds, ...fake };
}

describe("createSqlViewDataSource: cell colors (v0.4)", () => {
  it("capabilities: read with a store, write with a store AND write hooks, filter always", () => {
    expect(make({}, ["counsellor"], false).ds.capabilities().cellColors).toEqual({ read: false, write: false, filter: true });
    expect(make({}, ["counsellor"], false).ds.setCellColors).toBeUndefined();
    expect(make().ds.capabilities().cellColors).toEqual({ read: true, write: true, filter: true });
    const readOnly = make({ write: undefined });
    expect(readOnly.ds.capabilities().cellColors).toEqual({ read: true, write: false, filter: true });
    expect(readOnly.ds.setCellColors).toBeUndefined();
  });

  it("fetch LEFT JOINs the store on the row id and hydrates readable colors only", async () => {
    const { ds, statements } = make();
    const res = await ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 10 } });
    const q = statements()[0]?.sql ?? "";
    expect(q).toContain(
      "LEFT JOIN `grid_cell_colors` AS `sg_colors` ON `sg_colors`.`grid_id` = ? AND `sg_colors`.`row_id` = CONVERT(`sg_base`.`id` USING utf8mb4) COLLATE utf8mb4_bin",
    );
    expect(res.rows[0]?.colors).toEqual({ name: "red", fee: "blue" });
    expect(res.rows[1]).not.toHaveProperty("colors");
    expect(res.rows[0]?.version).toBe(1);
  });

  it("colorIs reads the joined document", async () => {
    const { ds, statements } = make();
    await ds.fetch({ filter: { columnId: "name", operator: "colorIs", value: ["red"] }, sort: [], page: { offset: 0, limit: 10 } });
    expect(statements()[0]?.sql).toContain("(JSON_UNQUOTE(JSON_EXTRACT(`sg_colors`.`colors`, ?)) IS NOT NULL AND");
  });

  it("setCellColors uses the write path's row load and permissions, never the base-table hooks", async () => {
    let hookCalls = 0;
    const { ds, statements } = make({
      write: {
        update: async () => {
          hookCalls++;
          return { applied: [] };
        },
      },
    });
    const res = await ds.setCellColors?.({
      id: "b1",
      changes: [
        { rowId: "7", columnId: "name", color: "purple" },
        { rowId: "7", columnId: "fee", color: "red" },
        { rowId: "7", columnId: "secret", color: "red" },
        { rowId: "9", columnId: "name", color: "red" },
      ],
    });
    expect(res?.applied).toEqual([{ rowId: "7", columnId: "name", color: "purple" }]);
    expect(res?.rejected).toEqual([
      { rowId: "7", columnId: "fee", message: "Read-only" },
      { rowId: "7", columnId: "secret", message: "Column not found" },
      { rowId: "9", columnId: "name", message: "Row not found" },
    ]);
    expect(hookCalls).toBe(0);
    const upsert = statements().find((s) => s.sql.startsWith("insert into `grid_cell_colors`"));
    expect(upsert?.params.slice(0, 3)).toEqual(["leads", "7", JSON.stringify({ name: "purple" })]);
    expect(res?.rows?.map((r) => [r.id, r.colors])).toEqual([["7", { name: "red", fee: "blue" }]]);
  });

  it("deleteRows removes the rows' color entries in the same transaction", async () => {
    const { ds, statements } = make();
    await ds.deleteRows(["7", "8"]);
    const del = statements().find((s) => s.sql.startsWith("delete from `grid_cell_colors`"));
    expect(del?.params).toEqual(["leads", "7", "8"]);
  });

  it("the updated_at feed also moves on color writes; the row's own updatedAt does not", async () => {
    const { ds, statements } = make({ updatedAt: leads.updatedAt });
    await ds.getChanges?.("");
    const boot = statements()[0]?.sql ?? "";
    expect(boot).toContain("GREATEST(`sg_base`.`updated_at`, COALESCE(`sg_colors`.`updated_at`, `sg_base`.`updated_at`))");
    await ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 10 } });
    const fetchSql = statements()[1]?.sql ?? "";
    expect(fetchSql.split("GREATEST").length).toBe(1); // sg_ua is the base updated_at only
  });

  it("a missing color table is reported as MISSING_TABLE naming createCellColorsTableDDL", async () => {
    const fake = createFakeMysql(() => {
      throw Object.assign(new Error("Table 'db.grid_cell_colors' doesn't exist"), { errno: 1146, code: "ER_NO_SUCH_TABLE" });
    });
    const db = fake.db as unknown as GridDb;
    const ds = createSqlViewDataSource({
      db,
      schema,
      resolver: createRolePermissionResolver(),
      user: { id: "u1", roles: ["admin"] },
      baseQuery: () => sql`SELECT * FROM leads`,
      columns: COLUMNS,
      rowId: leads.id,
      colors: createCellColorStore({ db, table: "grid_cell_colors" }),
    });
    const err = await ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 10 } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingTableError);
    expect((err as MissingTableError).details).toEqual({ table: "grid_cell_colors", ddl: "createCellColorsTableDDL" });
  });
});
