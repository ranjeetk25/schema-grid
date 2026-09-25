import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDrizzleDataSource } from "../../src/datasource/create-drizzle-data-source";
import {
  type DataSource,
  type GridRow,
  createDefaultRegistry,
  createRolePermissionResolver,
} from "../../src/internal/core";
import type { GridTables } from "../../src/storage/tables";
import { FIXTURE_GRID_ID, FIXTURE_NOW, FIXTURE_TZ, admissionsRows, admissionsSchema } from "../fixtures/admissions";
import { type StartedMysql, describeMysql, setupGrid, startMysql } from "./mysql";

describeMysql("conflicts, change feed and generated columns (MySQL 8.4)", () => {
  let mysql: StartedMysql;
  let tables: GridTables;
  const as = (id: string, roles: string[]): DataSource<GridRow> =>
    createDrizzleDataSource({
      db: mysql.db,
      gridId: FIXTURE_GRID_ID,
      schema: admissionsSchema,
      registry: createDefaultRegistry(),
      resolver: createRolePermissionResolver(),
      user: { id, roles },
      tz: FIXTURE_TZ,
      now: () => FIXTURE_NOW,
      tables,
    });
  const version = async (ds: DataSource<GridRow>, id: string) =>
    (await ds.fetch({ filter: { columnId: "name", operator: "isNotEmpty" }, sort: [], page: { offset: 0, limit: 100 } })).rows.find(
      (r) => r.id === id,
    );

  beforeAll(async () => {
    mysql = await startMysql();
    tables = await setupGrid(mysql.db, admissionsSchema, admissionsRows, { gridId: FIXTURE_GRID_ID, now: FIXTURE_NOW });
  }, 180_000);
  afterAll(async () => {
    await mysql?.stop();
  });

  it("stale base version → conflict with A's value, version 2 and updatedBy A; B not applied, not logged; retry works", async () => {
    const a = as("userA", ["admin"]);
    const b = as("userB", ["admin"]);
    const cursor = (await b.getChanges?.(""))?.cursor as string;
    const ra = await a.applyChanges({ id: "ba", changes: [{ rowId: "r02", columnId: "name", prev: "Bala", next: "Bala A" }], baseVersions: { r02: 1 }, source: "edit" });
    expect(ra.applied).toHaveLength(1);
    const rb = await b.applyChanges({ id: "bb", changes: [{ rowId: "r02", columnId: "name", prev: "Bala", next: "Bala B" }], baseVersions: { r02: 1 }, source: "edit" });
    expect(rb.applied).toEqual([]);
    expect(rb.errors).toEqual([]);
    expect(rb.conflicts).toEqual([
      expect.objectContaining({ rowId: "r02", columnId: "name", serverValue: "Bala A", serverVersion: 2, updatedBy: { id: "userA" } }),
    ]);
    const [log] = (await mysql.db.execute(sql`SELECT COUNT(*) AS n FROM grid_change_log WHERE batch_id = 'bb'`)) as unknown as [{ n: number }[]];
    expect(Number(log[0]?.n)).toBe(0);
    const retry = await b.applyChanges({ id: "bb2", changes: [{ rowId: "r02", columnId: "name", prev: "Bala A", next: "Bala B" }], baseVersions: { r02: 2 }, source: "edit" });
    expect(retry.applied).toHaveLength(1);
    expect((await version(b, "r02"))?.version).toBe(3);

    const feed = await b.getChanges?.(cursor);
    expect(feed?.rows.filter((r) => r.id === "r02")).toHaveLength(1);
    expect(feed?.rows.find((r) => r.id === "r02")?.cells.name).toBe("Bala B");
    expect(Number(feed?.cursor)).toBeGreaterThan(Number(cursor));
  });

  it("an edit to a read-only column errors and does not bump the version", async () => {
    const counsellor = as("c1", ["counsellor"]);
    const before = (await version(as("adm", ["admin"]), "r01"))?.version;
    const res = await counsellor.applyChanges({ id: "b3", changes: [{ rowId: "r01", columnId: "salary", prev: null, next: 1 }], baseVersions: { r01: before ?? 1 }, source: "edit" });
    expect(res.errors).toHaveLength(1);
    expect((await version(as("adm", ["admin"]), "r01"))?.version).toBe(before);
  });

  it("feed: deletes go to deletedRowIds; hidden columns are absent", async () => {
    const admin = as("adm", ["admin"]);
    const counsellor = as("c1", ["counsellor"]);
    const cursor = (await counsellor.getChanges?.(""))?.cursor as string;
    await admin.applyChanges({ id: "b4", changes: [{ rowId: "r01", columnId: "salary", prev: 10, next: 11 }], baseVersions: { r01: (await version(admin, "r01"))?.version ?? 1 }, source: "edit" });
    await admin.deleteRows(["r10"]);
    const feed = await counsellor.getChanges?.(cursor);
    expect(feed?.deletedRowIds).toEqual(["r10"]);
    expect(feed?.rows.find((r) => r.id === "r01")?.cells).not.toHaveProperty("salary");
  });

  it("generated column: equality on the indexed column uses idx_gc_fee", async () => {
    const [plan] = (await mysql.db.execute(
      sql`EXPLAIN SELECT id FROM grid_rows WHERE grid_id = 'admissions' AND gc_fee = 50000`,
    )) as unknown as [{ key: string | null; possible_keys: string | null }[]];
    expect(`${plan[0]?.possible_keys ?? ""}`).toContain("idx_gc_fee");
    const res = await as("adm", ["admin"]).fetch({ filter: { columnId: "fee", operator: "eq", value: 50000 }, sort: [], page: { offset: 0, limit: 10 } });
    expect(res.rows.map((r) => r.id).sort()).toEqual(["r01", "r07"]);
  });
});
