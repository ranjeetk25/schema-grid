import type { GridQuery, GridSchema } from "@ranjeetk25/schema-grid-core";
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import { createFixtureRows, createFixtureSchema, FIXTURE_NOW } from "@ranjeetk25/schema-grid-core/testing";
import { createDataSourceHandler, RemoteDataSourceError } from "@ranjeetk25/schema-grid-core/wire";
import { describe, expect, it, vi } from "vitest";
import { createGridClient } from "../../src/index";

const q = (over: Partial<GridQuery> = {}): GridQuery => ({ filter: null, sort: [], page: { offset: 0, limit: 50 }, ...over });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake multi-grid server: `POST {base}/:gridId/:op` like `toFetchHandler`. */
function fakeServer() {
  let schema: GridSchema = createFixtureSchema();
  const handle = createDataSourceHandler(
    createInMemoryDataSource({ schema, rows: createFixtureRows(), now: () => new Date(FIXTURE_NOW) }),
  );
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const [gridId, op] = String(url).split("/").slice(-2);
    if (gridId !== "admissions") return json(404, { error: { code: "UNKNOWN_GRID", message: "nope" } });
    const input = JSON.parse(String(init?.body)) as unknown;
    if (op === "getSchema") return json(200, { data: schema });
    if (op === "updateSchema") {
      const next = input as GridSchema;
      if (next.schemaVersion !== schema.schemaVersion) {
        return json(409, { error: { code: "SCHEMA_CONFLICT", message: "stale", details: { currentVersion: 1 } } });
      }
      schema = { ...next, schemaVersion: schema.schemaVersion + 1 };
      return json(200, { data: schema });
    }
    if (op === "capabilities") return json(200, { data: { maxPageSize: 200 } });
    const result = await handle(op ?? "", input);
    return result.ok ? json(200, { data: result.data }) : json(result.status, { error: result.error });
  });
  return { fetch };
}

describe("createGridClient", () => {
  it("builds a data source on {baseUrl}/{gridId}/{op} with the given headers", async () => {
    const { fetch } = fakeServer();
    const client = createGridClient({
      baseUrl: "https://api.example.com/grid/",
      gridId: "admissions",
      fetch,
      headers: () => ({ "x-user": "u1" }),
    });
    const res = await client.dataSource.fetch(q());
    expect(res.rows).toHaveLength(5);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/grid/admissions/fetch");
    expect(init.headers).toMatchObject({ "x-user": "u1", "content-type": "application/json" });
  });

  it("URL-encodes the grid id", async () => {
    const { fetch } = fakeServer();
    await createGridClient({ baseUrl: "/grid", gridId: "a b", fetch })
      .getSchema()
      .catch(() => undefined);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("/grid/a%20b/getSchema");
  });

  it("getSchema POSTs null and validates the answer; updateSchema returns the bumped schema", async () => {
    const { fetch } = fakeServer();
    const client = createGridClient({ baseUrl: "/grid", gridId: "admissions", fetch });
    const schema = await client.getSchema();
    expect(schema).toEqual(createFixtureSchema());
    expect(JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body))).toBeNull();
    const renamed = { ...schema, columns: schema.columns.map((c, i) => (i === 0 ? { ...c, label: "X" } : c)) };
    const saved = await client.updateSchema(renamed);
    expect(saved.schemaVersion).toBe(schema.schemaVersion + 1);
    expect(saved.columns[0]?.label).toBe("X");
  });

  it("surfaces wire errors as RemoteDataSourceError (conflict, unknown grid)", async () => {
    const { fetch } = fakeServer();
    const client = createGridClient({ baseUrl: "/grid", gridId: "admissions", fetch });
    const stale = { ...createFixtureSchema(), schemaVersion: 99 };
    await expect(client.updateSchema(stale)).rejects.toMatchObject({ code: "SCHEMA_CONFLICT", status: 409 });
    const other = createGridClient({ baseUrl: "/grid", gridId: "nope", fetch });
    const err = await other.getSchema().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteDataSourceError);
    expect(err).toMatchObject({ code: "UNKNOWN_GRID", status: 404 });
  });

  it("rejects a malformed getSchema answer with OUTPUT_INVALID", async () => {
    const fetch = vi.fn(async () => json(200, { data: { id: 1 } }));
    const client = createGridClient({ baseUrl: "/grid", gridId: "admissions", fetch });
    await expect(client.getSchema()).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
  });

  it("capabilities() calls the capabilities op", async () => {
    const { fetch } = fakeServer();
    const client = createGridClient({ baseUrl: "/grid", gridId: "admissions", fetch });
    expect(await client.capabilities()).toEqual({ maxPageSize: 200 });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("/grid/admissions/capabilities");
  });
});
