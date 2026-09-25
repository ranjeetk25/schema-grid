import { sql } from "drizzle-orm";
import { boolean, date, datetime, decimal, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import { describe, expect, it } from "vitest";
import type { GridDb } from "../../../src/changes/db";
import { SchemaGridServerError, SchemaValidationError } from "../../../src/errors";
import { type GridSchema, createRolePermissionResolver } from "../../../src/internal/core";
import { createExtensionCellStore } from "../../../src/sqlview/extension-store";
import {
  type SqlViewDataSourceOptions,
  createSqlViewDataSource,
} from "../../../src/sqlview/create-sql-view-data-source";
import { type FakeCall, createFakeMysql } from "../../helpers/fake-mysql";
import { col } from "../../helpers/schemas";

const leads = mysqlTable("leads", {
  id: int("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  fee: decimal("fee", { precision: 10, scale: 2 }),
  paymentStatus: varchar("payment_status", { length: 16 }),
  callDate: date("call_date", { mode: "string" }),
  aiVerified: boolean("ai_verified"),
  version: int("version"),
  updatedAt: datetime("updated_at", { fsp: 3 }),
});

const OPTIONS = { options: [{ id: "paid", label: "Paid" }, { id: "pending", label: "Pending" }] };
const schema: GridSchema = {
  id: "leads",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("fee", "number"),
    col("paymentStatus", "select", { config: OPTIONS }),
    col("callDate", "date"),
    col("aiVerified", "boolean"),
  ],
};
const withNote: GridSchema = { ...schema, columns: [...schema.columns, col("note", "text")] };

const COLUMNS = {
  name: { expr: leads.name },
  fee: { expr: leads.fee },
  paymentStatus: { expr: leads.paymentStatus },
  callDate: { expr: leads.callDate },
  aiVerified: { expr: leads.aiVerified },
};

function make(extra: Partial<SqlViewDataSourceOptions> = {}, respond: (c: FakeCall) => unknown[][] | undefined = () => []) {
  const fake = createFakeMysql((c) => (c.rowsAsArray ? (respond(c) ?? []) : undefined));
  const db = fake.db as unknown as GridDb;
  const ds = createSqlViewDataSource({
    db,
    schema,
    resolver: createRolePermissionResolver(),
    user: { id: "u1", roles: ["admin"] },
    baseQuery: () => sql`SELECT * FROM leads WHERE deleted_at IS NULL`,
    columns: COLUMNS,
    rowId: leads.id,
    ...extra,
  });
  return { ds, db, calls: fake.calls, statements: fake.statements };
}

describe("createSqlViewDataSource", () => {
  it("rejects schema columns that are neither mapped nor backed by an extension store", () => {
    expect(() => make({ schema: withNote })).toThrow(SchemaValidationError);
    const extension = createExtensionCellStore({ db: drizzle.mock() as unknown as GridDb, table: "grid_extension_cells" });
    expect(() => make({ schema: withNote, extension })).not.toThrow();
  });

  it("capabilities: read-only without write hooks, no feed without updatedAt", () => {
    const caps = make().ds.capabilities();
    expect(caps.write).toEqual({ cells: false, createRows: false, deleteRows: false });
    expect(caps.changeFeed).toBe(false);
    expect(caps.maxPageSize).toBe(500);
    expect(make().ds.getChanges).toBeUndefined();
  });

  it("capabilities: write hooks, updates-only feed, defaultCapabilities override", () => {
    const { ds } = make({
      updatedAt: leads.updatedAt,
      write: { update: async () => ({ applied: [], version: 1 }), delete: async () => {} },
      defaultCapabilities: { maxPageSize: 200, groupBy: false },
    });
    const caps = ds.capabilities();
    expect(caps.write).toEqual({ cells: true, createRows: false, deleteRows: true });
    expect(caps.changeFeed).toBe("updates-only");
    expect(caps.maxPageSize).toBe(200);
    expect(caps.groupBy).toBe(false);
    expect(typeof ds.getChanges).toBe("function");
  });

  it("fetch wraps a raw SQL base as a derived table and resolves filter/sort over sg_base", async () => {
    const { ds, statements } = make({ defaultCapabilities: { maxPageSize: 200 } });
    await ds.fetch({
      filter: { columnId: "paymentStatus", operator: "isNot", value: "paid" },
      sort: [{ columnId: "fee", dir: "desc" }],
      page: { offset: 0, limit: 1000 },
    });
    const q = statements()[0];
    expect(q?.sql).toContain("from (SELECT * FROM leads WHERE deleted_at IS NULL) AS `sg_base`");
    expect(q?.sql).toContain("`sg_base`.`payment_status` <> ?");
    expect(q?.sql).toContain("`sg_base`.`id` ASC limit ?");
    expect(q?.sql).toContain("CRC32(JSON_ARRAY(`sg_base`.`name`, `sg_base`.`fee`");
    // limit clamped to maxPageSize (+1 look-ahead row)
    expect(q?.params.at(-1)).toBe(201);
  });

  it("a drizzle select base is parenthesised too, and the extension store is LEFT JOINed on the row id", async () => {
    const extension = createExtensionCellStore({ db: drizzle.mock() as unknown as GridDb, table: "grid_extension_cells" });
    const { ds, statements } = make({
      schema: withNote,
      extension,
      baseQuery: (ctx) => ctx.db.select().from(leads),
    });
    await ds.fetch({ filter: { columnId: "note", operator: "contains", value: "x" }, sort: [], page: { offset: 0, limit: 10 } });
    const q = statements()[0]?.sql ?? "";
    expect(q).toMatch(/from \(select .* from `leads`\) AS `sg_base` LEFT JOIN `grid_extension_cells` AS `sg_ext`/);
    expect(q).toContain("ON `sg_ext`.`grid_id` = ? AND `sg_ext`.`row_id` = CONVERT(`sg_base`.`id` USING utf8mb4) COLLATE utf8mb4_bin");
    expect(q).toContain("JSON_EXTRACT(`sg_ext`.`cells`, '$.note')");
  });

  it("hydrates driver values into cell values (DECIMAL string, TINYINT, DATE, extension JSON)", async () => {
    const extension = createExtensionCellStore({ db: drizzle.mock() as unknown as GridDb, table: "grid_extension_cells" });
    const { ds } = make({ schema: withNote, extension, version: leads.version, updatedAt: leads.updatedAt }, () => [
      // id, sg_bv, sg_ev, sg_ua, m_name, m_fee, m_paymentStatus, m_callDate, m_aiVerified, sg_cells
      [7, 3, 2, new Date("2026-09-24T10:00:00.000Z"), "Asha", "1500.00", "paid", "2026-09-24", 1, '{"note":"hi"}'],
    ]);
    const res = await ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 10 } });
    expect(res.rows).toEqual([
      {
        id: "7",
        version: 5,
        updatedAt: "2026-09-24T10:00:00.000Z",
        cells: { name: "Asha", fee: 1500, paymentStatus: "paid", callDate: "2026-09-24", aiVerified: true, note: "hi" },
      },
    ]);
  });

  it("without write hooks every edit is rejected as read-only, and create/delete are unsupported", async () => {
    const { ds } = make({}, () => [[1, 0, "A", null, null, null, null]]);
    const res = await ds.applyChanges({
      id: "b1",
      source: "edit",
      changes: [{ rowId: "1", columnId: "name", prev: "A", next: "B" }],
      baseVersions: { "1": 0 },
    });
    expect(res.errors).toEqual([{ rowId: "1", columnId: "name", message: "Read-only" }]);
    expect(res.applied).toEqual([]);
    await expect(ds.createRows([{ cells: { name: "x" } }])).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    await expect(ds.deleteRows(["1"])).rejects.toBeInstanceOf(SchemaGridServerError);
  });
});
