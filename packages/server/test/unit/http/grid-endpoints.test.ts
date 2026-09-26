import type { FilterNode, GridQuery, GridRow, GridSchema } from "@ranjeetk25/schema-grid-core";
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import {
  createFixtureRows,
  createFixtureSchema,
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_USERS,
} from "@ranjeetk25/schema-grid-core/testing";
import { describe, expect, it, vi } from "vitest";
import {
  createGridRegistry,
  createMemorySchemaStore,
  defineGrid,
  type ExpressLikeResponse,
  type GridRegistry,
  type LambdaLikeEvent,
  toExpressRouter,
  toFetchHandler,
  toLambdaHandler,
} from "../../../src/http/index";

type Role = keyof typeof FIXTURE_USERS;
interface Ctx {
  role: Role;
}

const q = (over: Partial<GridQuery> = {}): GridQuery => ({ filter: null, sort: [], page: { offset: 0, limit: 50 }, ...over });
const spec8: FilterNode = {
  op: "and",
  children: [
    { columnId: C.status, operator: "isNot", value: "paid" },
    { columnId: C.callDate, operator: "isWithin", value: { relative: "yesterday" } },
  ],
};

function memory(role: Role, schema: GridSchema) {
  return createInMemoryDataSource({
    schema,
    rows: createFixtureRows(),
    now: () => new Date(FIXTURE_NOW),
    user: { id: FIXTURE_USERS[role].id, roles: [...FIXTURE_USERS[role].roles] },
  });
}

function registry(): GridRegistry<Ctx> {
  return createGridRegistry<Ctx>([
    defineGrid<Ctx>({
      id: "admissions",
      schema: createFixtureSchema(),
      schemaStore: createMemorySchemaStore(),
      permission: (ctx, op) => op !== "updateSchema" || ctx.role === "admin",
      source: (ctx, { schema }) => memory(ctx.role, schema),
    }),
    defineGrid<Ctx>({
      id: "secret",
      schema: createFixtureSchema(),
      permission: (ctx) => ctx.role === "admin",
      source: (ctx, { schema }) => memory(ctx.role, schema),
    }),
  ]);
}

const roleOf = (value: string | null | undefined): Role => (value === "counsellor" ? "counsellor" : "admin");

describe("toFetchHandler (Web Request → Response)", () => {
  const handler = toFetchHandler(registry(), {
    basePath: "/api/grid",
    context: (request) => ({ role: roleOf(request.headers.get("x-role")) }),
  });
  const post = (path: string, body: unknown, role = "admin") =>
    handler(
      new Request(`http://test.local/api/grid${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-role": role },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  it("POST /:gridId/:op answers 200 { data } as JSON", async () => {
    const res = await post("/admissions/fetch", q({ filter: spec8 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { data: { rows: GridRow[] } };
    expect(body.data.rows.map((r) => r.id)).toEqual(["r2", "r3"]);
  });

  it("derives the context from the request", async () => {
    const res = await post("/admissions/fetch", q(), "counsellor");
    const body = (await res.json()) as { data: { rows: GridRow[] } };
    expect(body.data.rows[0]?.cells).not.toHaveProperty("notes");
  });

  it("POST /:gridId/getSchema is the one way to read the schema (GET /:gridId/schema is gone, v0.3); GET / lists the permitted grids", async () => {
    const res = await post("/admissions/getSchema", "");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: GridSchema }).data).toEqual(createFixtureSchema());
    const legacy = await handler(new Request("http://test.local/api/grid/admissions/schema"));
    expect(legacy.status).toBe(405);
    expect(await legacy.json()).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
    const list = await handler(new Request("http://test.local/api/grid", { headers: { "x-role": "counsellor" } }));
    expect(await list.json()).toEqual({ data: [{ id: "admissions" }] });
    const slash = await handler(new Request("http://test.local/api/grid/"));
    expect(await slash.json()).toEqual({ data: [{ id: "admissions" }, { id: "secret" }] });
  });

  it("updateSchema round-trips and is permission-checked", async () => {
    const base = createFixtureSchema();
    const next = { ...base, columns: base.columns.map((c, i) => (i === 0 ? { ...c, label: "Renamed" } : c)) };
    expect((await post("/admissions/updateSchema", next, "counsellor")).status).toBe(403);
    const res = await post("/admissions/updateSchema", next);
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as { data: GridSchema }).data;
    expect(saved.schemaVersion).toBe(base.schemaVersion + 1);
    expect(saved.columns[0]?.label).toBe("Renamed");
  });

  it("maps errors: unknown grid 404, forbidden grid 403, bad JSON 400, unknown route 404, wrong method 405", async () => {
    const unknown = await post("/nope/fetch", q());
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "UNKNOWN_GRID" } });
    expect((await post("/secret/fetch", q(), "counsellor")).status).toBe(403);
    const bad = await post("/admissions/fetch", "{nope");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "INPUT_INVALID" } });
    const deep = await post("/admissions/fetch/extra", q());
    expect(deep.status).toBe(404);
    const outside = await handler(new Request("http://test.local/elsewhere/admissions/fetch", { method: "POST" }));
    expect(outside.status).toBe(404);
    const put = await handler(new Request("http://test.local/api/grid/admissions/fetch", { method: "PUT", body: "{}" }));
    expect(put.status).toBe(405);
    expect(await put.json()).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
  });

  it("decodes path segments and never rejects when context throws", async () => {
    const throwing = toFetchHandler(registry(), {
      context: () => {
        throw Object.assign(new Error("no session"), { code: "UNAUTHENTICATED" });
      },
    });
    const res = await throwing(new Request("http://x/admissions/fetch", { method: "POST", body: JSON.stringify(q()) }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "no session" } });
    const encoded = await toFetchHandler(registry(), { context: () => ({ role: "admin" as const }) })(
      new Request("http://x/%61dmissions/fetch", { method: "POST", body: JSON.stringify(q()) }),
    );
    expect(encoded.status).toBe(200);
  });

  it("an empty POST body is a null input (getSchema)", async () => {
    const res = await post("/admissions/getSchema", "");
    expect(res.status).toBe(200);
  });

  it("adds configured response headers", async () => {
    const h = toFetchHandler(registry(), { context: () => ({ role: "admin" as const }), headers: { "x-a": "1" } });
    const res = await h(new Request("http://x/admissions/getSchema", { method: "POST" }));
    expect(res.headers.get("x-a")).toBe("1");
  });
});

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res as ExpressLikeResponse;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
    }),
  };
  return res;
}

describe("toExpressRouter", () => {
  const router = toExpressRouter(registry(), {
    context: (req) => ({ role: roleOf(String(req.headers?.["x-role"])) }),
  });

  it("POST /:gridId/:op (path relative to the mount point, JSON or string body)", async () => {
    const res = fakeRes();
    const next = vi.fn();
    await router({ method: "POST", path: "/admissions/fetch", body: q({ filter: spec8 }) }, res, next);
    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { rows: GridRow[] } }).data.rows.map((r) => r.id)).toEqual(["r2", "r3"]);
    const str = fakeRes();
    await router({ method: "POST", url: "/admissions/fetch?x=1", body: JSON.stringify(q()) }, str, next);
    expect(str.statusCode).toBe(200);
    expect(next).not.toHaveBeenCalled();
  });

  it("POST /:gridId/getSchema and GET / (list); GET /:gridId/schema answers 405", async () => {
    const res = fakeRes();
    await router({ method: "POST", path: "/admissions/getSchema", headers: { "x-role": "counsellor" } }, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { data: GridSchema }).data.id).toBe(createFixtureSchema().id);
    const legacy = fakeRes();
    await router({ method: "GET", path: "/admissions/schema", headers: { "x-role": "counsellor" } }, legacy);
    expect(legacy.statusCode).toBe(405);
    const list = fakeRes();
    await router({ method: "GET", path: "/", headers: { "x-role": "counsellor" } }, list);
    expect(list.body).toEqual({ data: [{ id: "admissions" }] });
  });

  it("passes unmatched routes to next(); without next answers 404/405", async () => {
    const next = vi.fn();
    const res = fakeRes();
    await router({ method: "POST", path: "/a/b/c", body: {} }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    const lone = fakeRes();
    await router({ method: "DELETE", path: "/admissions/fetch" }, lone);
    expect(lone.statusCode).toBe(405);
  });

  it("errors use the wire envelope", async () => {
    const res = fakeRes();
    await router({ method: "POST", path: "/secret/fetch", body: q(), headers: { "x-role": "counsellor" } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });
});

describe("toLambdaHandler(registry)", () => {
  const handler = toLambdaHandler(registry(), {
    context: (event: LambdaLikeEvent & { headers?: Record<string, string> }) => ({
      role: roleOf(event.headers?.["x-role"]),
    }),
  });

  it("routes pathParameters { gridId, op } (REST v1 and HTTP v2 events)", async () => {
    const v1 = await handler({
      httpMethod: "POST",
      pathParameters: { gridId: "admissions", op: "fetch" },
      body: JSON.stringify(q({ filter: spec8 })),
    });
    expect(v1.statusCode).toBe(200);
    expect((JSON.parse(v1.body) as { data: { rows: GridRow[] } }).data.rows.map((r) => r.id)).toEqual(["r2", "r3"]);
    const v2 = await handler({
      requestContext: { http: { method: "POST" } },
      pathParameters: { gridId: "admissions", op: "fetch" },
      body: Buffer.from(JSON.stringify(q())).toString("base64"),
      isBase64Encoded: true,
      headers: { "x-role": "counsellor" },
    });
    expect((JSON.parse(v2.body) as { data: { rows: GridRow[] } }).data.rows[0]?.cells).not.toHaveProperty("notes");
  });

  it("POST { gridId, op: getSchema } reads the schema; GET with only { gridId } is 405; GET without a grid lists", async () => {
    const schema = await handler({ httpMethod: "POST", pathParameters: { gridId: "admissions", op: "getSchema" } });
    expect(schema.statusCode).toBe(200);
    expect((JSON.parse(schema.body) as { data: GridSchema }).data.id).toBe(createFixtureSchema().id);
    const legacy = await handler({ httpMethod: "GET", pathParameters: { gridId: "admissions" } });
    expect(legacy.statusCode).toBe(405);
    const list = await handler({ httpMethod: "GET", pathParameters: null, headers: { "x-role": "counsellor" } });
    expect(JSON.parse(list.body)).toEqual({ data: [{ id: "admissions" }] });
  });

  it("unknown grid → 404 UNKNOWN_GRID", async () => {
    const res = await handler({ httpMethod: "POST", pathParameters: { gridId: "x", op: "fetch" }, body: "{}" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: "UNKNOWN_GRID" } });
  });
});

describe("registry adapter typing", () => {
  it("requires a context option when the registry needs a context", () => {
    const reg = registry();
    // @ts-expect-error context is required for a context-bound registry
    expect(typeof toFetchHandler(reg)).toBe("function");
    // @ts-expect-error context is required for a context-bound registry
    expect(typeof toExpressRouter(reg)).toBe("function");
    // @ts-expect-error context is required for a context-bound registry
    expect(typeof toLambdaHandler(reg)).toBe("function");
    const open = createGridRegistry([
      defineGrid({ id: "a", schema: createFixtureSchema(), source: () => memory("admin", createFixtureSchema()) }),
    ]);
    expect(typeof toFetchHandler(open)).toBe("function");
  });
});
