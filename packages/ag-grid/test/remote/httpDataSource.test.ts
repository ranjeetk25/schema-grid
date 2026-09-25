import type { GridQuery } from "@ranjeetk25/schema-grid-core";
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import { createFixtureRows, createFixtureSchema, FIXTURE_COLUMN_IDS as C, FIXTURE_NOW } from "@ranjeetk25/schema-grid-core/testing";
import { createDataSourceHandler, RemoteDataSourceError } from "@ranjeetk25/schema-grid-core/wire";
import { describe, expect, it, vi } from "vitest";
import { createHttpDataSource, createRemoteDataSource } from "../../src/index";

const q = (over: Partial<GridQuery> = {}): GridQuery => ({ filter: null, sort: [], page: { offset: 0, limit: 50 }, ...over });

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch mock that serves the core handler the way the server adapters do. */
function serverFetch() {
  const ds = createInMemoryDataSource({ schema: createFixtureSchema(), rows: createFixtureRows(), now: () => new Date(FIXTURE_NOW) });
  const handle = createDataSourceHandler(ds);
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const op = String(url).split("/").pop() ?? "";
    const result = await handle(op, JSON.parse(String(init?.body)));
    return result.ok ? jsonResponse(200, { data: result.data }) : jsonResponse(result.status, { error: result.error });
  });
}

describe("createHttpDataSource", () => {
  it("POSTs JSON to baseUrl + /op with resolved headers", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { data: { rows: [] } }));
    const ds = createHttpDataSource({
      baseUrl: "https://api.example.com/grid/",
      fetch,
      headers: async () => ({ authorization: "Bearer t" }),
    });
    await ds.fetch(q());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/grid/fetch");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json", accept: "application/json", authorization: "Bearer t" });
    expect(JSON.parse(String(init.body))).toEqual(q());
  });

  it("uses a custom opPath and passes credentials through", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { data: [] }));
    const ds = createHttpDataSource({ baseUrl: "/api", fetch, opPath: (op) => `/grid?op=${op}`, credentials: "include" });
    await ds.lookup?.(C.programs, "x");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/grid?op=lookup");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ columnId: C.programs, search: "x" });
  });

  it("round-trips real operations against the core handler", async () => {
    const ds = createHttpDataSource({ baseUrl: "/grid", fetch: serverFetch() });
    const all = await ds.fetch(q({ includeTotal: true }));
    expect(all.total).toBe(5);
    const res = await ds.applyChanges({
      id: "b1",
      changes: [{ rowId: "r1", columnId: C.name, prev: null, next: "Renamed" }],
      baseVersions: { r1: 1 },
      source: "edit",
    });
    expect(res.applied).toHaveLength(1);
    await expect(ds.deleteRows(["r2"])).resolves.toBeUndefined();
    expect((await ds.fetch(q())).rows.map((r) => r.id)).toEqual(["r1", "r3", "r4", "r5"]);
  });

  it("maps a WireError body on non-2xx to RemoteDataSourceError with the HTTP status", async () => {
    const ds = createHttpDataSource({ baseUrl: "/grid", fetch: serverFetch() });
    const p = ds.fetch(q({ filter: { columnId: "col_missing", operator: "is", value: 1 } }));
    await expect(p).rejects.toBeInstanceOf(RemoteDataSourceError);
    await expect(p).rejects.toMatchObject({ code: "FILTER_INVALID", status: 400 });
  });

  it("maps non-2xx without a WireError body by status", async () => {
    const cases: [number, string][] = [
      [401, "UNAUTHENTICATED"],
      [403, "PERMISSION_DENIED"],
      [502, "HTTP_ERROR"],
    ];
    for (const [status, code] of cases) {
      const ds = createHttpDataSource({ baseUrl: "/g", fetch: async () => new Response("<html>nope</html>", { status }) });
      await expect(ds.fetch(q())).rejects.toMatchObject({ name: "RemoteDataSourceError", code, status });
    }
  });

  it("rejects 2xx bodies that are not a { data } envelope or fail validation", async () => {
    const notJson = createHttpDataSource({ baseUrl: "/g", fetch: async () => new Response("ok", { status: 200 }) });
    await expect(notJson.fetch(q())).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
    const raw = createHttpDataSource({ baseUrl: "/g", fetch: async () => jsonResponse(200, { rows: [] }) });
    await expect(raw.fetch(q())).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
    const bad = createHttpDataSource({ baseUrl: "/g", fetch: async () => jsonResponse(200, { data: { rows: 1 } }) });
    await expect(bad.fetch(q())).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
  });

  it("lets network failures propagate unchanged", async () => {
    const failure = new TypeError("Failed to fetch");
    const ds = createHttpDataSource({ baseUrl: "/g", fetch: async () => Promise.reject(failure) });
    await expect(ds.fetch(q())).rejects.toBe(failure);
  });

  it("honours `supports` and defaults to the global fetch at call time", async () => {
    const ds = createHttpDataSource({ baseUrl: "/g", supports: { getChanges: false } });
    expect(ds.getChanges).toBeUndefined();
    const global = vi.fn(async () => jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", global);
    try {
      await ds.getOptions?.(C.status);
      expect(global).toHaveBeenCalledWith("/g/getOptions", expect.objectContaining({ method: "POST" }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("re-exports createRemoteDataSource for custom transports (e.g. a tRPC client)", async () => {
    const mutate = vi.fn(async (_input: unknown) => ({ rows: [] }));
    const trpc = { grid: { fetch: { mutate } } };
    const ds = createRemoteDataSource((op, input) => trpc.grid[op as "fetch"].mutate(input));
    await ds.fetch(q());
    expect(mutate).toHaveBeenCalledWith(q());
  });
});
