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
import { alterChangeLogTableMetaDDL } from "../../src/ddl/tables-ddl";
import { resetChangeLogLegacyDetection } from "../../src/changes/change-log";
import type { GridSchema } from "../../src/internal/core";
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
const status = FIXTURE_COLUMN_IDS.status;
const tags = FIXTURE_COLUMN_IDS.tags;

/** The fixture schema with `Option.settableBy` on status "paid" and tag "vip" (admin only). */
const restrictedSchema: GridSchema = {
  ...serverFixtureSchema,
  columns: serverFixtureSchema.columns.map((c) => {
    const config = c.config as { options?: { id: string; label: string }[] } | null;
    if (!config?.options) return c;
    if (c.id !== status && c.id !== tags) return c;
    return {
      ...c,
      config: {
        ...config,
        options: config.options.map((o) => (o.id === "paid" || o.id === "vip" ? { ...o, settableBy: { roles: ["admin"] } } : o)),
      },
    };
  }),
};

describeMysql("conflicts, change feed and generated columns (MySQL 8.4)", () => {
  let mysql: StartedMysql;
  let tables: GridTables;
  const as = (id: string, roles: string[], schema: GridSchema = serverFixtureSchema): DataSource<GridRow> =>
    createDrizzleDataSource({
      db: mysql.db,
      gridId: FIXTURE_GRID_ID,
      schema,
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

  it("v0.3 option rules: a counsellor cannot set an admin-only option, an admin can, and a held option is not re-checked", async () => {
    const admin = as("adm", ["admin"], restrictedSchema);
    const counsellor = as("c1", ["counsellor"], restrictedSchema);
    const all = async (ds: DataSource<GridRow>) =>
      (await ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 100 } })).rows;
    const r2 = (await all(admin)).find((r) => r.id === "r2") as GridRow;
    const denied = await counsellor.applyChanges({
      id: "opt1",
      changes: [{ rowId: "r2", columnId: status, prev: r2.cells.status, next: "paid" }],
      baseVersions: { r2: r2.version },
      source: "edit",
    });
    expect(denied.applied).toEqual([]);
    expect(denied.errors).toEqual([{ rowId: "r2", columnId: status, message: "Option “Paid” can only be set by Admin" }]);
    const allowed = await admin.applyChanges({
      id: "opt2",
      changes: [{ rowId: "r2", columnId: status, prev: r2.cells.status, next: "paid" }],
      baseVersions: { r2: r2.version },
      source: "edit",
    });
    expect(allowed.applied).toHaveLength(1);
    // A row already tagged "vip" may gain another tag without re-checking "vip".
    const vip = (await all(admin)).find((r) => Array.isArray(r.cells.tags) && (r.cells.tags as string[]).includes("vip")) as GridRow;
    expect(vip).toBeDefined();
    const kept = await counsellor.applyChanges({
      id: "opt3",
      changes: [{ rowId: vip.id, columnId: tags, prev: vip.cells.tags, next: [...(vip.cells.tags as string[]), "referral"] }],
      baseVersions: { [vip.id]: vip.version },
      source: "edit",
    });
    expect(kept.errors).toEqual([]);
    expect(kept.applied[0]?.next).toEqual([...(vip.cells.tags as string[]), "referral"]);
    const introduced = await counsellor.applyChanges({
      id: "opt4",
      changes: [{ rowId: "r2", columnId: tags, prev: r2.cells.tags, next: ["vip"] }],
      baseVersions: { r2: r2.version + 1 },
      source: "edit",
    });
    expect(introduced.errors[0]?.message).toBe("Option “VIP” can only be set by Admin");
  });

  it("v0.3 change meta: echoed on applied entries and stored in change_log.meta (legacy tables fall back)", async () => {
    const admin = as("adm", ["admin"]);
    const r3 = (await admin.fetch({ filter: null, sort: [], page: { offset: 0, limit: 100 } })).rows.find((r) => r.id === "r3") as GridRow;
    const res = await admin.applyChanges({
      id: "meta1",
      meta: { reuploadDeadline: "2026-10-01" },
      changes: [{ rowId: "r3", columnId: name, prev: r3.cells.name, next: "Meta edit", meta: { decisionMessage: "approved" } }],
      baseVersions: { r3: r3.version },
      source: "edit",
    });
    expect(res.applied).toEqual([{ rowId: "r3", columnId: name, prev: r3.cells.name, next: "Meta edit", meta: { decisionMessage: "approved" } }]);
    const [rows] = (await mysql.db.execute(sql`SELECT meta FROM grid_change_log WHERE batch_id = 'meta1'`)) as unknown as [{ meta: unknown }[]];
    const stored = rows[0]?.meta;
    expect(typeof stored === "string" ? JSON.parse(stored) : stored).toEqual({ decisionMessage: "approved" });

    // A change_log created before v0.3 (no meta column): the write still succeeds, meta is not logged.
    await mysql.db.execute(sql`ALTER TABLE grid_change_log DROP COLUMN meta`);
    resetChangeLogLegacyDetection();
    const legacy = await admin.applyChanges({
      id: "meta2",
      changes: [{ rowId: "r3", columnId: name, prev: "Meta edit", next: "Legacy edit", meta: { decisionMessage: "again" } }],
      baseVersions: { r3: r3.version + 1 },
      source: "edit",
    });
    expect(legacy.applied).toHaveLength(1);
    const [count] = (await mysql.db.execute(sql`SELECT COUNT(*) AS n FROM grid_change_log WHERE batch_id = 'meta2'`)) as unknown as [{ n: number }[]];
    expect(Number(count[0]?.n)).toBe(1);
    // The documented upgrade restores it.
    await mysql.db.execute(sql.raw(alterChangeLogTableMetaDDL({ table: "grid_change_log" }).sql));
    resetChangeLogLegacyDetection();
  });

  it("v0.3.1 rows after a save: applyChanges returns the refreshed rows (formula recomputed, hidden cells stripped); getRows matches fetch", async () => {
    const admin = as("adm", ["admin"]);
    const before = (await version(admin, "r5")) as GridRow;
    const paid = Number(before.cells.paid ?? 0);
    const res = await admin.applyChanges({
      id: "rows-json",
      source: "edit",
      changes: [
        { rowId: "r5", columnId: FIXTURE_COLUMN_IDS.fee, prev: before.cells.fee ?? null, next: 90000 },
        { rowId: "missing", columnId: FIXTURE_COLUMN_IDS.fee, prev: null, next: 1 },
      ],
      baseVersions: { r5: before.version, missing: 1 },
    });
    expect(res.applied).toHaveLength(1);
    expect(res.rows?.map((r) => r.id)).toEqual(["r5"]);
    const fresh = res.rows?.[0] as GridRow;
    expect(fresh.version).toBe(before.version + 1);
    expect(fresh.cells.fee).toBe(90000);
    expect(fresh.cells.balance).toBe(90000 - paid);
    expect(fresh).toEqual(await version(admin, "r5"));

    const counsellor = as("cns", ["counsellor"]);
    const rows = await counsellor.getRows?.(["missing", "r5", "r4"]);
    expect(rows?.map((r) => r.id)).toEqual(["r5", "r4"]);
    expect(rows?.[0]?.cells).not.toHaveProperty("notes");
    expect(rows?.[0]?.cells.balance).toBe(90000 - paid);
    expect(rows?.[0]).toEqual(await version(counsellor, "r5"));
  });
});
