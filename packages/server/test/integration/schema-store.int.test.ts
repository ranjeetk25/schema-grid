import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createGridSchemasTableDDL } from "../../src/ddl/schema-store-ddl";
import type { GridSchema, SchemaStore } from "../../src/internal/core";
import { MissingTableError } from "../../src/errors";
import { createDrizzleSchemaStore } from "../../src/schema-store/drizzle-schema-store";
import { type StartedMysql, describeMysql, startMysql } from "./mysql";

const TABLE = "grid_schemas";
const T1 = new Date("2026-09-26T10:00:00.123Z");
const T2 = new Date("2026-09-26T11:00:00.456Z");

const v1: GridSchema = {
  id: "leads",
  schemaVersion: 1,
  columns: [{ id: "c_name", key: "name", label: "Name", type: "text" }] as GridSchema["columns"],
};
const v2: GridSchema = {
  ...v1,
  schemaVersion: 2,
  columns: [...v1.columns, { id: "c_email", key: "email", label: "Email", type: "email" }] as GridSchema["columns"],
};

describeMysql("drizzle schema store (MySQL 8.4)", () => {
  let mysql: StartedMysql;
  let clock = T1;
  let store: SchemaStore;
  /** Built BEFORE the DDL ran, to watch `available()` flip. */
  let early: SchemaStore;
  const exec = (s: string) => mysql.db.execute(s as never);
  const meta = async (gridId: string) => {
    const [rows] = (await mysql.db.execute(
      sql`SELECT schema_version AS v, CAST(updated_at AS CHAR) AS at FROM grid_schemas WHERE grid_id = ${gridId}`,
    )) as unknown as [{ v: number; at: string }[]];
    return rows[0];
  };

  beforeAll(async () => {
    mysql = await startMysql();
    await exec(`DROP TABLE IF EXISTS \`${TABLE}\``);
    early = createDrizzleSchemaStore({ db: mysql.db, table: TABLE });
    expect(await early.available?.()).toBe(false);
    expect(await early.available?.()).toBe(false); // re-probed while false, still false
    await exec(createGridSchemasTableDDL({ table: TABLE }).sql);
    // Re-running the DDL is harmless (IF NOT EXISTS).
    await exec(createGridSchemasTableDDL({ table: TABLE }).sql);
    store = createDrizzleSchemaStore({ db: mysql.db, table: TABLE, now: () => clock });
  }, 180_000);
  afterAll(async () => {
    await mysql?.stop();
  });

  it("v0.3.1: available() is false before the DDL, true after it, and true is cached", async () => {
    mysql.queries.length = 0;
    await expect(early.available?.()).resolves.toBe(true);
    await expect(early.available?.()).resolves.toBe(true);
    const probes = mysql.queries.filter((q) => /^select 1 from/i.test(q.sql));
    expect(probes).toHaveLength(1);
    expect(probes[0]?.sql.toLowerCase()).toBe(`select 1 from \`${TABLE}\` limit 0`);
    await expect(store.available?.()).resolves.toBe(true);
  });

  it("get of an unknown grid → null", async () => {
    await expect(store.get("unknown")).resolves.toBeNull();
  });

  it("put → get round trip", async () => {
    clock = T1;
    await store.put("leads", v1);
    await expect(store.get("leads")).resolves.toEqual(v1);
    const row = await meta("leads");
    expect(Number(row?.v)).toBe(1);
    expect(row?.at).toBe("2026-09-26 10:00:00.123");
  });

  it("overwrite replaces the schema and bumps schema_version / updated_at", async () => {
    clock = T2;
    await store.put("leads", v2);
    await expect(store.get("leads")).resolves.toEqual(v2);
    const row = await meta("leads");
    expect(Number(row?.v)).toBe(2);
    expect(row?.at).toBe("2026-09-26 11:00:00.456");
    const [count] = (await mysql.db.execute(sql`SELECT COUNT(*) AS n FROM grid_schemas`)) as unknown as [{ n: number }[]];
    expect(Number(count[0]?.n)).toBe(1);
  });

  it("grid ids are matched exactly (binary collation)", async () => {
    await expect(store.get("LEADS")).resolves.toBeNull();
  });

  it("v0.3: a dropped schema table is a MISSING_TABLE error naming createGridSchemasTableDDL", async () => {
    await exec(`DROP TABLE \`${TABLE}\``);
    await expect(store.get("leads")).rejects.toBeInstanceOf(MissingTableError);
    await expect(store.put("leads", v1)).rejects.toMatchObject({
      code: "MISSING_TABLE",
      details: { table: TABLE, ddl: "createGridSchemasTableDDL" },
    });
    // `available()` stays true once confirmed (per-instance cache); a fresh store sees the drop.
    await expect(store.available?.()).resolves.toBe(true);
    await expect(createDrizzleSchemaStore({ db: mysql.db, table: TABLE }).available?.()).resolves.toBe(false);
    await exec(createGridSchemasTableDDL({ table: TABLE }).sql);
    await expect(store.get("leads")).resolves.toBeNull();
  });
});
