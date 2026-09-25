import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "../../src/datasource/types";
import { createInMemoryDataSource } from "../../src/memory/data-source";
import type { GridQuery } from "../../src/query/types";
import type { GridRow } from "../../src/rows/types";
import { createFixtureLinkTargets, createFixtureRows } from "../../src/testing/rows";
import { createFixtureSchema, FIXTURE_COLUMN_IDS as C, FIXTURE_NOW, FIXTURE_USERS } from "../../src/testing/schema";
import { createDataSourceHandler, unwrapWireResult } from "../../src/wire/handler";
import { RemoteDataSourceError } from "../../src/wire/errors";
import { inferCapabilities } from "../../src/datasource/capabilities";

const q = (over: Partial<GridQuery> = {}): GridQuery => ({ filter: null, sort: [], page: { offset: 0, limit: 100 }, ...over });

function source(user: keyof typeof FIXTURE_USERS = "admin") {
  return createInMemoryDataSource({
    schema: createFixtureSchema(),
    rows: createFixtureRows(),
    now: () => new Date(FIXTURE_NOW),
    user: { id: FIXTURE_USERS[user].id, roles: [...FIXTURE_USERS[user].roles] },
    linkTargets: createFixtureLinkTargets(),
  });
}

/** A data source with only the four required operations. */
function minimal(overrides: Partial<DataSource<GridRow>> = {}): DataSource<GridRow> {
  return {
    fetch: async () => ({ rows: [] }),
    applyChanges: async () => ({ applied: [], conflicts: [], errors: [] }),
    createRows: async () => [],
    deleteRows: async () => undefined,
    ...overrides,
  };
}

describe("createDataSourceHandler", () => {
  it("returns ok envelopes with the data source's result", async () => {
    const handle = createDataSourceHandler(source());
    const res = await handle("fetch", q());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.rows.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });

  it("answers deleteRows with null", async () => {
    const ds = source();
    expect(await createDataSourceHandler(ds)("deleteRows", { ids: ["r1"] })).toEqual({ ok: true, data: null });
    expect(ds.snapshot().map((r) => r.id)).not.toContain("r1");
  });

  it("rejects unknown and prototype operation names with UNKNOWN_OPERATION 404", async () => {
    const handle = createDataSourceHandler(source());
    for (const op of ["drop", "toString", "__proto__", "snapshot"]) {
      const res = await handle(op, {});
      expect(res).toMatchObject({ ok: false, status: 404, error: { code: "UNKNOWN_OPERATION" } });
    }
  });

  it("rejects structurally invalid input with INPUT_INVALID 400 and zod issues", async () => {
    const fetch = vi.fn();
    const handle = createDataSourceHandler(minimal({ fetch }));
    const res = await handle("fetch", { filter: null, sort: "name", page: { offset: 0, limit: 1 } });
    expect(res).toMatchObject({ ok: false, status: 400, error: { code: "INPUT_INVALID" } });
    if (!res.ok) expect(res.error.details).toEqual({ issues: [expect.objectContaining({ path: ["sort"] })] });
    expect(fetch).not.toHaveBeenCalled();
    expect(await handle("deleteRows", "r1")).toMatchObject({ error: { code: "INPUT_INVALID" } });
  });

  it("reports a malformed filter AST as FILTER_INVALID 400", async () => {
    const res = await createDataSourceHandler(source())("fetch", q({ filter: { op: "xor", children: [] } as never }));
    expect(res).toMatchObject({ ok: false, status: 400, error: { code: "FILTER_INVALID" } });
  });

  it("reports a semantically invalid filter from the data source as FILTER_INVALID 400", async () => {
    const res = await createDataSourceHandler(source("counsellor"))(
      "fetch",
      q({ filter: { columnId: C.notes, operator: "contains", value: "vip" } }),
    );
    expect(res).toMatchObject({ ok: false, status: 400, error: { code: "FILTER_INVALID" } });
  });

  it("returns UNSUPPORTED_OPERATION 501 for optional operations the source lacks", async () => {
    const handle = createDataSourceHandler(minimal());
    for (const [op, input] of [
      ["getChanges", { since: "0" }],
      ["getOptions", { columnId: "c" }],
      ["createOption", { columnId: "c", label: "x" }],
      ["lookup", { columnId: "c", search: "" }],
    ] as const) {
      expect(await handle(op, input)).toMatchObject({
        ok: false,
        status: 501,
        error: { code: "UNSUPPORTED_OPERATION" },
      });
    }
  });

  it("answers the grid-level schema operations with UNSUPPORTED_OPERATION 501 (served by a grid registry)", async () => {
    const onError = vi.fn();
    const handle = createDataSourceHandler(source(), { onError });
    for (const [op, input] of [
      ["getSchema", null],
      ["updateSchema", createFixtureSchema()],
    ] as const) {
      expect(await handle(op, input)).toMatchObject({ ok: false, status: 501, error: { code: "UNSUPPORTED_OPERATION" } });
    }
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("hides unexpected errors as INTERNAL 500 and reports them to onError", async () => {
    const boom = new Error("secret stack detail");
    const onError = vi.fn();
    const handle = createDataSourceHandler(minimal({ fetch: async () => Promise.reject(boom) }), { onError });
    const res = await handle("fetch", q());
    expect(res).toEqual({ ok: false, status: 500, error: { code: "INTERNAL", message: "Internal error" } });
    expect(onError).toHaveBeenCalledWith(boom, {
      op: "fetch",
      status: 500,
      error: { code: "INTERNAL", message: "Internal error" },
    });
    const exposed = createDataSourceHandler(minimal({ fetch: async () => Promise.reject(boom) }), {
      exposeInternalErrors: true,
    });
    expect(await exposed("fetch", q())).toMatchObject({ error: { message: "secret stack detail" } });
  });

  it("lets mapError override the default mapping", async () => {
    class NotLoggedIn extends Error {}
    const handle = createDataSourceHandler(minimal({ fetch: async () => Promise.reject(new NotLoggedIn("who?")) }), {
      mapError: (err) => (err instanceof NotLoggedIn ? { code: "UNAUTHENTICATED", message: err.message } : undefined),
    });
    expect(await handle("fetch", q())).toEqual({
      ok: false,
      status: 401,
      error: { code: "UNAUTHENTICATED", message: "who?" },
    });
  });

  it("validates outputs only when asked", async () => {
    const bad = minimal({ fetch: async () => ({ rows: [{ id: 1 }] }) as never });
    expect((await createDataSourceHandler(bad)("fetch", q())).ok).toBe(true);
    expect(await createDataSourceHandler(bad, { validateOutput: true })("fetch", q())).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "OUTPUT_INVALID" },
    });
  });

  it("never throws, even when onError throws", async () => {
    const handle = createDataSourceHandler(minimal({ fetch: async () => Promise.reject(new Error("x")) }), {
      onError: () => {
        throw new Error("logger down");
      },
    });
    expect(await handle("fetch", q())).toMatchObject({ ok: false, status: 500 });
  });
});

describe("unwrapWireResult", () => {
  it("returns data or throws RemoteDataSourceError with the envelope status", () => {
    expect(unwrapWireResult({ ok: true, data: 5 })).toBe(5);
    let caught: unknown;
    try {
      unwrapWireResult({ ok: false, status: 418, error: { code: "PERMISSION_DENIED", message: "no" } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RemoteDataSourceError);
    expect(caught).toMatchObject({ code: "PERMISSION_DENIED", status: 418, message: "no" });
  });

  it("answers capabilities from the source when it implements them", async () => {
    const ds = createInMemoryDataSource({ schema: createFixtureSchema(), capabilities: { maxPageSize: 200, groupBy: false } });
    const res = await createDataSourceHandler(ds, { validateOutput: true })("capabilities", null);
    expect(res).toMatchObject({ ok: true, data: { maxPageSize: 200, groupBy: false, search: true } });
  });

  it("answers a computed default for sources without capabilities()", async () => {
    const res = await createDataSourceHandler(minimal(), { validateOutput: true })("capabilities", null);
    expect(res).toEqual({ ok: true, data: inferCapabilities(minimal()) });
    if (res.ok) expect(res.data).toMatchObject({ changeFeed: false, options: false, lookup: false, groupBy: true });
  });

  it("normalises a partial capabilities() result", async () => {
    const ds = minimal({ capabilities: () => ({ maxPageSize: 50 }) as never });
    const res = await createDataSourceHandler(ds, { validateOutput: true })("capabilities", null);
    expect(res).toMatchObject({ ok: true, data: { maxPageSize: 50, sort: "all", write: { cells: true } } });
  });
});
