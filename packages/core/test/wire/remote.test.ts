import { describe, expect, it, vi } from "vitest";
import type { FilterNode } from "../../src/filter/types";
import { createInMemoryDataSource } from "../../src/memory/data-source";
import type { DataSource } from "../../src/datasource/types";
import type { GridQuery } from "../../src/query/types";
import type { ChangeBatch, GridRow } from "../../src/rows/types";
import { createFixtureLinkTargets, createFixtureRows } from "../../src/testing/rows";
import { createFixtureSchema, FIXTURE_COLUMN_IDS as C, FIXTURE_NOW, FIXTURE_USERS } from "../../src/testing/schema";
import { RemoteDataSourceError, toWireError } from "../../src/wire/errors";
import { createDataSourceHandler, unwrapWireResult } from "../../src/wire/handler";
import { createRemoteDataSource } from "../../src/wire/remote";
import { DEFAULT_CAPABILITIES } from "../../src/datasource/capabilities";

const q = (over: Partial<GridQuery> = {}): GridQuery => ({ filter: null, sort: [], page: { offset: 0, limit: 100 }, ...over });
const spec8: FilterNode = {
  op: "and",
  children: [
    { columnId: C.status, operator: "isNot", value: "paid" },
    { columnId: C.callDate, operator: "isWithin", value: { relative: "yesterday" } },
  ],
};

function source(user: keyof typeof FIXTURE_USERS = "admin") {
  return createInMemoryDataSource({
    schema: createFixtureSchema(),
    rows: createFixtureRows(),
    now: () => new Date(FIXTURE_NOW),
    user: { id: FIXTURE_USERS[user].id, roles: [...FIXTURE_USERS[user].roles] },
    linkTargets: createFixtureLinkTargets(),
  });
}

const json = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

/** direct = the data source itself; remote = the same data source behind handler -> JSON -> remote. */
function pair(user: keyof typeof FIXTURE_USERS = "admin") {
  const direct = source(user);
  const handle = createDataSourceHandler(source(user), { validateOutput: true });
  const remote = createRemoteDataSource(async (op, input) => json(unwrapWireResult(await handle(op, json(input)))));
  return { direct, remote };
}

type Step = (ds: DataSource<GridRow>) => Promise<unknown>;

async function outcome(step: Step, ds: DataSource<GridRow>): Promise<unknown> {
  try {
    return { ok: json(await step(ds)) };
  } catch (err) {
    return { error: err instanceof RemoteDataSourceError ? err.code : toWireError(err).code };
  }
}

const batch = (id: string, rowId: string, columnId: string, next: unknown, base: number): ChangeBatch => ({
  id,
  changes: [{ rowId, columnId, prev: null, next }],
  baseVersions: { [rowId]: base },
  source: "edit",
});

describe("handler -> remote round trip matches the data source", () => {
  const steps: [string, Step][] = [
    ["fetch all", (ds) => ds.fetch(q({ includeTotal: true }))],
    ["fetch spec §8 filter", (ds) => ds.fetch(q({ filter: spec8 }))],
    ["fetch sorted + searched", (ds) => ds.fetch(q({ sort: [{ columnId: C.paid, dir: "desc" }], search: "a" }))],
    ["fetch grouped", (ds) => ds.fetch(q({ groupBy: [{ columnId: C.status, aggregations: [{ columnId: C.paid, agg: "sum" }] }] }))],
    [
      "fetch cursor pages",
      async (ds) => {
        const first = await ds.fetch(q({ page: { offset: 0, limit: 2 } }));
        const cursor = (await ds.fetch({ ...q(), page: { cursor: first.nextCursor ?? "", limit: 2 } })).rows;
        return { first, cursor };
      },
    ],
    ["applyChanges applies", (ds) => ds.applyChanges(batch("b1", "r1", C.name, "Renamed", 1))],
    ["applyChanges version conflict", (ds) => ds.applyChanges(batch("b2", "r1", C.name, "Stale", 1))],
    ["createRows", (ds) => ds.createRows([{ cells: { name: "New" } }, { id: "custom", cells: { paid: 3 } }])],
    ["createRows duplicate id", (ds) => ds.createRows([{ id: "r2" }])],
    ["deleteRows", (ds) => ds.deleteRows(["r3"])],
    ["getChanges", async (ds) => ds.getChanges?.("0")],
    ["getChanges bad cursor", async (ds) => ds.getChanges?.("999999")],
    ["getOptions", async (ds) => ds.getOptions?.(C.status, "pa")],
    ["getOptions no search", async (ds) => ds.getOptions?.(C.status)],
    ["createOption", async (ds) => ds.createOption?.(C.stage, "Enrolled")],
    ["createOption not allowed", async (ds) => ds.createOption?.(C.status, "Nope")],
    ["lookup", async (ds) => ds.lookup?.(C.programs, "data")],
    ["lookup non-link", async (ds) => ds.lookup?.(C.name, "x")],
    ["capabilities", async (ds) => ds.capabilities?.()],
    ["fetch after writes", (ds) => ds.fetch(q({ includeTotal: true }))],
  ];

  it("produces identical results and error codes for every operation, in sequence", async () => {
    const { direct, remote } = pair();
    for (const [label, step] of steps) {
      const expected = await outcome(step, direct);
      const actual = await outcome(step, remote);
      expect(actual, label).toEqual(expected);
    }
  });

  it("round-trips the spec §8 filter to rows r2 and r3 and reports a conflict", async () => {
    const { remote } = pair();
    expect((await remote.fetch(q({ filter: spec8 }))).rows.map((r) => r.id)).toEqual(["r2", "r3"]);
    const first = await remote.applyChanges(batch("b1", "r1", C.name, "Renamed", 1));
    // `versions` must survive the wire so remote clients do not fall back to the "+1" guess.
    expect(first.versions).toEqual({ r1: 2 });
    const stale = await remote.applyChanges(batch("b2", "r1", C.name, "Stale", 1));
    expect(stale.applied).toEqual([]);
    expect(stale.conflicts).toEqual([
      expect.objectContaining({ rowId: "r1", columnId: C.name, serverValue: "Renamed", serverVersion: 2 }),
    ]);
  });

  it("surfaces permission-aware errors with codes and statuses", async () => {
    const { remote } = pair("counsellor");
    const hidden = remote.fetch(q({ filter: { columnId: C.notes, operator: "contains", value: "vip" } }));
    await expect(hidden).rejects.toBeInstanceOf(RemoteDataSourceError);
    await expect(hidden).rejects.toMatchObject({ code: "FILTER_INVALID", status: 400 });
    await expect(remote.createOption?.(C.fee, "x")).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    await expect(remote.fetch({ ...q(), page: { offset: -1, limit: 1 } })).rejects.toMatchObject({
      code: "INPUT_INVALID",
      status: 400,
    });
  });
});

describe("createRemoteDataSource", () => {
  it("exposes optional operations according to `supports` (default all)", () => {
    const transport = vi.fn();
    const all = createRemoteDataSource(transport);
    expect(typeof all.getChanges).toBe("function");
    expect(typeof all.lookup).toBe("function");
    const some = createRemoteDataSource(transport, { supports: { lookup: false, getChanges: false } });
    expect(some.lookup).toBeUndefined();
    expect(some.getChanges).toBeUndefined();
    expect(typeof some.getOptions).toBe("function");
    expect(typeof some.createOption).toBe("function");
  });

  it("sends each operation's wire input", async () => {
    const transport = vi.fn(async (op: string) => {
      if (op === "fetch") return { rows: [] };
      if (op === "applyChanges") return { applied: [], conflicts: [], errors: [] };
      if (op === "getChanges") return { cursor: "1", rows: [], deletedRowIds: [], schemaVersion: 1 };
      if (op === "createOption") return { id: "o", label: "L" };
      if (op === "deleteRows") return undefined;
      if (op === "capabilities") return { ...DEFAULT_CAPABILITIES };
      return [];
    });
    const ds = createRemoteDataSource(transport);
    const b = batch("b", "r1", C.name, "x", 1);
    await ds.fetch(q());
    await ds.applyChanges(b);
    await ds.createRows([{ cells: { a: 1 } }]);
    expect(await ds.deleteRows(["r1"])).toBeUndefined();
    await ds.getChanges?.("5");
    await ds.getOptions?.("c");
    await ds.getOptions?.("c", "s");
    await ds.createOption?.("c", "L");
    await ds.lookup?.("c", "s");
    await ds.capabilities?.();
    expect(transport.mock.calls).toEqual([
      ["fetch", q()],
      ["applyChanges", b],
      ["createRows", { partials: [{ cells: { a: 1 } }] }],
      ["deleteRows", { ids: ["r1"] }],
      ["getChanges", { since: "5" }],
      ["getOptions", { columnId: "c" }],
      ["getOptions", { columnId: "c", search: "s" }],
      ["createOption", { columnId: "c", label: "L" }],
      ["lookup", { columnId: "c", search: "s" }],
      ["capabilities", null],
    ]);
  });

  it("rethrows thrown WireErrors as RemoteDataSourceError", async () => {
    const ds = createRemoteDataSource(async () => {
      throw { code: "FORMULA_ROW_CAP", message: "too many", details: { rowCap: 5 } };
    });
    const p = ds.fetch(q());
    await expect(p).rejects.toBeInstanceOf(RemoteDataSourceError);
    await expect(p).rejects.toMatchObject({ code: "FORMULA_ROW_CAP", status: 413, details: { rowCap: 5 } });
  });

  it("rethrows RemoteDataSourceError and transport failures untouched", async () => {
    const remoteErr = new RemoteDataSourceError({ code: "X", message: "m" }, 502);
    await expect(createRemoteDataSource(async () => Promise.reject(remoteErr)).fetch(q())).rejects.toBe(remoteErr);
    const network = Object.assign(new TypeError("fetch failed"), { code: "ECONNREFUSED" });
    await expect(createRemoteDataSource(async () => Promise.reject(network)).fetch(q())).rejects.toBe(network);
  });

  it("rejects malformed responses with OUTPUT_INVALID unless validation is off", async () => {
    const ds = createRemoteDataSource(async () => ({ rows: "nope" }));
    await expect(ds.fetch(q())).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
    const loose = createRemoteDataSource(async () => ({ rows: "nope" }), { validateOutput: false });
    await expect(loose.fetch(q())).resolves.toEqual({ rows: "nope" });
  });
});

describe("createRemoteDataSource capabilities", () => {
  it("passes the server's capabilities through (validated)", async () => {
    const ds = createRemoteDataSource(async () => ({ ...DEFAULT_CAPABILITIES, maxPageSize: 200, changeFeed: "updates-only" }));
    expect(await ds.capabilities?.()).toMatchObject({ maxPageSize: 200, changeFeed: "updates-only" });
    const bad = createRemoteDataSource(async () => ({ maxPageSize: "lots" }));
    await expect(bad.capabilities?.()).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
  });

  it("can be turned off for servers that predate the op", () => {
    const ds = createRemoteDataSource(vi.fn(), { supports: { capabilities: false } });
    expect(ds.capabilities).toBeUndefined();
  });
});
