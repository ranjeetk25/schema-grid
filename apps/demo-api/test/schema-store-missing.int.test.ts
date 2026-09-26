/**
 * v0.3.1: the leads grid whose schema-store table was never created (the
 * `createGridSchemasTableDDL` step was skipped) serves read-only against the
 * docker-compose MySQL (`SCHEMA_GRID_MYSQL_IT=1`): `capabilities.schema`
 * says `store-unavailable`, `updateSchema` is 501, and creating the table
 * later is picked up without a restart.
 */
import type { DataSourceCapabilities, GridSchema } from "@ranjeetk25/schema-grid-core";
import { createGridSchemasTableDDL } from "@ranjeetk25/schema-grid-server/ddl";
import { FIXTURE_NOW, createFixtureSchema } from "@ranjeetk25/schema-grid-core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CreatedApp, createApp } from "../src/app";
import { DEFAULT_DATABASE_URL, type Database, connect, gridTables, rawQuery } from "../src/db";
import { SchemaStore } from "../src/schema-store";

const MISSING_TABLE = "it_ssm_missing_grid_schemas";
type Headers = Record<string, string>;
type Wire<T> = { status: number; data: T; error?: { code: string; message: string; details?: unknown } };

describe.skipIf(process.env.SCHEMA_GRID_MYSQL_IT !== "1")("leads grid with a missing schema-store table", () => {
  let database: Database;
  /** Store table exists (created by `/__reset`). */
  let healthy: CreatedApp;
  /** Same leads table, schema store pointed at a table that does not exist. */
  let broken: CreatedApp;

  const makeApp = (schemasTable: string) =>
    createApp({
      db: database.db,
      tables: gridTables({ rowsTable: "it_ssm_grid_rows", changeLogTable: "it_ssm_grid_change_log" }),
      gridId: "admissions",
      store: new SchemaStore(null, createFixtureSchema),
      tz: "Asia/Kolkata",
      clock: FIXTURE_NOW,
      leads: { tableName: "it_ssm_leads", schemasTable, extensionTable: "it_ssm_grid_extension_cells" },
    });

  const op = async <T>(app: CreatedApp, name: string, body: unknown, headers: Headers = {}): Promise<Wire<T>> => {
    const res = await app.app.request(`/grid/leads/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { data?: T; error?: Wire<T>["error"] };
    return { status: res.status, data: json.data as T, ...(json.error ? { error: json.error } : {}) };
  };
  const schemaCaps = async (app: CreatedApp, roles: string) =>
    (await op<DataSourceCapabilities>(app, "capabilities", null, { "x-roles": roles })).data.schema;

  beforeAll(async () => {
    database = connect(process.env.DATABASE_URL || DEFAULT_DATABASE_URL);
    healthy = makeApp("it_ssm_grid_schemas");
    expect((await healthy.app.request("/__reset", { method: "POST" })).status).toBe(200);
    await database.db.execute(`DROP TABLE IF EXISTS \`${MISSING_TABLE}\`` as never);
    broken = makeApp(MISSING_TABLE); // no /__reset here: it would create the table
  });

  afterAll(async () => {
    await database.db.execute(`DROP TABLE IF EXISTS \`${MISSING_TABLE}\`` as never);
    await database?.close();
  });

  it("an admin sees schema.write false with reason store-unavailable; a non-admin is still forbidden where the store exists", async () => {
    expect(await schemaCaps(broken, "admin")).toEqual({ read: true, write: false, reason: "store-unavailable" });
    expect(await schemaCaps(healthy, "counsellor")).toEqual({ read: true, write: false, reason: "forbidden" });
    expect(await schemaCaps(healthy, "admin")).toEqual({ read: true, write: true });
  });

  it("getSchema and fetch still work (base schema, no MISSING_TABLE 500)", async () => {
    const schema = await op<GridSchema>(broken, "getSchema", null);
    expect(schema.status).toBe(200);
    expect(schema.data.columns.map((c) => c.key)).toEqual(["name", "email", "paymentStatus", "callDate", "aiVerified"]);
    const rows = await op<{ rows: unknown[] }>(broken, "fetch", { filter: null, sort: [], page: { offset: 0, limit: 1 } });
    expect(rows.status).toBe(200);
    expect(rows.data.rows).toHaveLength(1);
  });

  it("updateSchema → 501 UNSUPPORTED_OPERATION with details.reason schema-store-unavailable (admin); 403 for a counsellor", async () => {
    const schema = (await op<GridSchema>(broken, "getSchema", null)).data;
    const renamed = { ...schema, columns: schema.columns.map((c) => (c.key === "name" ? { ...c, label: "Lead name" } : c)) };
    const res = await op<GridSchema>(broken, "updateSchema", renamed, { "x-roles": "admin" });
    expect(res.status).toBe(501);
    expect(res.error?.code).toBe("UNSUPPORTED_OPERATION");
    expect((res.error?.details as { reason?: string })?.reason).toBe("schema-store-unavailable");
    expect(res.error?.message).toContain("createGridSchemasTableDDL");
    const denied = await op<GridSchema>(broken, "updateSchema", renamed, { "x-roles": "counsellor" });
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe("PERMISSION_DENIED");
  });

  it("creating the table later is picked up by the running app: write true, updateSchema persists", async () => {
    await database.db.execute(createGridSchemasTableDDL({ table: MISSING_TABLE }).sql as never);
    expect(await schemaCaps(broken, "admin")).toEqual({ read: true, write: true });
    const schema = (await op<GridSchema>(broken, "getSchema", null)).data;
    const renamed = { ...schema, columns: schema.columns.map((c) => (c.key === "name" ? { ...c, label: "Lead name" } : c)) };
    const saved = await op<GridSchema>(broken, "updateSchema", renamed, { "x-roles": "admin" });
    expect(saved.status).toBe(200);
    const [row] = await rawQuery<{ v: number }>(database.db, `SELECT schema_version AS v FROM \`${MISSING_TABLE}\` WHERE grid_id = 'leads'`);
    expect(Number(row?.v)).toBe(schema.schemaVersion + 1);
  });
});
