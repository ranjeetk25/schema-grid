import type { DataSource, GridRow } from "@masai/schema-grid-core";
import { createFixtureSchema } from "@masai/schema-grid-core/testing";
import {
  CursorError,
  FilterValidationError,
  PermissionError,
  RowValidationError,
  SchemaValidationError,
} from "@masai/schema-grid-server";
import type { GridDb } from "@masai/schema-grid-server/drizzle";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { gridTables } from "../src/db";
import { HttpError, handleOp, toErrorResponse } from "../src/handle-op";
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

const statusOf = async (
  error: unknown,
  op = "fetch",
  body: unknown = { query: {} },
) => {
  try {
    await handleOp(fakeDs(error), op, body);
    return 200;
  } catch (err) {
    return toErrorResponse(err).status;
  }
};

describe("handleOp dispatch", () => {
  it("routes each op to the data source and returns the raw result", async () => {
    const ds = fakeDs();
    expect(
      await handleOp(ds, "fetch", { query: { filter: null, sort: [] } }),
    ).toEqual({ rows: [] });
    expect(await handleOp(ds, "deleteRows", { ids: ["r1"] })).toEqual({
      ok: true,
    });
    expect(
      await handleOp(ds, "getOptions", { columnId: "c", search: "x" }),
    ).toEqual([{ id: "a", label: "A" }]);
    expect(await handleOp(ds, "lookup", { columnId: "c" })).toEqual([]);
    expect(ds.calls.map((c) => c[0])).toEqual([
      "fetch",
      "deleteRows",
      "getOptions",
      "lookup",
    ]);
    expect(ds.calls[3]).toEqual(["lookup", "c", ""]);
  });

  it("unknown op → 404, missing capability → 501, malformed body → 400", async () => {
    expect(await statusOf(undefined, "explode")).toBe(404);
    expect(
      await statusOf(undefined, "createOption", { columnId: "c", label: "x" }),
    ).toBe(501);
    expect(await statusOf(undefined, "deleteRows", { ids: "r1" })).toBe(400);
    expect(await statusOf(undefined, "fetch", {})).toBe(400);
  });
});

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
  ])("%s → %i", async (_name, error, status) => {
    expect(await statusOf(error)).toBe(status);
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

  it("unknown op → 404 JSON error; bad x-now → 400; non-JSON body → 400", async () => {
    const unknown = await app.request("/grid/nope", {
      method: "POST",
      body: "{}",
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({
      error: { name: "UnknownOp", message: 'Unknown grid op "nope"' },
    });
    const badNow = await app.request("/grid/fetch", {
      method: "POST",
      body: "{}",
      headers: { "x-now": "tomorrow-ish" },
    });
    expect(badNow.status).toBe(400);
    const badJson = await app.request("/grid/fetch", {
      method: "POST",
      body: "{",
    });
    expect(badJson.status).toBe(400);
  });

  it("PUT /schema with a stale schemaVersion → 409", async () => {
    const res = await app.request("/schema", {
      method: "PUT",
      body: JSON.stringify({ ...createFixtureSchema(), schemaVersion: 0 }),
    });
    expect(res.status).toBe(409);
  });
});
