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
import {
  FIXTURE_COLUMN_IDS,
  FIXTURE_GRID_ID,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  createServerFixtureRowPartials,
  serverFixtureSchema,
} from "../fixtures/admissions";
import { type StartedMysql, describeMysql, setupGrid, startMysql } from "./mysql";

const NOW = new Date(FIXTURE_NOW);
const rowPartials = createServerFixtureRowPartials();
const name = FIXTURE_COLUMN_IDS.name;
const notes = FIXTURE_COLUMN_IDS.notes;

describeMysql("conflicts, change feed and generated columns (MySQL 8.4)", () => {
  let mysql: StartedMysql;
  let tables: GridTables;
  const as = (id: string, roles: string[]): DataSource<GridRow> =>
    createDrizzleDataSource({
      db: mysql.db,
      gridId: FIXTURE_GRID_ID,
      schema: serverFixtureSchema,
      registry: createDefaultRegistry(),
      resolver: createRolePermissionResolver(),
      user: { id, roles },
      tz: FIXTURE_TIME_ZONE,
      now: () => NOW,
      tables,
    });
  const version = async (ds: DataSource<GridRow>, id: string) =>
    (await ds.fetch({ filter: { columnId: name, operator: "isNotEmpty" }, sort: [], page: { offset: 0, limit: 100 } })).rows.find(
      (r) => r.id === id,
    );

  beforeAll(async () => {
    mysql = await startMysql();
    tables = await setupGrid(mysql.db, serverFixtureSchema, rowPartials, { gridId: FIXTURE_GRID_ID, now: NOW });
  }, 180_000);
  afterAll(async () => {
    await mysql?.stop();
  });

  it("stale base version → conflict with A's value, version 2 and updatedBy A; B not applied, not logged; retry works", async () => {
    const a = as("userA", ["admin"]);
    const b = as("userB", ["admin"]);
    const cursor = (await b.getChanges?.(""))?.cursor as string;
    const ra = await a.applyChanges({ id: "ba", changes: [{ rowId: "r2", columnId: name, prev: "Bhavesh Rao", next: "Bhavesh Rao A" }], baseVersions: { r2: 1 }, source: "edit" });
    expect(ra.applied).toHaveLength(1);
    const rb = await b.applyChanges({ id: "bb", changes: [{ rowId: "r2", columnId: name, prev: "Bhavesh Rao", next: "Bhavesh Rao B" }], baseVersions: { r2: 1 }, source: "edit" });
    expect(rb.applied).toEqual([]);
    expect(rb.errors).toEqual([]);
    expect(rb.conflicts).toEqual([
      expect.objectContaining({ rowId: "r2", columnId: name, serverValue: "Bhavesh Rao A", serverVersion: 2, updatedBy: { id: "userA" } }),
    ]);
    const [log] = (await mysql.db.execute(sql`SELECT COUNT(*) AS n FROM grid_change_log WHERE batch_id = 'bb'`)) as unknown as [{ n: number }[]];
    expect(Number(log[0]?.n)).toBe(0);
    const retry = await b.applyChanges({ id: "bb2", changes: [{ rowId: "r2", columnId: name, prev: "Bhavesh Rao A", next: "Bhavesh Rao B" }], baseVersions: { r2: 2 }, source: "edit" });
    expect(retry.applied).toHaveLength(1);
    expect((await version(b, "r2"))?.version).toBe(3);

    const feed = await b.getChanges?.(cursor);
    expect(feed?.rows.filter((r) => r.id === "r2")).toHaveLength(1);
    expect(feed?.rows.find((r) => r.id === "r2")?.cells.name).toBe("Bhavesh Rao B");
    expect(Number(feed?.cursor)).toBeGreaterThan(Number(cursor));
  });

  it("an edit to a read-only column errors and does not bump the version", async () => {
    const counsellor = as("c1", ["counsellor"]);
    const before = (await version(as("adm", ["admin"]), "r1"))?.version;
    const res = await counsellor.applyChanges({ id: "b3", changes: [{ rowId: "r1", columnId: notes, prev: null, next: "x" }], baseVersions: { r1: before ?? 1 }, source: "edit" });
    expect(res.errors).toHaveLength(1);
    expect((await version(as("adm", ["admin"]), "r1"))?.version).toBe(before);
  });

  it("feed: deletes go to deletedRowIds; hidden columns are absent", async () => {
    const admin = as("adm", ["admin"]);
    const counsellor = as("c1", ["counsellor"]);
    const cursor = (await counsellor.getChanges?.(""))?.cursor as string;
    await admin.applyChanges({ id: "b4", changes: [{ rowId: "r1", columnId: notes, prev: "VIP applicant", next: "VIP applicant, updated" }], baseVersions: { r1: (await version(admin, "r1"))?.version ?? 1 }, source: "edit" });
    await admin.deleteRows(["r7"]);
    const feed = await counsellor.getChanges?.(cursor);
    expect(feed?.deletedRowIds).toEqual(["r7"]);
    expect(feed?.rows.find((r) => r.id === "r1")?.cells).not.toHaveProperty("notes");
  });

  it("generated column: equality on the indexed column uses idx_gc_fee", async () => {
    const [plan] = (await mysql.db.execute(
      sql`EXPLAIN SELECT id FROM grid_rows WHERE grid_id = 'admissions' AND gc_fee = 50000`,
    )) as unknown as [{ key: string | null; possible_keys: string | null }[]];
    expect(`${plan[0]?.possible_keys ?? ""}`).toContain("idx_gc_fee");
    const res = await as("adm", ["admin"]).fetch({ filter: { columnId: FIXTURE_COLUMN_IDS.fee, operator: "eq", value: 50000 }, sort: [], page: { offset: 0, limit: 10 } });
    expect(res.rows.map((r) => r.id).sort()).toEqual(["r1"]);
  });
});
