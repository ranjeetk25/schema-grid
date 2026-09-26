import { describe, expect, it } from "vitest";
import type { GridDb } from "../../../src/changes/db";
import { MissingTableError, SchemaGridServerError } from "../../../src/errors";
import type { GridSchema } from "../../../src/internal/core";
import { createDrizzleSchemaStore } from "../../../src/schema-store/drizzle-schema-store";
import { asRows, createFakeMysql } from "../../helpers/fake-mysql";

const NOW = new Date("2026-09-26T10:11:12.345Z");

const schema: GridSchema = {
  id: "leads",
  schemaVersion: 3,
  columns: [{ id: "c_name", key: "name", label: "Name", type: "text" }] as GridSchema["columns"],
};

function storeOver(responder?: Parameters<typeof createFakeMysql>[0]) {
  const fake = createFakeMysql(responder);
  const store = createDrizzleSchemaStore({ db: fake.db as unknown as GridDb, table: "grid_schemas", now: () => NOW });
  return { ...fake, store };
}

describe("createDrizzleSchemaStore", () => {
  it("get selects the schema by grid id", async () => {
    const { store, calls } = storeOver(() => []);
    await store.get("leads");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toBe("select `schema` from `grid_schemas` where `grid_schemas`.`grid_id` = ? limit ?");
    expect(calls[0]?.params).toEqual(["leads", 1]);
  });

  it("get returns null on a miss", async () => {
    const { store } = storeOver(() => []);
    await expect(store.get("nope")).resolves.toBeNull();
  });

  it("get parses a JSON string (driver without JSON typecast)", async () => {
    const { store } = storeOver(() => asRows([{ schema: JSON.stringify(schema) }], ["schema"]));
    await expect(store.get("leads")).resolves.toEqual(schema);
  });

  it("get returns an already-parsed JSON object as-is", async () => {
    const { store } = storeOver(() => asRows([{ schema }], ["schema"]));
    await expect(store.get("leads")).resolves.toEqual(schema);
  });

  it("put upserts schema JSON, schema_version and updated_at", async () => {
    const { store, calls } = storeOver();
    await store.put("leads", schema);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toBe(
      "insert into `grid_schemas` (`grid_id`, `schema`, `schema_version`, `updated_at`) values (?, ?, ?, ?) on duplicate key update `schema` = ?, `schema_version` = ?, `updated_at` = ?",
    );
    const json = JSON.stringify(schema);
    const at = "2026-09-26 10:11:12.345";
    expect(calls[0]?.params).toEqual(["leads", json, 3, at, json, 3, at]);
  });

  it("defaults now() to the current time", async () => {
    const fake = createFakeMysql();
    const store = createDrizzleSchemaStore({ db: fake.db as unknown as GridDb, table: "grid_schemas" });
    const before = Date.now();
    await store.put("leads", schema);
    const at = Date.parse(`${String(fake.calls[0]?.params[3]).replace(" ", "T")}Z`);
    expect(at).toBeGreaterThanOrEqual(before - 1);
    expect(at).toBeLessThanOrEqual(Date.now() + 1);
  });

  it.each([
    ["empty", ""],
    ["longer than 64 chars", "g".repeat(65)],
  ])("rejects a %s grid id without touching the db", async (_label, gridId) => {
    const { store, calls } = storeOver();
    await expect(store.put(gridId, schema)).rejects.toMatchObject({ code: "INVALID_GRID_ID" });
    await expect(store.put(gridId, schema)).rejects.toBeInstanceOf(SchemaGridServerError);
    await expect(store.get(gridId)).rejects.toMatchObject({ code: "INVALID_GRID_ID" });
    expect(calls).toEqual([]);
  });

  it("accepts a 64-char grid id", async () => {
    const { store, calls } = storeOver();
    await store.put("g".repeat(64), schema);
    expect(calls).toHaveLength(1);
  });

  it("rejects an unsafe table name at construction", () => {
    const fake = createFakeMysql();
    expect(() => createDrizzleSchemaStore({ db: fake.db as unknown as GridDb, table: "bad-name" })).toThrow();
  });
});

describe("createDrizzleSchemaStore: missing table (v0.3)", () => {
  const noSuchTable = () =>
    Object.assign(new Error("Table 'app.grid_schemas' doesn't exist"), { errno: 1146, code: "ER_NO_SUCH_TABLE" });

  it("get / put throw MissingTableError naming createGridSchemasTableDDL when the table was never created", async () => {
    const { store } = storeOver(() => {
      throw noSuchTable();
    });
    await expect(store.get("leads")).rejects.toBeInstanceOf(MissingTableError);
    await expect(store.put("leads", schema)).rejects.toMatchObject({
      code: "MISSING_TABLE",
      details: { table: "grid_schemas", ddl: "createGridSchemasTableDDL" },
    });
  });

  it("other driver errors pass through (raw on drizzle 0.41, wrapped with `cause` on newer drizzle)", async () => {
    const boom = new Error("connection lost");
    const { store } = storeOver(() => {
      throw boom;
    });
    const rejection = await store.get("leads").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(rejection).not.toBeInstanceOf(MissingTableError);
    expect(rejection === boom || (rejection as { cause?: unknown })?.cause === boom).toBe(true);
  });
});

describe("createDrizzleSchemaStore.available (v0.3.1)", () => {
  const noSuchTable = () =>
    Object.assign(new Error("Table 'app.grid_schemas' doesn't exist"), { errno: 1146, code: "ER_NO_SUCH_TABLE" });

  it("probes the table with a zero-row select and answers true when it exists", async () => {
    const { store, calls } = storeOver(() => []);
    await expect(store.available?.()).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql.toLowerCase()).toBe("select 1 from `grid_schemas` limit 0");
  });

  it("answers false on ER_NO_SUCH_TABLE without throwing", async () => {
    const { store } = storeOver(() => {
      throw noSuchTable();
    });
    await expect(store.available?.()).resolves.toBe(false);
  });

  it("caches true for the store's lifetime", async () => {
    const { store, calls } = storeOver(() => []);
    await store.available?.();
    await store.available?.();
    await store.available?.();
    expect(calls).toHaveLength(1);
  });

  it("re-checks while false, so a table created later is picked up", async () => {
    let exists = false;
    const { store, calls } = storeOver(() => {
      if (!exists) throw noSuchTable();
      return [];
    });
    await expect(store.available?.()).resolves.toBe(false);
    await expect(store.available?.()).resolves.toBe(false);
    expect(calls).toHaveLength(2);
    exists = true;
    await expect(store.available?.()).resolves.toBe(true);
    await expect(store.available?.()).resolves.toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("a connection error rejects and is not cached", async () => {
    const boom = new Error("connection lost");
    let broken = true;
    const { store, calls } = storeOver(() => {
      if (broken) throw boom;
      return [];
    });
    const rejection = await store.available?.().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(rejection === boom || (rejection as { cause?: unknown })?.cause === boom).toBe(true);
    broken = false;
    await expect(store.available?.()).resolves.toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("concurrent probes share one in-flight query", async () => {
    const { store, calls } = storeOver(() => []);
    await Promise.all([store.available?.(), store.available?.(), store.available?.()]);
    expect(calls).toHaveLength(1);
  });
});
