import { readFileSync } from "node:fs";
import {
  type DataSource,
  type GridRow,
  type GridSchema,
  createRolePermissionResolver,
  resolveColumnAccess,
} from "@ranjeetk25/schema-grid-core";
import { createFixtureSchema } from "@ranjeetk25/schema-grid-core/testing";
import {
  CursorError,
  FilterValidationError,
  PermissionError,
  RowValidationError,
  SchemaValidationError,
} from "@ranjeetk25/schema-grid-server";
import type { GridDb } from "@ranjeetk25/schema-grid-server/drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type GridRequestContext, createApp } from "../src/app";
import { gridTables } from "../src/db";
import { leadsSchema } from "../src/leads/grid";
import { HttpError, toErrorResponse } from "../src/http-error";
import { SchemaStore } from "../src/schema-store";

function fakeDs(error?: unknown): DataSource<GridRow> & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const run = async <T>(
    name: string,
    args: unknown[],
    value: T,
  ): Promise<T> => {
    calls.push([name, ...args]);
    if (error) throw error;
    return value;
  };
  return {
    calls,
    fetch: (q) => run("fetch", [q], { rows: [] }),
    applyChanges: (b) =>
      run("applyChanges", [b], { applied: [], conflicts: [], errors: [] }),
    createRows: (p) => run("createRows", [p], []),
    deleteRows: (ids) => run("deleteRows", [ids], undefined),
    getChanges: (since) =>
      run("getChanges", [since], {
        cursor: "1",
        rows: [],
        deletedRowIds: [],
        schemaVersion: 1,
      }),
    getOptions: (columnId, search) =>
      run("getOptions", [columnId, search], [{ id: "a", label: "A" }]),
    lookup: (columnId, search) => run("lookup", [columnId, search], []),
  };
}

describe("toErrorResponse", () => {
  it.each([
    ["PermissionError", new PermissionError(["col_notes"], "filter"), 403],
    [
      "FilterValidationError",
      new FilterValidationError([
        { code: "unknownColumn", path: [], message: "bad" },
      ]),
      400,
    ],
    ["CursorError", new CursorError(), 400],
    [
      "SchemaValidationError",
      new SchemaValidationError([{ code: "x", path: [], message: "bad" }]),
      400,
    ],
    ["RowValidationError", new RowValidationError(0, "col_fee", "bad"), 400],
    ["HttpError", new HttpError(409, "Conflict", "stale"), 409],
    ["plain Error", new Error("boom"), 500],
  ])("%s → %i", (_name, error, status) => {
    expect(toErrorResponse(error).status).toBe(status);
  });

  it("serialises name, message and details", () => {
    expect(
      toErrorResponse(new PermissionError(["col_notes"], "filter")).body,
    ).toEqual({
      error: {
        name: "PermissionError",
        message: "Permission denied for filter on 1 column(s)",
        details: { columnIds: ["col_notes"], usage: "filter" },
      },
    });
    expect(toErrorResponse("weird").body).toEqual({
      error: { name: "Error", message: "weird" },
    });
  });
});

describe("app routes that need no database", () => {
  const { app } = createApp({
    db: {} as GridDb,
    tables: gridTables(),
    gridId: "admissions",
    store: new SchemaStore(null, createFixtureSchema),
    tz: "Asia/Kolkata",
    clock: "2026-09-24T21:00:00.000Z",
  });

  it("GET /health", async () => {
    const res = await app.request("/health");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("CORS preflight allows the fake-auth headers and exposes content-disposition", async () => {
    const res = await app.request("/grid/fetch", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:6006",
        "access-control-request-method": "POST",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "content-type,x-user,x-roles,x-now",
    );
    const get = await app.request("/health", {
      headers: { origin: "http://localhost:6006" },
    });
    expect(get.headers.get("access-control-expose-headers")).toBe(
      "content-disposition",
    );
  });

  it("GET /schema returns the fixture schema", async () => {
    const res = await app.request("/schema");
    expect(((await res.json()) as { id: string }).id).toBe("admissions");
  });

  it("grid route speaks the wire contract: unknown op 404, bad x-now / non-JSON / bad input 400", async () => {
    const unknown = await app.request("/grid/nope", {
      method: "POST",
      body: "{}",
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      error: { code: "UNKNOWN_OPERATION" },
    });
    const badNow = await app.request("/grid/fetch", {
      method: "POST",
      body: JSON.stringify({ filter: null, sort: [], page: { offset: 0, limit: 1 } }),
      headers: { "x-now": "tomorrow-ish" },
    });
    expect(badNow.status).toBe(400);
    expect(await badNow.json()).toEqual({
      error: { code: "INPUT_INVALID", message: "x-now must be an ISO instant" },
    });
    const badJson = await app.request("/grid/fetch", {
      method: "POST",
      body: "{",
    });
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toMatchObject({
      error: { code: "INPUT_INVALID" },
    });
    const badInput = await app.request("/grid/deleteRows", {
      method: "POST",
      body: JSON.stringify({ ids: "r1" }),
    });
    expect(badInput.status).toBe(400);
    expect(await badInput.json()).toMatchObject({
      error: { code: "INPUT_INVALID" },
    });
  });

  it("PUT /schema with a stale schemaVersion → 409", async () => {
    const res = await app.request("/schema", {
      method: "PUT",
      body: JSON.stringify({ ...createFixtureSchema(), schemaVersion: 0 }),
    });
    expect(res.status).toBe(409);
  });
});

describe("legacy /grid/:op route (fake data source)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const setup = (error?: unknown, omit: string[] = []) => {
    const ds = fakeDs(error);
    for (const op of omit) delete (ds as unknown as Record<string, unknown>)[op];
    const contexts: GridRequestContext[] = [];
    const { app } = createApp({
      db: {} as GridDb,
      tables: gridTables(),
      gridId: "admissions",
      store: new SchemaStore(null, createFixtureSchema),
      tz: "Asia/Kolkata",
      clock: "2026-09-24T21:00:00.000Z",
      dataSource: (ctx) => {
        contexts.push(ctx);
        return ds;
      },
    });
    const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
      app.request(`/grid/${op}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    return { ds, contexts, post };
  };
  const query = { filter: null, sort: [], page: { offset: 0, limit: 10 } };

  it("fetch takes the GridQuery itself and answers 200 { data }", async () => {
    const { ds, post } = setup();
    const res = await post("fetch", query);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { rows: [] } });
    expect(ds.calls[0]?.[0]).toBe("fetch");
    expect(ds.calls[0]?.[1]).toMatchObject(query);
  });

  it("deleteRows answers { data: null }; lookup/getOptions forward their args", async () => {
    const { ds, post } = setup();
    expect(await (await post("deleteRows", { ids: ["r1"] })).json()).toEqual({ data: null });
    expect(await (await post("getOptions", { columnId: "c", search: "x" })).json()).toEqual({
      data: [{ id: "a", label: "A" }],
    });
    await post("lookup", { columnId: "c", search: "" });
    expect(ds.calls.map((c) => c[0])).toEqual(["deleteRows", "getOptions", "lookup"]);
    expect(ds.calls[2]).toEqual(["lookup", "c", ""]);
  });

  it("an optional op the source lacks → 501 UNSUPPORTED_OPERATION", async () => {
    const { post } = setup(undefined, ["createOption"]);
    const res = await post("createOption", { columnId: "c", label: "x" });
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ error: { code: "UNSUPPORTED_OPERATION" } });
  });

  it.each([
    [new PermissionError(["col_notes"], "filter"), 403, "PERMISSION_DENIED"],
    [new FilterValidationError([{ code: "unknownColumn", path: [], message: "bad" }]), 400, "FILTER_INVALID"],
    [new CursorError(), 400, "INVALID_CURSOR"],
    [new HttpError(400, "InputValidationError", "no options"), 400, "INPUT_INVALID"],
    [new Error("boom"), 500, "INTERNAL"],
  ])("%s → %i %s", async (error, status, code) => {
    // 5xx failures are logged by the app's onError; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { post } = setup(error);
    const res = await post("fetch", query);
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  });

  it("x-user / x-roles / x-now reach the data source context", async () => {
    const { contexts, post } = setup();
    await post("fetch", query, {
      "x-user": "u2",
      "x-roles": "counsellor, viewer",
      "x-now": "2026-09-26T00:00:00.000Z",
    });
    await post("fetch", query);
    expect(contexts[0]?.user).toEqual({ id: "u2", roles: ["counsellor", "viewer"] });
    expect(contexts[0]?.now().toISOString()).toBe("2026-09-26T00:00:00.000Z");
    expect(contexts[1]?.user).toEqual({ id: "admin", roles: ["admin"] });
    expect(contexts[1]?.now().toISOString()).toBe("2026-09-24T21:00:00.000Z");
  });
});

describe("multi-grid endpoint /grid/:gridId/:op (no database)", () => {
  const contexts: GridRequestContext[] = [];
  const ds = fakeDs();
  const { app, grids } = createApp({
    db: {} as GridDb,
    tables: gridTables(),
    gridId: "admissions",
    store: new SchemaStore(null, createFixtureSchema),
    tz: "Asia/Kolkata",
    clock: "2026-09-24T21:00:00.000Z",
    dataSource: (ctx) => {
      contexts.push(ctx);
      return ds;
    },
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("registers both grids and lists them at GET /grid", async () => {
    expect(await grids.list({ user: { id: "a", roles: [] }, now: () => new Date() })).toEqual([
      { id: "admissions" },
      { id: "leads" },
    ]);
    expect(await (await app.request("/grid")).json()).toEqual({ data: [{ id: "admissions" }, { id: "leads" }] });
  });

  it("GET /grid/:gridId/schema serves each grid's schema", async () => {
    const admissions = (await (await app.request("/grid/admissions/schema")).json()) as { data: GridSchema };
    expect(admissions.data.id).toBe("admissions");
    const leads = (await (await app.request("/grid/leads/schema")).json()) as { data: GridSchema };
    expect(leads.data).toEqual(leadsSchema);
  });

  it("POST /grid/admissions/fetch reaches the fixture grid's source with the header context", async () => {
    const res = await post("/grid/admissions/fetch", { filter: null, sort: [], page: { offset: 0, limit: 5 } }, {
      "x-user": "u9",
      "x-roles": "counsellor",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { rows: [] } });
    expect(contexts.at(-1)?.user).toEqual({ id: "u9", roles: ["counsellor"] });
  });

  it("unknown grid 404, bad x-now 400, counsellor updateSchema on leads 403", async () => {
    const unknown = await post("/grid/nope/fetch", {});
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "UNKNOWN_GRID" } });
    const badNow = await post("/grid/admissions/fetch", {}, { "x-now": "soon" });
    expect(badNow.status).toBe(400);
    expect(await badNow.json()).toEqual({ error: { code: "INPUT_INVALID", message: "x-now must be an ISO instant" } });
    const denied = await post("/grid/leads/updateSchema", leadsSchema, { "x-roles": "counsellor" });
    expect(denied.status).toBe(403);
  });

  it("admin updateSchema on leads persists in the (memory) schema store", async () => {
    const renamed = {
      ...leadsSchema,
      columns: leadsSchema.columns.map((c) => (c.key === "email" ? { ...c, label: "E-mail" } : c)),
    };
    const res = await post("/grid/leads/updateSchema", renamed);
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as { data: GridSchema }).data;
    expect(saved.schemaVersion).toBe(leadsSchema.schemaVersion + 1);
    const again = (await (await app.request("/grid/leads/schema")).json()) as { data: GridSchema };
    expect(again.data.columns.find((c) => c.key === "email")?.label).toBe("E-mail");
  });

  it("PUT /schema (legacy) still answers 409 SchemaVersionConflict on a stale version", async () => {
    const res = await app.request("/schema", {
      method: "PUT",
      body: JSON.stringify({ ...createFixtureSchema(), schemaVersion: 0 }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { name: "SchemaVersionConflict" } });
  });
});

describe("leads schema", () => {
  it("aiVerified is settable:false (read for everyone, even admins), not an empty-roles permission", () => {
    const ai = leadsSchema.columns.find((c) => c.key === "aiVerified");
    expect(ai?.settable).toBe(false);
    expect(ai?.permissions).toBeUndefined();
    const access = resolveColumnAccess(leadsSchema, createRolePermissionResolver(), { id: "a", roles: ["admin"] });
    expect(access.get("aiVerified")).toBe("read");
    expect(access.get("name")).toBe("edit");
  });
});

describe("docs/consuming.md", () => {
  it("embeds the leads grid file verbatim, and it stays within 40 lines", () => {
    const file = readFileSync(new URL("../src/leads/grid.ts", import.meta.url), "utf8");
    const docs = readFileSync(new URL("../../../docs/consuming.md", import.meta.url), "utf8");
    expect(file.trimEnd().split("\n").length).toBeLessThanOrEqual(40);
    expect(docs).toContain(file.trimEnd());
  });
});
