import type { DataSource, GridQuery, GridRow, GridSchema } from "@ranjeetk25/schema-grid-core";
import { getDataSourceCapabilities } from "@ranjeetk25/schema-grid-core";
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import {
  createFixtureRows,
  createFixtureSchema,
  FIXTURE_NOW,
  FIXTURE_USERS,
} from "@ranjeetk25/schema-grid-core/testing";
import { describe, expect, it, vi } from "vitest";
import { createGridRegistry, createMemorySchemaStore, defineGrid, type GridSourceInfo } from "../../../src/grid/index";

type Role = keyof typeof FIXTURE_USERS;
interface Ctx {
  role: Role;
}

const q = (over: Partial<GridQuery> = {}): GridQuery => ({ filter: null, sort: [], page: { offset: 0, limit: 50 }, ...over });

function memory(role: Role, schema: GridSchema = createFixtureSchema()) {
  return createInMemoryDataSource({
    schema,
    rows: createFixtureRows(),
    now: () => new Date(FIXTURE_NOW),
    user: { id: FIXTURE_USERS[role].id, roles: [...FIXTURE_USERS[role].roles] },
  });
}

/** The fixture schema with one extra text column. */
function withColumn(schema: GridSchema, key = "extra"): GridSchema {
  const at = "2026-01-01T00:00:00.000Z";
  return {
    ...schema,
    columns: [
      ...schema.columns,
      {
        id: `col_${key}`,
        key,
        label: key,
        type: "text",
        config: {},
        order: schema.columns.length,
        createdAt: at,
        updatedAt: at,
      },
    ],
  };
}

describe("defineGrid", () => {
  it("returns a frozen definition carrying the input", () => {
    const def = defineGrid<Ctx>({ id: "admissions", schema: createFixtureSchema(), source: (ctx) => memory(ctx.role) });
    expect(def.id).toBe("admissions");
    expect(Object.isFrozen(def)).toBe(true);
  });

  it.each(["", "a/b", "has space", "../x", "x?y"])("rejects the URL-unsafe grid id %j", (id) => {
    expect(() => defineGrid({ id, schema: createFixtureSchema(), source: () => memory("admin") })).toThrow(/grid id/i);
  });
});

describe("createGridRegistry", () => {
  it("rejects duplicate grid ids", () => {
    const def = defineGrid({ id: "a", schema: createFixtureSchema(), source: () => memory("admin") });
    expect(() => createGridRegistry([def, def])).toThrow(/duplicate/i);
  });

  it("routes data operations to the grid's source with ctx and the current schema", async () => {
    const source = vi.fn((ctx: Ctx, _info: GridSourceInfo) => memory(ctx.role));
    const other = vi.fn(() => memory("admin"));
    const registry = createGridRegistry([
      defineGrid<Ctx>({ id: "admissions", schema: createFixtureSchema(), source }),
      defineGrid<Ctx>({ id: "other", schema: createFixtureSchema(), source: other }),
    ]);
    const res = await registry.handle("admissions", "fetch", q(), { role: "counsellor" });
    expect(res.ok && res.data.rows[0]?.cells).not.toHaveProperty("notes");
    expect(source).toHaveBeenCalledTimes(1);
    expect(source.mock.calls[0]?.[0]).toEqual({ role: "counsellor" });
    expect(source.mock.calls[0]?.[1]).toMatchObject({ gridId: "admissions", schema: createFixtureSchema() });
    expect(other).not.toHaveBeenCalled();
  });

  it("unknown grid → 404 UNKNOWN_GRID; unknown op → 404 UNKNOWN_OPERATION", async () => {
    const source = vi.fn(() => memory("admin"));
    const registry = createGridRegistry([defineGrid({ id: "a", schema: createFixtureSchema(), source })]);
    expect(await registry.handle("nope", "fetch", q())).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "UNKNOWN_GRID" },
    });
    for (const grid of ["__proto__", "toString", "constructor"]) {
      expect(await registry.handle(grid, "fetch", q())).toMatchObject({ status: 404, error: { code: "UNKNOWN_GRID" } });
    }
    expect(await registry.handle("a", "drop", {})).toMatchObject({ status: 404, error: { code: "UNKNOWN_OPERATION" } });
    expect(source).not.toHaveBeenCalled();
  });

  it("permission false → 403 PERMISSION_DENIED before the source is built; it sees ctx and op", async () => {
    const source = vi.fn((ctx: Ctx) => memory(ctx.role));
    const permission = vi.fn(async (ctx: Ctx, op: string) => ctx.role === "admin" || op === "fetch");
    const registry = createGridRegistry([
      defineGrid<Ctx>({ id: "a", schema: createFixtureSchema(), source, permission }),
    ]);
    expect(await registry.handle("a", "fetch", q(), { role: "counsellor" })).toMatchObject({ ok: true });
    expect(await registry.handle("a", "deleteRows", { ids: ["r1"] }, { role: "counsellor" })).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "PERMISSION_DENIED" },
    });
    expect(await registry.handle("a", "getSchema", null, { role: "counsellor" })).toMatchObject({
      status: 403,
      error: { code: "PERMISSION_DENIED" },
    });
    expect(source).toHaveBeenCalledTimes(1);
    expect(permission).toHaveBeenCalledWith({ role: "counsellor" }, "deleteRows");
  });

  it("maps errors thrown by permission and source (e.g. UNAUTHENTICATED) and never throws", async () => {
    const onError = vi.fn();
    const registry = createGridRegistry(
      [
        defineGrid<{ token?: string }>({
          id: "a",
          schema: createFixtureSchema(),
          permission: (ctx) => {
            if (!ctx.token) throw Object.assign(new Error("Sign in first"), { code: "UNAUTHENTICATED" });
            return true;
          },
          source: () => {
            throw new Error("db down");
          },
        }),
      ],
      { onError },
    );
    expect(await registry.handle("a", "fetch", q(), {})).toEqual({
      ok: false,
      status: 401,
      error: { code: "UNAUTHENTICATED", message: "Sign in first" },
    });
    expect(await registry.handle("a", "fetch", q(), { token: "t" })).toEqual({
      ok: false,
      status: 500,
      error: { code: "INTERNAL", message: "Internal error" },
    });
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("passes handler options through (validateOutput, exposeInternalErrors)", async () => {
    const bad: DataSource<GridRow> = {
      fetch: async () => ({ rows: [{ id: 1 }] }) as never,
      applyChanges: async () => ({ applied: [], conflicts: [], errors: [] }),
      createRows: async () => [],
      deleteRows: async () => undefined,
    };
    const registry = createGridRegistry([defineGrid({ id: "a", schema: createFixtureSchema(), source: () => bad })], {
      validateOutput: true,
    });
    expect(await registry.handle("a", "fetch", q())).toMatchObject({ status: 500, error: { code: "OUTPUT_INVALID" } });
  });

  describe("getSchema", () => {
    it("answers the static schema", async () => {
      const schema = createFixtureSchema();
      const registry = createGridRegistry([defineGrid({ id: "a", schema, source: () => memory("admin") })]);
      expect(await registry.handle("a", "getSchema", null)).toEqual({ ok: true, data: schema });
      expect(await registry.handle("a", "getSchema", undefined)).toEqual({ ok: true, data: schema });
    });

    it("resolves a per-context schema function", async () => {
      const fn = vi.fn(async (ctx: Ctx) => ({ ...createFixtureSchema(), id: `for-${ctx.role}` }));
      const registry = createGridRegistry([defineGrid<Ctx>({ id: "a", schema: fn, source: () => memory("admin") })]);
      const res = await registry.handle("a", "getSchema", null, { role: "counsellor" });
      expect(res.ok && res.data.id).toBe("for-counsellor");
    });

    it("prefers the stored schema over the base one", async () => {
      const stored = { ...createFixtureSchema(), schemaVersion: 7 };
      const store = createMemorySchemaStore({ a: stored });
      const registry = createGridRegistry([
        defineGrid({ id: "a", schema: createFixtureSchema(), schemaStore: store, source: () => memory("admin") }),
      ]);
      const res = await registry.handle("a", "getSchema", null);
      expect(res.ok && res.data.schemaVersion).toBe(7);
    });

    it("rejects a non-null input", async () => {
      const registry = createGridRegistry([
        defineGrid({ id: "a", schema: createFixtureSchema(), source: () => memory("admin") }),
      ]);
      expect(await registry.handle("a", "getSchema", { x: 1 })).toMatchObject({
        status: 400,
        error: { code: "INPUT_INVALID" },
      });
    });
  });

  describe("updateSchema", () => {
    it("static schema without a store → 501 UNSUPPORTED_OPERATION", async () => {
      const registry = createGridRegistry([
        defineGrid({ id: "a", schema: createFixtureSchema(), source: () => memory("admin") }),
      ]);
      expect(await registry.handle("a", "updateSchema", createFixtureSchema())).toMatchObject({
        ok: false,
        status: 501,
        error: { code: "UNSUPPORTED_OPERATION" },
      });
    });

    it("validates, bumps schemaVersion, persists, and later ops see the new schema", async () => {
      const store = createMemorySchemaStore();
      const infos: GridSourceInfo[] = [];
      const registry = createGridRegistry([
        defineGrid({
          id: "a",
          schema: createFixtureSchema(),
          schemaStore: store,
          source: (_ctx, info) => {
            infos.push(info);
            return memory("admin", info.schema);
          },
        }),
      ]);
      const base = createFixtureSchema();
      const res = await registry.handle("a", "updateSchema", withColumn(base));
      expect(res.ok).toBe(true);
      const next = res.ok ? res.data : undefined;
      expect(next?.schemaVersion).toBe(base.schemaVersion + 1);
      expect(next?.columns.map((c) => c.key)).toContain("extra");
      expect(await store.get("a")).toEqual(next);
      expect(await registry.handle("a", "getSchema", null)).toEqual({ ok: true, data: next });
      await registry.handle("a", "fetch", q());
      expect(infos.at(-1)?.schema).toEqual(next);
    });

    it("stale schemaVersion → 409 SCHEMA_CONFLICT with the current version", async () => {
      const store = createMemorySchemaStore();
      const registry = createGridRegistry([
        defineGrid({ id: "a", schema: createFixtureSchema(), schemaStore: store, source: () => memory("admin") }),
      ]);
      const base = createFixtureSchema();
      expect((await registry.handle("a", "updateSchema", withColumn(base))).ok).toBe(true);
      expect(await registry.handle("a", "updateSchema", withColumn(base, "other"))).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "SCHEMA_CONFLICT", details: { currentVersion: base.schemaVersion + 1 } },
      });
    });

    it("serialises concurrent updates: exactly one of two same-version writes wins", async () => {
      const store = createMemorySchemaStore();
      const registry = createGridRegistry([
        defineGrid({ id: "a", schema: createFixtureSchema(), schemaStore: store, source: () => memory("admin") }),
      ]);
      const base = createFixtureSchema();
      const results = await Promise.all([
        registry.handle("a", "updateSchema", withColumn(base, "one")),
        registry.handle("a", "updateSchema", withColumn(base, "two")),
      ]);
      expect(results.map((r) => (r.ok ? 200 : r.status)).sort()).toEqual([200, 409]);
    });

    it("semantically invalid schema → 400 SCHEMA_INVALID; nothing persisted, hook not called", async () => {
      const store = createMemorySchemaStore();
      const onSchemaChange = vi.fn();
      const registry = createGridRegistry([
        defineGrid({
          id: "a",
          schema: createFixtureSchema(),
          schemaStore: store,
          onSchemaChange,
          source: () => memory("admin"),
        }),
      ]);
      const base = createFixtureSchema();
      const dup = { ...base, columns: [...base.columns, { ...(base.columns[0] as GridSchema["columns"][number]) }] };
      expect(await registry.handle("a", "updateSchema", dup)).toMatchObject({
        status: 400,
        error: { code: "SCHEMA_INVALID" },
      });
      expect(await store.get("a")).toBeNull();
      expect(onSchemaChange).not.toHaveBeenCalled();
    });

    it("structurally invalid body → 400 INPUT_INVALID; a different schema id → 400 INPUT_INVALID", async () => {
      const registry = createGridRegistry([
        defineGrid({
          id: "a",
          schema: createFixtureSchema(),
          schemaStore: createMemorySchemaStore(),
          source: () => memory("admin"),
        }),
      ]);
      expect(await registry.handle("a", "updateSchema", { columns: 1 })).toMatchObject({
        status: 400,
        error: { code: "INPUT_INVALID" },
      });
      expect(await registry.handle("a", "updateSchema", { ...createFixtureSchema(), id: "else" })).toMatchObject({
        status: 400,
        error: { code: "INPUT_INVALID" },
      });
    });

    it("runs onSchemaChange(ctx, prev, next) before persisting; a failing hook persists nothing", async () => {
      const store = createMemorySchemaStore();
      const seen: Array<{ stored: GridSchema | null; prev: number; next: number; ctx: Ctx }> = [];
      let fail = true;
      const registry = createGridRegistry([
        defineGrid<Ctx>({
          id: "a",
          schema: createFixtureSchema(),
          schemaStore: store,
          source: () => memory("admin"),
          onSchemaChange: async (ctx, prev, next) => {
            seen.push({ stored: await store.get("a"), prev: prev.schemaVersion, next: next.schemaVersion, ctx });
            if (fail) throw Object.assign(new Error("ALTER failed"), { code: "INTERNAL" });
          },
        }),
      ]);
      const base = createFixtureSchema();
      expect(await registry.handle("a", "updateSchema", withColumn(base), { role: "admin" })).toMatchObject({
        status: 500,
      });
      expect(await store.get("a")).toBeNull();
      fail = false;
      expect((await registry.handle("a", "updateSchema", withColumn(base), { role: "admin" })).ok).toBe(true);
      expect(seen.at(-1)).toEqual({
        stored: null,
        prev: base.schemaVersion,
        next: base.schemaVersion + 1,
        ctx: { role: "admin" },
      });
    });

    it("is subject to permission like any other op", async () => {
      const registry = createGridRegistry([
        defineGrid<Ctx>({
          id: "a",
          schema: createFixtureSchema(),
          schemaStore: createMemorySchemaStore(),
          permission: (ctx, op) => op !== "updateSchema" || ctx.role === "admin",
          source: () => memory("admin"),
        }),
      ]);
      expect(
        await registry.handle("a", "updateSchema", withColumn(createFixtureSchema()), { role: "counsellor" }),
      ).toMatchObject({ status: 403, error: { code: "PERMISSION_DENIED" } });
    });
  });

  describe("list", () => {
    it("lists the grids whose getSchema is permitted for ctx", async () => {
      const registry = createGridRegistry([
        defineGrid<Ctx>({ id: "a", schema: createFixtureSchema(), source: () => memory("admin") }),
        defineGrid<Ctx>({
          id: "b",
          schema: createFixtureSchema(),
          permission: (ctx) => ctx.role === "admin",
          source: () => memory("admin"),
        }),
      ]);
      expect(await registry.list({ role: "admin" })).toEqual([{ id: "a" }, { id: "b" }]);
      expect(await registry.list({ role: "counsellor" })).toEqual([{ id: "a" }]);
    });
  });
});

describe("createMemorySchemaStore", () => {
  it("stores deep copies per grid id", async () => {
    const store = createMemorySchemaStore();
    expect(await store.get("a")).toBeNull();
    const schema = createFixtureSchema();
    await store.put("a", schema);
    (schema.columns[0] as { label: string }).label = "mutated";
    const read = await store.get("a");
    expect(read?.columns[0]?.label).not.toBe("mutated");
    (read?.columns[0] as { label: string }).label = "mutated again";
    expect((await store.get("a"))?.columns[0]?.label).not.toBe("mutated again");
    expect(await store.get("b")).toBeNull();
  });
});

describe("capabilities.schema (v0.3)", () => {
  const caps = async (registry: ReturnType<typeof createGridRegistry<Ctx>>, role: Role) => {
    const res = await registry.handle("a", "capabilities", null, { role });
    if (!res.ok) throw new Error(res.error.code);
    return res.data as { schema: { read: boolean; write: boolean } };
  };

  it("write follows updateSchema permission on a grid with a schema store; read follows getSchema", async () => {
    const permission = vi.fn((ctx: Ctx, op: string) => op !== "updateSchema" || ctx.role === "admin");
    const registry = createGridRegistry([
      defineGrid<Ctx>({ id: "a", schema: createFixtureSchema(), schemaStore: createMemorySchemaStore(), permission, source: () => memory("admin") }),
    ]);
    expect((await caps(registry, "counsellor")).schema).toEqual({ read: true, write: false });
    expect((await caps(registry, "admin")).schema).toEqual({ read: true, write: true });
  });

  it("no schema store → write is false even for an admin; no permission hook → read true", async () => {
    const registry = createGridRegistry([defineGrid<Ctx>({ id: "a", schema: createFixtureSchema(), source: () => memory("admin") })]);
    expect((await caps(registry, "admin")).schema).toEqual({ read: true, write: false });
  });

  it("overrides whatever the source reported and evaluates each permission at most once per request", async () => {
    const permission = vi.fn(async (_ctx: Ctx, _op: string) => true);
    const source = (): DataSource<GridRow> => {
      const inner = memory("admin");
      return { ...inner, capabilities: async () => ({ ...(await getDataSourceCapabilities(inner)), schema: { read: false, write: false } }) };
    };
    const registry = createGridRegistry([
      defineGrid<Ctx>({ id: "a", schema: createFixtureSchema(), schemaStore: createMemorySchemaStore(), permission, source }),
    ]);
    expect((await caps(registry, "admin")).schema).toEqual({ read: true, write: true });
    const ops = permission.mock.calls.map((c) => c[1]).sort();
    expect(ops).toEqual(["capabilities", "getSchema", "updateSchema"]);
    // A non-capabilities op only asks about itself.
    permission.mockClear();
    await registry.handle("a", "fetch", q(), { role: "admin" });
    expect(permission.mock.calls.map((c) => c[1])).toEqual(["fetch"]);
  });
});
