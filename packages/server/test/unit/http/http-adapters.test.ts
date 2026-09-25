import type { DataSource, FilterNode, GridQuery, GridRow } from "@masai/schema-grid-core";
import { createInMemoryDataSource } from "@masai/schema-grid-core/memory";
import {
  createFixtureRows,
  createFixtureSchema,
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_USERS,
} from "@masai/schema-grid-core/testing";
import { describe, expect, it, vi } from "vitest";
import {
  CursorError,
  FilterValidationError,
  FormulaQueryLimitError,
  GroupingError,
  PermissionError,
  RowValidationError,
  SchemaValidationError,
  UnsupportedOperatorError,
} from "../../../src/errors";
import {
  createGridRouterAdapter,
  type ExpressLikeResponse,
  type LambdaLikeEvent,
  toExpressHandler,
  toHttpResponse,
  toLambdaHandler,
} from "../../../src/http/index";

const q = (over: Partial<GridQuery> = {}): GridQuery => ({ filter: null, sort: [], page: { offset: 0, limit: 50 }, ...over });
const spec8: FilterNode = {
  op: "and",
  children: [
    { columnId: C.status, operator: "isNot", value: "paid" },
    { columnId: C.callDate, operator: "isWithin", value: { relative: "yesterday" } },
  ],
};

function memory(user: keyof typeof FIXTURE_USERS = "admin") {
  return createInMemoryDataSource({
    schema: createFixtureSchema(),
    rows: createFixtureRows(),
    now: () => new Date(FIXTURE_NOW),
    user: { id: FIXTURE_USERS[user].id, roles: [...FIXTURE_USERS[user].roles] },
  });
}

function throwing(err: unknown): DataSource<GridRow> {
  return {
    fetch: async () => Promise.reject(err),
    applyChanges: async () => Promise.reject(err),
    createRows: async () => Promise.reject(err),
    deleteRows: async () => Promise.reject(err),
  };
}

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

describe("createGridRouterAdapter", () => {
  it("runs operations against a fixed data source", async () => {
    const adapter = createGridRouterAdapter(memory());
    const res = await adapter.handle("fetch", q({ filter: spec8 }));
    expect(res.ok && res.data.rows.map((r) => r.id)).toEqual(["r2", "r3"]);
  });

  it("resolves a per-request data source from the context", async () => {
    const factory = vi.fn((ctx: { role: keyof typeof FIXTURE_USERS }) => memory(ctx.role));
    const adapter = createGridRouterAdapter(factory);
    const admin = await adapter.handle("fetch", q(), { role: "admin" });
    const counsellor = await adapter.handle("fetch", q(), { role: "counsellor" });
    expect(admin.ok && admin.data.rows[0]?.cells).toHaveProperty("notes");
    expect(counsellor.ok && counsellor.data.rows[0]?.cells).not.toHaveProperty("notes");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("maps a throwing factory (e.g. auth) through the error mapping", async () => {
    const adapter = createGridRouterAdapter<{ token?: string }>(async (ctx) => {
      if (!ctx.token) throw Object.assign(new Error("Sign in first"), { code: "UNAUTHENTICATED" });
      return memory();
    });
    expect(await adapter.handle("fetch", q(), {})).toEqual({
      ok: false,
      status: 401,
      error: { code: "UNAUTHENTICATED", message: "Sign in first" },
    });
  });

  it.each([
    [new PermissionError(["col_notes"], "filter"), "PERMISSION_DENIED", 403],
    [new FilterValidationError([]), "FILTER_INVALID", 400],
    [new UnsupportedOperatorError("near"), "FILTER_INVALID", 400],
    [new CursorError(), "INVALID_CURSOR", 400],
    [new SchemaValidationError([{ code: "x", path: [], message: "bad schema" }]), "SCHEMA_INVALID", 400],
    [new FormulaQueryLimitError(["col_balance"], 5000), "FORMULA_ROW_CAP", 413],
    [new GroupingError("nope"), "GROUPING_INVALID", 400],
    [new RowValidationError(0, "col_name", "bad"), "ROW_INVALID", 400],
    [new Error("socket hang up"), "INTERNAL", 500],
  ])("maps server error %o to %s %i", async (err, code, status) => {
    const res = await createGridRouterAdapter(throwing(err)).handle("fetch", q());
    expect(res).toMatchObject({ ok: false, status, error: { code } });
  });

  it("keeps server error details on the wire", async () => {
    const res = await createGridRouterAdapter(throwing(new FormulaQueryLimitError(["col_balance"], 5000))).handle(
      "fetch",
      q(),
    );
    expect(!res.ok && res.error.details).toEqual({ columnIds: ["col_balance"], rowCap: 5000 });
  });
});

describe("adapter typing", () => {
  it("requires a context option when the adapter needs a context", () => {
    const adapter = createGridRouterAdapter((_ctx: { user: string }) => memory());
    // @ts-expect-error context is required for a context-bound adapter
    expect(typeof toExpressHandler(adapter)).toBe("function");
    // @ts-expect-error context is required for a context-bound adapter
    expect(typeof toLambdaHandler(adapter)).toBe("function");
    // @ts-expect-error handle needs the context argument
    void adapter.handle("fetch", q());
    expect(typeof toExpressHandler(createGridRouterAdapter(memory()))).toBe("function");
  });
});

describe("toHttpResponse", () => {
  it("wraps data and errors in the documented envelopes", () => {
    expect(toHttpResponse({ ok: true, data: [1] })).toEqual({ status: 200, body: { data: [1] } });
    expect(
      toHttpResponse({ ok: false, status: 403, error: { code: "PERMISSION_DENIED", message: "no" } }),
    ).toEqual({ status: 403, body: { error: { code: "PERMISSION_DENIED", message: "no" } } });
  });
});

describe("toExpressHandler", () => {
  it("answers 200 { data } using params.op and the JSON body", async () => {
    const handler = toExpressHandler(createGridRouterAdapter(memory()));
    const res = fakeRes();
    await handler({ params: { op: "fetch" }, body: q({ filter: spec8 }) }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as { data: { rows: GridRow[] } }).data.rows.map((r) => r.id)).toEqual(["r2", "r3"]);
  });

  it("answers { error } with the mapped status", async () => {
    const handler = toExpressHandler(createGridRouterAdapter(memory()));
    const res = fakeRes();
    await handler({ params: { op: "fetch" }, body: { nope: true } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "INPUT_INVALID" } });
    const missing = fakeRes();
    await handler({ params: {}, body: q() }, missing);
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: "UNKNOWN_OPERATION" } });
  });

  it("parses string bodies, supports a custom op param and derives context from req", async () => {
    const adapter = createGridRouterAdapter((ctx: { user: keyof typeof FIXTURE_USERS }) => memory(ctx.user));
    const handler = toExpressHandler(adapter, {
      opParam: "action",
      context: (req: { params?: Record<string, string>; body?: unknown; user: keyof typeof FIXTURE_USERS }) => ({
        user: req.user,
      }),
    });
    const res = fakeRes();
    await handler({ params: { action: "fetch" }, body: JSON.stringify(q()), user: "counsellor" }, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { rows: GridRow[] } }).data.rows[0]?.cells).not.toHaveProperty("notes");
    const bad = fakeRes();
    await handler({ params: { action: "fetch" }, body: "{not json", user: "admin" }, bad);
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatchObject({ error: { code: "INPUT_INVALID" } });
  });

  it("never rejects, even if context resolution throws", async () => {
    const handler = toExpressHandler(createGridRouterAdapter(memory()), {
      context: () => {
        throw new Error("boom");
      },
    });
    const res = fakeRes();
    await expect(handler({ params: { op: "fetch" }, body: q() }, res)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL", message: "Internal error" } });
  });
});

describe("toLambdaHandler", () => {
  it("returns an API Gateway proxy result with a JSON body", async () => {
    const handler = toLambdaHandler(createGridRouterAdapter(memory()));
    const out = await handler({ pathParameters: { op: "fetch" }, body: JSON.stringify(q({ filter: spec8 })) });
    expect(out.statusCode).toBe(200);
    expect(out.headers).toEqual({ "content-type": "application/json" });
    expect((JSON.parse(out.body) as { data: { rows: GridRow[] } }).data.rows.map((r) => r.id)).toEqual(["r2", "r3"]);
  });

  it("decodes base64 bodies and merges extra headers", async () => {
    const handler = toLambdaHandler(createGridRouterAdapter(memory()), { headers: { "x-grid": "1" } });
    const out = await handler({
      pathParameters: { op: "deleteRows" },
      body: Buffer.from(JSON.stringify({ ids: ["r1"] })).toString("base64"),
      isBase64Encoded: true,
    });
    expect(out).toEqual({
      statusCode: 200,
      headers: { "content-type": "application/json", "x-grid": "1" },
      body: JSON.stringify({ data: null }),
    });
  });

  it("maps missing op, missing body and invalid JSON to wire errors", async () => {
    const handler = toLambdaHandler(createGridRouterAdapter(memory()));
    const noOp = await handler({ body: "{}" });
    expect(noOp.statusCode).toBe(404);
    const noBody = await handler({ pathParameters: { op: "fetch" }, body: null });
    expect(noBody.statusCode).toBe(400);
    expect(JSON.parse(noBody.body)).toMatchObject({ error: { code: "INPUT_INVALID" } });
    const badJson = await handler({ pathParameters: { op: "fetch" }, body: "{" });
    expect(badJson.statusCode).toBe(400);
    expect(JSON.parse(badJson.body)).toMatchObject({ error: { code: "INPUT_INVALID" } });
  });

  it("derives the context from the event", async () => {
    const adapter = createGridRouterAdapter((ctx: { user: keyof typeof FIXTURE_USERS }) => memory(ctx.user));
    const handler = toLambdaHandler(adapter, {
      context: (event: LambdaLikeEvent & { headers?: Record<string, string> }) => ({
        user: event.headers?.["x-user"] === "counsellor" ? "counsellor" : "admin",
      }),
    });
    const out = await handler({
      pathParameters: { op: "createOption" },
      body: JSON.stringify({ columnId: C.fee, label: "x" }),
      headers: { "x-user": "counsellor" },
    });
    expect(out.statusCode).toBe(403);
  });
});
