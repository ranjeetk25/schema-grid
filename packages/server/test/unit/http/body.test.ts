import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import { createFixtureRows, createFixtureSchema, FIXTURE_NOW } from "@ranjeetk25/schema-grid-core/testing";
import { describe, expect, it, vi } from "vitest";
import { isNullInputOperation, normalizeRequestBody } from "../../../src/http/body";
import {
  createGridRegistry,
  createGridRouterAdapter,
  defineGrid,
  type ExpressLikeResponse,
  toExpressHandler,
  toExpressRouter,
} from "../../../src/http/index";

const memory = () =>
  createInMemoryDataSource({ schema: createFixtureSchema(), rows: createFixtureRows(), now: () => new Date(FIXTURE_NOW) });

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

describe("normalizeRequestBody", () => {
  it("knows the null-input ops from the wire schemas", () => {
    expect(isNullInputOperation("capabilities")).toBe(true);
    expect(isNullInputOperation("getSchema")).toBe(true);
    expect(isNullInputOperation("fetch")).toBe(false);
    expect(isNullInputOperation("nope")).toBe(false);
  });

  it("maps a missing / empty / `{}` / raw 'null' body to null for null-input ops only", () => {
    for (const body of [undefined, null, "", "  ", "null", " null\n", {}]) {
      expect(normalizeRequestBody("capabilities", body)).toBeNull();
      expect(normalizeRequestBody("getSchema", body)).toBeNull();
    }
    expect(normalizeRequestBody("fetch", undefined)).toBeUndefined();
    expect(normalizeRequestBody("fetch", {})).toEqual({});
    expect(normalizeRequestBody("fetch", "null")).toBe("null");
    // Non-empty bodies on null-input ops are left for schema validation to reject.
    expect(normalizeRequestBody("capabilities", { a: 1 })).toEqual({ a: 1 });
    expect(normalizeRequestBody("capabilities", [])).toEqual([]);
    expect(normalizeRequestBody("capabilities", "{}")).toBe("{}");
  });
});

describe("Express adapters accept body-less null-input requests", () => {
  const registry = createGridRegistry([defineGrid({ id: "admissions", schema: createFixtureSchema(), source: () => memory() })]);
  const router = toExpressRouter(registry);

  it.each([
    ["no body (Express 5 / no parser)", undefined],
    ["raw 'null' text (express.text())", "null"],
    ["{} (Express 4 express.json() without a body)", {}],
    ["JSON null (express.json({ strict: false }))", null],
  ])("POST /:gridId/capabilities with %s → 200", async (_name, body) => {
    const res = fakeRes();
    await router({ method: "POST", path: "/admissions/capabilities", body }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ data: { maxPageSize: expect.any(Number) } });
    const schema = fakeRes();
    await router({ method: "POST", path: "/admissions/getSchema", body }, schema);
    expect(schema.statusCode).toBe(200);
    expect((schema.body as { data: { id: string } }).data.id).toBe("admissions");
  });

  it("does not loosen other ops: fetch without a body is still INPUT_INVALID", async () => {
    const res = fakeRes();
    await router({ method: "POST", path: "/admissions/fetch", body: undefined }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "INPUT_INVALID" } });
    const empty = fakeRes();
    await router({ method: "POST", path: "/admissions/fetch", body: {} }, empty);
    expect(empty.statusCode).toBe(400);
  });

  it("toExpressHandler (single data source) gets the same tolerance", async () => {
    const handler = toExpressHandler(createGridRouterAdapter(memory()));
    for (const body of [undefined, "null", {}]) {
      const res = fakeRes();
      await handler({ params: { op: "capabilities" }, body }, res);
      expect(res.statusCode).toBe(200);
    }
  });
});
