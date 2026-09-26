/**
 * v0.3 SQL-view integration findings on MySQL 8.4: per-cell write outcomes
 * (#1), mapRows / computed columns / defaultSort (#2) and zone-aware DATE /
 * DATETIME round trips in Asia/Kolkata (#4) — over a plain table read through
 * mysql2 pools with BOTH `timezone: "Z"` and the default local zone.
 */
import { and, eq, sql } from "drizzle-orm";
import { date, datetime, decimal, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { affectedRowsOf, type GridDb } from "../../src/changes/db";
import { type ColumnDef, type GridRow, type GridSchema, createRolePermissionResolver } from "../../src/internal/core";
import {
  type SqlViewDataSourceOptions,
  type SqlViewWriteHooks,
  createSqlViewDataSource,
} from "../../src/sqlview/create-sql-view-data-source";
import { FIXTURE_NOW, FIXTURE_TIME_ZONE } from "../fixtures/admissions";
import { type StartedMysql, describeMysql, startMysql } from "./mysql";

const NOW = new Date(FIXTURE_NOW); // 2026-09-24T21:00Z = 25 Sep 02:30 IST → "yesterday" in IST is 2026-09-24
const TZ = FIXTURE_TIME_ZONE;
const TABLE = "leads_tz";

const t = mysqlTable(TABLE, {
  id: int("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  fileKey: varchar("file_key", { length: 200 }),
  callDate: date("call_date", { mode: "string" }),
  calledAt: datetime("called_at", { fsp: 3 }),
  fee: decimal("fee", { precision: 12, scale: 2 }),
  version: int("version").notNull().default(1),
  updatedAt: datetime("updated_at", { fsp: 3 }).notNull(),
});

const AT = "2026-09-01T00:00:00.000Z";
const col = (key: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef =>
  ({ id: key, key, label: key, type, config: {}, order: 0, createdAt: AT, updatedAt: AT, ...extra }) as ColumnDef;
const schema: GridSchema = {
  id: "leads_tz",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("fileKey", "text", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
    col("callDate", "date"),
    col("calledAt", "datetime"),
    col("fee", "number"),
    col("url", "text"),
  ],
};
const DB_COLUMN: Record<string, string> = { name: "name", fileKey: "file_key", callDate: "call_date", calledAt: "called_at", fee: "fee" };

describeMysql("SQL view v0.3 hooks and time zones (MySQL 8.4)", () => {
  let mysql: StartedMysql;
  /** A second drizzle over a pool WITHOUT `timezone: "Z"` (mysql2's default local zone). */
  let localDb: GridDb;
  let closeLocal: () => Promise<void>;

  const hooks = (): SqlViewWriteHooks => ({
    async update(ctx, { rowId, changes, baseVersion, values }) {
      const applied = changes.filter((c) => c.columnId !== "fee");
      const errors = changes.filter((c) => c.columnId === "fee").map((c) => ({ rowId, columnId: c.columnId, message: "Fee is locked" }));
      if (applied.length === 0) return { errors };
      const sets = applied.map((c) => {
        const key = ctx.schema.columns.find((x) => x.id === c.columnId)?.key ?? "";
        return sql`${sql.identifier(DB_COLUMN[key] ?? key)} = ${values[key] ?? null}`;
      });
      const res = await ctx.db.execute(
        sql`UPDATE ${sql.identifier(TABLE)} SET ${sql.join(sets, sql`, `)}, version = version + 1, updated_at = NOW(3) WHERE id = ${Number(rowId)} AND version = ${baseVersion}`,
      );
      if (affectedRowsOf(res) === 0) {
        return { conflict: { rowId, columnId: applied[0]?.columnId ?? "", serverValue: null, serverVersion: baseVersion, updatedAt: AT } };
      }
      return { applied, errors, version: baseVersion + 1 };
    },
  });

  const make = (extra: Partial<SqlViewDataSourceOptions> = {}, db: GridDb = mysql.db) =>
    createSqlViewDataSource({
      db,
      schema,
      resolver: createRolePermissionResolver(),
      user: { id: "u1", roles: ["admin"] },
      tz: TZ,
      now: () => NOW,
      baseQuery: (ctx) => ctx.db.select().from(t),
      columns: {
        name: { expr: t.name },
        fileKey: { expr: t.fileKey },
        callDate: { expr: t.callDate },
        calledAt: { expr: t.calledAt },
        fee: { expr: t.fee },
      },
      computed: { url: { kind: "text" } },
      mapRows: async (rows, ctx) =>
        rows.map((r) => ({ ...r, cells: { ...r.cells, url: `https://signed/${String(r.cells.fileKey)}?u=${ctx.user.id}` } })),
      defaultSort: [{ columnId: "fee", dir: "desc" }],
      rowId: t.id,
      version: t.version,
      updatedAt: t.updatedAt,
      write: hooks(),
      ...extra,
    });

  const all = async (ds = make()) => (await ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 100 } })).rows;
  const row = async (id: string, ds = make()) => (await all(ds)).find((r) => r.id === id) as GridRow;
  const raw = async (id: number) => {
    const [rows] = (await mysql.db.execute(
      sql`SELECT DATE_FORMAT(call_date, '%Y-%m-%d') AS d, DATE_FORMAT(called_at, '%Y-%m-%d %H:%i:%s.%f') AS dt, name, fee FROM ${sql.identifier(TABLE)} WHERE id = ${id}`,
    )) as unknown as [{ d: string; dt: string; name: string; fee: string }[]];
    return rows[0] as { d: string; dt: string; name: string; fee: string };
  };

  beforeAll(async () => {
    mysql = await startMysql();
    const m = await import("mysql2/promise");
    const pool = m.createPool({ uri: mysql.uri, connectionLimit: 2 }); // default `timezone: "local"`
    localDb = drizzle(pool) as unknown as GridDb;
    closeLocal = () => pool.end();
  }, 180_000);
  beforeEach(async () => {
    const exec = (s: string) => mysql.db.execute(s as never);
    await exec(`DROP TABLE IF EXISTS \`${TABLE}\``);
    await exec(
      `CREATE TABLE \`${TABLE}\` (id INT NOT NULL, name VARCHAR(100) NULL, file_key VARCHAR(200) NULL, call_date DATE NULL, called_at DATETIME(3) NULL, fee DECIMAL(12,2) NULL, version INT NOT NULL DEFAULT 1, updated_at DATETIME(3) NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci`,
    );
    // Literal wall times: the driver converts nothing on the way in.
    await exec(
      `INSERT INTO \`${TABLE}\` (id, name, file_key, call_date, called_at, fee, updated_at) VALUES
        (1, 'Asha', 'docs/1.pdf', '2026-09-24', '2026-09-24 10:30:00', 100.00, '2026-09-20 00:00:00.000'),
        (2, 'Bhavesh', 'docs/2.pdf', '2026-09-23', '2026-09-23 23:45:00', 300.00, '2026-09-20 00:00:01.000'),
        (3, 'Chitra', NULL, NULL, NULL, 200.00, '2026-09-20 00:00:02.000')`,
    );
  });
  afterAll(async () => {
    await closeLocal?.();
    await mysql?.stop();
  });

  it("#1 the hook rejects one of two cells with a message → one applied, one error, version +1", async () => {
    const before = await row("1");
    const res = await make().applyChanges({
      id: "b1",
      source: "edit",
      changes: [
        { rowId: "1", columnId: "name", prev: "Asha", next: "Asha K" },
        { rowId: "1", columnId: "fee", prev: 100, next: 1 },
      ],
      baseVersions: { "1": before.version },
    });
    expect(res.applied.map((c) => c.columnId)).toEqual(["name"]);
    expect(res.errors).toEqual([{ rowId: "1", columnId: "fee", message: "Fee is locked" }]);
    expect(res.rejected).toBeUndefined();
    expect(res.versions).toEqual({ "1": before.version + 1 });
    const after = await raw(1);
    expect(after).toMatchObject({ name: "Asha K", fee: "100.00" });
    expect((await row("1")).version).toBe(before.version + 1);

    // Only the locked cell → nothing written, no version entry, the error is reported.
    const only = await make().applyChanges({
      id: "b2",
      source: "edit",
      changes: [{ rowId: "1", columnId: "fee", prev: 100, next: 2 }],
      baseVersions: { "1": before.version + 1 },
    });
    expect(only.applied).toEqual([]);
    expect(only.errors).toHaveLength(1);
    expect(only.versions).toEqual({});
  });

  it("#2 mapRows signs a URL from a hidden cell in fetch and in the change feed; url is neither sortable nor filterable", async () => {
    const admin = make();
    expect((await row("1", admin)).cells.url).toBe("https://signed/docs/1.pdf?u=u1");
    const counsellor = make({ user: { id: "c1", roles: ["counsellor"] } });
    const r1 = await row("1", counsellor);
    expect(r1.cells).not.toHaveProperty("fileKey");
    expect(r1.cells.url).toBe("https://signed/docs/1.pdf?u=c1");
    expect(admin.capabilities().sort).toEqual({ columnIds: ["name", "fileKey", "callDate", "calledAt", "fee"] });
    expect(admin.capabilities().defaultSort).toEqual([{ columnId: "fee", dir: "desc" }]);

    const boot = await admin.getChanges?.("");
    await admin.applyChanges({
      id: "f1",
      source: "edit",
      changes: [{ rowId: "2", columnId: "name", prev: "Bhavesh", next: "B." }],
      baseVersions: { "2": (await row("2", admin)).version },
    });
    const feed = await admin.getChanges?.(boot?.cursor as string);
    expect(feed?.rows.map((r) => [r.id, r.cells.name, r.cells.url])).toEqual([["2", "B.", "https://signed/docs/2.pdf?u=u1"]]);
  });

  it("#2 defaultSort orders `sort: []` fetches (fee desc) and drives keyset paging; an explicit sort wins", async () => {
    expect((await all()).map((r) => r.id)).toEqual(["2", "3", "1"]);
    const ds = make();
    const p1 = await ds.fetch({ filter: null, sort: [], page: { cursor: "", limit: 2 } });
    const p2 = await ds.fetch({ filter: null, sort: [], page: { cursor: p1.nextCursor as string, limit: 2 } });
    expect([...p1.rows, ...p2.rows].map((r) => r.id)).toEqual(["2", "3", "1"]);
    const asc = await ds.fetch({ filter: null, sort: [{ columnId: "name", dir: "asc" }], page: { offset: 0, limit: 10 } });
    expect(asc.rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("#4 DATE and DATETIME round-trip unchanged through fetch → edit → fetch in Asia/Kolkata, on both pool zones", async () => {
    for (const db of [mysql.db, localDb]) {
      const ds = make({}, db);
      const r1 = await row("1", ds);
      expect(r1.cells).toMatchObject({ callDate: "2026-09-24", calledAt: "2026-09-24T05:00:00.000Z" });
      // Write the very values we read back: the table must not move.
      const same = await ds.applyChanges({
        id: `rt-${db === localDb ? "local" : "z"}`,
        source: "edit",
        changes: [
          { rowId: "1", columnId: "calledAt", prev: null, next: "2026-09-24T05:00:00.000Z" },
          { rowId: "1", columnId: "callDate", prev: null, next: "2026-09-24" },
        ],
        baseVersions: { "1": r1.version },
      });
      expect(same.errors).toEqual([]);
      expect(same.applied).toHaveLength(2);
      expect(await raw(1)).toMatchObject({ d: "2026-09-24", dt: "2026-09-24 10:30:00.000000" });
      expect((await row("1", ds)).cells).toMatchObject({ callDate: "2026-09-24", calledAt: "2026-09-24T05:00:00.000Z" });
    }
    // A real edit lands as IST wall time.
    const ds = make();
    const v = (await row("1", ds)).version;
    await ds.applyChanges({
      id: "rt-3",
      source: "edit",
      changes: [
        { rowId: "1", columnId: "calledAt", prev: null, next: "2026-09-25T13:15:00.000Z" },
        { rowId: "1", columnId: "callDate", prev: null, next: "2026-09-25" },
      ],
      baseVersions: { "1": v },
    });
    expect(await raw(1)).toMatchObject({ d: "2026-09-25", dt: "2026-09-25 18:45:00.000000" });
    expect((await row("1", ds)).cells).toMatchObject({ callDate: "2026-09-25", calledAt: "2026-09-25T13:15:00.000Z" });
  });

  it("#4 filters: the §8 `isWithin yesterday` still matches on DATE, and DATETIME compares in UTC via CONVERT_TZ", async () => {
    const ids = async (filter: Parameters<ReturnType<typeof make>["fetch"]>[0]["filter"], ds = make()) =>
      (await ds.fetch({ filter, sort: [{ columnId: "name", dir: "asc" }], page: { offset: 0, limit: 10 } })).rows.map((r) => r.id);
    expect(await ids({ columnId: "callDate", operator: "isWithin", value: { relative: "yesterday" } })).toEqual(["1"]);
    // 23:45 IST on the 23rd is 18:15Z on the 23rd — an IST-day filter must still see it on the 23rd.
    expect(await ids({ columnId: "calledAt", operator: "is", value: "2026-09-23" })).toEqual(["2"]);
    expect(await ids({ columnId: "calledAt", operator: "is", value: "2026-09-24" })).toEqual(["1"]);
    expect(await ids({ columnId: "calledAt", operator: "isAfter", value: "2026-09-24T04:59:59.000Z" })).toEqual(["1"]);
    expect(await ids({ columnId: "calledAt", operator: "isWithin", value: { relative: "yesterday" } })).toEqual(["1"]);
    // Sorting on the converted expression keeps the wall-time order.
    const sorted = await make().fetch({ filter: null, sort: [{ columnId: "calledAt", dir: "asc" }], page: { offset: 0, limit: 10 } });
    expect(sorted.rows.map((r) => r.id)).toEqual(["2", "1", "3"]);
    // Declaring the column as UTC storage flips the interpretation (and drops CONVERT_TZ).
    const utc = make({ naiveDatetimeZone: "UTC" });
    expect((await row("1", utc)).cells.calledAt).toBe("2026-09-24T10:30:00.000Z");
    // Stored as UTC, row 2's 23:45Z on the 23rd is 05:15 IST on the 24th: the IST-day filter now sees both.
    expect(await ids({ columnId: "calledAt", operator: "is", value: "2026-09-24" }, utc)).toEqual(["1", "2"]);
  });

  it("#1/#4 the write hook's `values` are bound to the UPDATE; stale versions still conflict", async () => {
    const ds = make();
    const v = (await row("3", ds)).version;
    await ds.applyChanges({ id: "c1", source: "edit", changes: [{ rowId: "3", columnId: "name", prev: "Chitra", next: "C." }], baseVersions: { "3": v } });
    const stale = await ds.applyChanges({ id: "c2", source: "edit", changes: [{ rowId: "3", columnId: "name", prev: "Chitra", next: "X" }], baseVersions: { "3": v } });
    expect(stale.applied).toEqual([]);
    expect(stale.conflicts).toEqual([expect.objectContaining({ rowId: "3", columnId: "name", serverValue: "C." })]);
    expect(
      await mysql.db.select({ n: sql<number>`COUNT(*)` }).from(t).where(and(eq(t.id, 3), eq(t.name, "C."))),
    ).toEqual([{ n: expect.anything() }]);
  });
});
