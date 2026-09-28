import { describe, expect, it, vi } from "vitest";
import type { ColorRule } from "../../src/colors/types";
import { DEFAULT_CAPABILITIES } from "../../src/datasource/capabilities";
import type { DataSource } from "../../src/datasource/types";
import { createInMemoryDataSource } from "../../src/memory/data-source";
import type { GridQuery } from "../../src/query/types";
import type { GridRow } from "../../src/rows/types";
import { createFixtureRows } from "../../src/testing/rows";
import { createFixtureSchema, FIXTURE_COLUMN_IDS as C, FIXTURE_NOW, FIXTURE_USERS } from "../../src/testing/schema";
import { createDataSourceHandler, unwrapWireResult } from "../../src/wire/handler";
import { GRID_OPERATIONS, OPTIONAL_GRID_OPERATIONS } from "../../src/wire/operations";
import { createRemoteDataSource } from "../../src/wire/remote";
import { wireSchemas } from "../../src/wire/schemas";

const q = (over: Partial<GridQuery> = {}): GridQuery => ({ filter: null, sort: [], page: { offset: 0, limit: 100 }, ...over });
const rule: ColorRule = {
  id: "a",
  color: "green",
  target: { kind: "cells", columnIds: [C.status] },
  when: { columnId: C.status, operator: "is", value: "paid" },
};

function source(user: keyof typeof FIXTURE_USERS = "admin") {
  return createInMemoryDataSource({
    schema: createFixtureSchema(),
    rows: createFixtureRows(),
    now: () => new Date(FIXTURE_NOW),
    user: { id: FIXTURE_USERS[user].id, roles: [...FIXTURE_USERS[user].roles] },
  });
}

function minimal(overrides: Partial<DataSource<GridRow>> = {}): DataSource<GridRow> {
  return {
    fetch: async () => ({ rows: [] }),
    applyChanges: async () => ({ applied: [], conflicts: [], errors: [] }),
    createRows: async () => [],
    deleteRows: async () => undefined,
    ...overrides,
  };
}

const json = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

describe("setCellColors operation", () => {
  it("is an optional grid operation", () => {
    expect(GRID_OPERATIONS).toContain("setCellColors");
    expect(OPTIONAL_GRID_OPERATIONS).toContain("setCellColors");
  });

  it("validates its input and output", () => {
    const input = wireSchemas.setCellColors.input;
    expect(input.safeParse({ id: "b", changes: [{ rowId: "r1", columnId: C.name, color: "red" }] }).success).toBe(true);
    expect(input.safeParse({ id: "b", changes: [{ rowId: "r1", columnId: C.name, color: null }] }).success).toBe(true);
    expect(input.safeParse({ id: "b", changes: [{ rowId: "r1", columnId: C.name, color: "magenta" }] }).success).toBe(false);
    expect(input.safeParse({ id: "b", changes: [{ rowId: "r1", columnId: C.name }] }).success).toBe(false);
    const output = wireSchemas.setCellColors.output;
    expect(output.safeParse({ applied: [], rejected: [{ rowId: "r1", columnId: C.name, message: "Read-only" }] }).success).toBe(
      true,
    );
    expect(output.safeParse({ applied: [], rejected: [], rows: [] }).success).toBe(true);
    expect(output.safeParse({ applied: [] }).success).toBe(false);
  });
});

describe("wire schemas carry colors", () => {
  it("fetch input accepts colorRules and preserves them", () => {
    const query = q({ filter: { columnId: C.status, operator: "colorIs", value: ["green"] }, colorRules: [rule, { ...rule, id: "b", target: { kind: "row" }, when: null, enabled: false }] });
    const parsed = wireSchemas.fetch.input.safeParse(query);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(query);
    expect(wireSchemas.fetch.input.safeParse(q({ colorRules: [{ ...rule, color: "magenta" as never }] })).success).toBe(false);
  });

  it("rows accept manual colors (palette names only)", () => {
    const row = { id: "r1", version: 1, updatedAt: FIXTURE_NOW, cells: {}, colors: { [C.name]: "red" } };
    expect(wireSchemas.getRows.output.safeParse([row]).success).toBe(true);
    expect(wireSchemas.getRows.output.safeParse([{ ...row, colors: { [C.name]: "#f00" } }]).success).toBe(false);
  });

  it("capabilities accept cellColors (optional for older servers)", () => {
    const out = wireSchemas.capabilities.output;
    expect(out.safeParse({ ...DEFAULT_CAPABILITIES, cellColors: { read: true, write: false, filter: true } }).success).toBe(true);
    const { cellColors: _omit, ...legacy } = DEFAULT_CAPABILITIES;
    expect(out.safeParse(legacy).success).toBe(true);
  });

  it("views keep colorRules through the schema schemas", () => {
    const schema = { ...createFixtureSchema(), views: [{ id: "v", name: "V", colorRules: [rule] }] };
    const parsed = wireSchemas.updateSchema.input.safeParse(schema);
    expect(parsed.success).toBe(true);
    expect((parsed.data?.views?.[0] as { colorRules?: unknown }).colorRules).toEqual([rule]);
  });
});

describe("handler", () => {
  it("dispatches setCellColors to the data source", async () => {
    const handle = createDataSourceHandler(source(), { validateOutput: true });
    const res = await handle("setCellColors", { id: "b", changes: [{ rowId: "r1", columnId: C.name, color: "red" }] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.applied).toEqual([{ rowId: "r1", columnId: C.name, color: "red" }]);
      expect(res.data.rows?.[0]?.colors).toEqual({ [C.name]: "red" });
    }
  });

  it("answers 501 when the source has no setCellColors", async () => {
    const handle = createDataSourceHandler(minimal());
    expect(await handle("setCellColors", { id: "b", changes: [] })).toMatchObject({
      ok: false,
      status: 501,
      error: { code: "UNSUPPORTED_OPERATION" },
    });
  });

  it("reports malformed colorRules as FILTER_INVALID", async () => {
    const handle = createDataSourceHandler(source());
    const res = await handle("fetch", { ...q(), colorRules: [{ id: "x", color: "magenta" }] });
    expect(res).toMatchObject({ ok: false, status: 400, error: { code: "FILTER_INVALID" } });
  });

  it("filters by color end to end", async () => {
    const ds = source();
    await ds.setCellColors({ id: "b", changes: [{ rowId: "r2", columnId: C.status, color: "green" }] });
    const handle = createDataSourceHandler(ds, { validateOutput: true });
    const res = unwrapWireResult(
      await handle("fetch", q({ filter: { columnId: C.status, operator: "colorIs", value: ["green"] }, colorRules: [rule] })),
    );
    expect(res.rows.map((r) => r.id)).toEqual(["r1", "r2", "r5"]);
  });
});

describe("createRemoteDataSource", () => {
  it("round-trips setCellColors through the handler", async () => {
    const handle = createDataSourceHandler(source(), { validateOutput: true });
    const remote = createRemoteDataSource(async (op, input) => json(unwrapWireResult(await handle(op, json(input)))));
    const res = await remote.setCellColors?.({ id: "b", changes: [{ rowId: "r1", columnId: C.name, color: "teal" }] });
    expect(res?.applied).toEqual([{ rowId: "r1", columnId: C.name, color: "teal" }]);
    const rows = await remote.fetch(q());
    expect(rows.rows.find((r) => r.id === "r1")?.colors).toEqual({ [C.name]: "teal" });
  });

  it("omits setCellColors when the server does not support it", () => {
    const transport = vi.fn();
    expect(typeof createRemoteDataSource(transport).setCellColors).toBe("function");
    expect(createRemoteDataSource(transport, { supports: { setCellColors: false } }).setCellColors).toBeUndefined();
  });
});
