/**
 * Both grids through the multi-grid endpoint (`/grid/:gridId/:op`) against
 * the docker-compose MySQL (`SCHEMA_GRID_MYSQL_IT=1`), with the SQL-view grid
 * over a plain `leads`-shaped table (`it_leads`, no `cells` JSON).
 */
import type {
  ChangeFeedEntry,
  ChangeResult,
  ColumnDef,
  DataSourceCapabilities,
  FilterNode,
  GridQuery,
  GridRow,
  GridSchema,
  QueryResult,
} from "@ranjeetk25/schema-grid-core";
import { FIXTURE_NOW, createFixtureSchema } from "@ranjeetk25/schema-grid-core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CreatedApp, createApp } from "../src/app";
import { DEFAULT_DATABASE_URL, type Database, connect, gridTables, rawQuery } from "../src/db";
import { LEADS_SEED_COUNT, leadSeed } from "../src/leads/table";
import { SchemaStore } from "../src/schema-store";

const TZ = "Asia/Kolkata";
const NOW = new Date(FIXTURE_NOW);
const NEXT_DAY = new Date(NOW.getTime() + 86_400_000).toISOString();
const SECTION_8: FilterNode = {
  op: "and",
  children: [
    { columnId: "paymentStatus", operator: "isNot", value: "paid" },
    { columnId: "callDate", operator: "isWithin", value: { relative: "yesterday" } },
  ],
};

type Headers = Record<string, string>;
type Wire<T> = { status: number; data: T; error?: { code: string; message: string; details?: unknown } };

/** Seed ids matching §8 at `now`: status is not paid (null counts) and the call was yesterday in IST. */
function expectedSection8(now: Date): string[] {
  const yesterday = new Date(now.getTime() - 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });
  const ids: string[] = [];
  for (let i = 1; i <= LEADS_SEED_COUNT; i++) {
    const lead = leadSeed(i, NOW, TZ);
    if (lead.paymentStatus !== "paid" && lead.callDate === yesterday) ids.push(String(i));
  }
  return ids;
}

describe.skipIf(process.env.SCHEMA_GRID_MYSQL_IT !== "1")("multi-grid endpoint over MySQL (JSON-cells + SQL view)", () => {
  let database: Database;
  let created: CreatedApp;

  /** A fresh app (= a restarted process): new registry, same MySQL tables. */
  const makeApp = () =>
    createApp({
      db: database.db,
      tables: gridTables({ rowsTable: "it_mg_grid_rows", changeLogTable: "it_mg_grid_change_log" }),
      gridId: "admissions",
      store: new SchemaStore(null, createFixtureSchema),
      tz: TZ,
      clock: FIXTURE_NOW,
      leads: { tableName: "it_leads", schemasTable: "it_grid_schemas", extensionTable: "it_grid_extension_cells" },
    });

  const op = async <T>(gridId: string, name: string, body: unknown, headers: Headers = {}): Promise<Wire<T>> => {
    const res = await created.app.request(`/grid/${gridId}/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { data?: T; error?: Wire<T>["error"] };
    return { status: res.status, data: json.data as T, ...(json.error ? { error: json.error } : {}) };
  };
  const fetchLeads = (query: Partial<GridQuery>, headers: Headers = {}) =>
    op<QueryResult<GridRow>>("leads", "fetch", { filter: null, sort: [], page: { offset: 0, limit: 2000 }, ...query }, headers);
  const leadRow = async (id: string) =>
    (await fetchLeads({ filter: { columnId: "email", operator: "is", value: `lead${id}@example.com` } })).data.rows[0] as GridRow;

  beforeAll(async () => {
    database = connect(process.env.DATABASE_URL || DEFAULT_DATABASE_URL);
    created = makeApp();
    expect((await created.app.request("/__reset", { method: "POST" })).status).toBe(200);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("seeds 1,200 rows into a plain table with no cells JSON", async () => {
    const columns = await rawQuery<{ name: string }>(
      database.db,
      "SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'it_leads' ORDER BY ORDINAL_POSITION",
    );
    expect(columns.map((c) => c.name)).toEqual([
      "id",
      "name",
      "email",
      "payment_status",
      "call_date",
      "ai_verified",
      "updated_at",
    ]);
    const res = await fetchLeads({ page: { offset: 0, limit: 1 }, includeTotal: true });
    expect(res.data.total).toBe(LEADS_SEED_COUNT);
  });

  it("GET /grid lists both grids; each serves its own schema", async () => {
    expect(await (await created.app.request("/grid")).json()).toEqual({ data: [{ id: "admissions" }, { id: "leads" }] });
    const leads = await op<GridSchema>("leads", "getSchema", null);
    expect(leads.data.columns.map((c) => c.key)).toEqual(["name", "email", "paymentStatus", "callDate", "aiVerified"]);
    // v0.3: the schema has exactly one route (the getSchema op); the old GET alias is a 405.
    expect((await created.app.request("/grid/leads/schema")).status).toBe(405);
    const admissions = await op<GridSchema>("admissions", "getSchema", null);
    expect(admissions.data.id).toBe("admissions");
  });

  it("§8 on the JSON-cells grid via /grid/admissions/fetch → r2 + r3", async () => {
    const res = await op<QueryResult<GridRow>>("admissions", "fetch", {
      filter: {
        op: "and",
        children: [
          { columnId: "col_status", operator: "isNot", value: "paid" },
          { columnId: "col_callDate", operator: "isWithin", value: { relative: "yesterday" } },
        ],
      },
      sort: [],
      page: { offset: 0, limit: 100 },
    });
    expect(res.data.rows.map((r) => r.id)).toEqual(["r2", "r3"]);
  });

  it("§8 on the leads table: isNot Paid (NULL included) AND call date yesterday (IST)", async () => {
    const expected = expectedSection8(NOW);
    expect(expected.length).toBeGreaterThan(100);
    const res = await fetchLeads({ filter: SECTION_8, sort: [{ columnId: "name", dir: "asc" }] });
    expect(res.status).toBe(200);
    expect(res.data.rows.map((r) => r.id)).toEqual(expected);
    // NULL payment_status rows are included (empty cells are omitted on the wire).
    expect(res.data.rows.some((r) => (r.cells.paymentStatus ?? null) === null)).toBe(true);
  });

  it("§8 reopened the next day (x-now +24h) moves the window with the clock", async () => {
    const next = await fetchLeads({ filter: SECTION_8, sort: [{ columnId: "name", dir: "asc" }] }, { "x-now": NEXT_DAY });
    expect(next.data.rows.map((r) => r.id)).toEqual(expectedSection8(new Date(NEXT_DAY)));
    expect(next.data.rows.map((r) => r.id)).not.toEqual(expectedSection8(NOW));
  });

  it("sort, search and cursor paging (200 per page) reach all 1,200 rows", async () => {
    const sorted = await fetchLeads({ sort: [{ columnId: "name", dir: "desc" }], page: { offset: 0, limit: 3 } });
    expect(sorted.data.rows.map((r) => r.cells.name)).toEqual(["Lead 1200", "Lead 1199", "Lead 1198"]);
    const search = await fetchLeads({ search: "lead1199@" });
    expect(search.data.rows.map((r) => r.id)).toEqual(["1199"]);
    const ids = new Set<string>();
    let cursor = "";
    for (let pages = 0; pages < 20; pages++) {
      const page = await fetchLeads({ page: { cursor, limit: 200 } });
      expect(page.status).toBe(200);
      expect(page.data.rows.length).toBeLessThanOrEqual(200);
      for (const r of page.data.rows) ids.add(r.id);
      if (!page.data.nextCursor) break;
      cursor = page.data.nextCursor;
    }
    expect(ids.size).toBe(LEADS_SEED_COUNT);
  });

  it("capabilities: maxPageSize 200 (a bigger page is clamped, the cursor continues), updates-only feed, cells writable", async () => {
    const caps = await op<DataSourceCapabilities>("leads", "capabilities", null);
    expect(caps.status).toBe(200);
    expect(caps.data).toMatchObject({
      maxPageSize: 200,
      changeFeed: "updates-only",
      write: { cells: true, createRows: false, deleteRows: false },
    });
    const big = await fetchLeads({ page: { cursor: "", limit: 500 } });
    expect(big.data.rows).toHaveLength(200);
    expect(big.data.nextCursor).toBeTruthy();
  });

  it("capabilities.schema (v0.3): a counsellor sees write:false, an admin write:true (leads has a schema store)", async () => {
    const counsellor = await op<DataSourceCapabilities>("leads", "capabilities", null, { "x-roles": "counsellor" });
    expect(counsellor.data.schema).toEqual({ read: true, write: false, reason: "forbidden" });
    const admin = await op<DataSourceCapabilities>("leads", "capabilities", null, { "x-roles": "admin" });
    expect(admin.data.schema).toEqual({ read: true, write: true });
  });

  it("sort on the unsortable aiVerified column is rejected (400 UNSORTABLE_COLUMN)", async () => {
    const res = await fetchLeads({ sort: [{ columnId: "aiVerified", dir: "asc" }] });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe("UNSORTABLE_COLUMN");
  });

  it("GET /export?grid=leads streams all 1,200 rows as CSV (pages of at most 200)", async () => {
    const res = await created.app.request("/export?grid=leads&format=csv");
    expect(res.status).toBe(200);
    const lines = (await res.text()).replace(/^﻿/, "").split("\r\n").filter(Boolean);
    expect(lines[0]?.split(",")).toEqual(["Name", "Email", "Payment status", "Call date", "AI verified"]);
    expect(lines).toHaveLength(LEADS_SEED_COUNT + 1);
  });

  it("an edit writes the real table; a stale base version conflicts; ai_verified is read-only", async () => {
    const before = await leadRow("7");
    const edit = await op<ChangeResult>("leads", "applyChanges", {
      id: "b1",
      source: "edit",
      baseVersions: { "7": before.version },
      changes: [
        { rowId: "7", columnId: "name", prev: before.cells.name, next: "Renamed lead" },
        { rowId: "7", columnId: "aiVerified", prev: before.cells.aiVerified, next: !before.cells.aiVerified },
      ],
    });
    expect(edit.status).toBe(200);
    expect(edit.data.applied.map((c) => c.columnId)).toEqual(["name"]);
    expect(edit.data.errors).toEqual([{ rowId: "7", columnId: "aiVerified", message: "Column is read-only" }]);
    const [dbRow] = await rawQuery<{ name: string; ai_verified: number }>(
      database.db,
      "SELECT name, ai_verified FROM it_leads WHERE id = 7",
    );
    expect(dbRow?.name).toBe("Renamed lead");
    expect(Boolean(dbRow?.ai_verified)).toBe(before.cells.aiVerified);
    const after = await leadRow("7");
    expect(after.version).not.toBe(before.version);
    expect(edit.data.versions?.["7"]).toBe(after.version);

    const stale = await op<ChangeResult>("leads", "applyChanges", {
      id: "b2",
      source: "edit",
      baseVersions: { "7": before.version },
      changes: [{ rowId: "7", columnId: "name", prev: "x", next: "Lost update" }],
    });
    expect(stale.data.applied).toEqual([]);
    expect(stale.data.conflicts).toMatchObject([{ rowId: "7", columnId: "name", serverValue: "Renamed lead" }]);
  });

  it("updateSchema: 403 for a counsellor, persisted + version-bumped for an admin, 409 when stale", async () => {
    const schema = (await op<GridSchema>("leads", "getSchema", null)).data;
    const renamed = { ...schema, columns: schema.columns.map((c) => (c.key === "name" ? { ...c, label: "Lead name" } : c)) };
    const denied = await op<GridSchema>("leads", "updateSchema", renamed, { "x-roles": "counsellor" });
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe("PERMISSION_DENIED");
    const saved = await op<GridSchema>("leads", "updateSchema", renamed);
    expect(saved.status).toBe(200);
    expect(saved.data.schemaVersion).toBe(schema.schemaVersion + 1);
    expect((await op<GridSchema>("leads", "getSchema", null)).data.columns[0]?.label).toBe("Lead name");
    const stale = await op<GridSchema>("leads", "updateSchema", renamed);
    expect(stale.status).toBe(409);
    expect(stale.error?.code).toBe("SCHEMA_CONFLICT");
  });

  it("updated_at feed: an edit after the cursor comes back; deletes are never reported", async () => {
    const start = await op<ChangeFeedEntry<GridRow>>("leads", "getChanges", { since: "" });
    expect(start.status).toBe(200);
    expect(start.data.rows).toEqual([]);
    await new Promise((r) => setTimeout(r, 5)); // TIMESTAMP(3): step past the cursor's millisecond
    const before = await leadRow("9");
    const edit = await op<ChangeResult>("leads", "applyChanges", {
      id: "feed-1",
      source: "edit",
      baseVersions: { "9": before.version },
      changes: [{ rowId: "9", columnId: "name", prev: before.cells.name, next: "Fed lead" }],
    });
    expect(edit.data.applied).toHaveLength(1);
    const feed = await op<ChangeFeedEntry<GridRow>>("leads", "getChanges", { since: start.data.cursor });
    expect(feed.data.rows.map((r) => [r.id, r.cells.name])).toEqual([["9", "Fed lead"]]);
    expect(feed.data.deletedRowIds).toEqual([]);
    expect(feed.data.cursor).not.toBe(start.data.cursor);
    const again = await op<ChangeFeedEntry<GridRow>>("leads", "getChanges", { since: feed.data.cursor });
    expect(again.data.rows).toEqual([]);
  });

  it("an added (extension) column: values in the extension table, filter + sort work, and it survives a restart", async () => {
    const schema = (await op<GridSchema>("leads", "getSchema", null)).data;
    const notes: ColumnDef = {
      id: "notes",
      key: "notes",
      label: "Notes",
      type: "text",
      config: {},
      order: schema.columns.length,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    };
    const saved = await op<GridSchema>("leads", "updateSchema", { ...schema, columns: [...schema.columns, notes] });
    expect(saved.status).toBe(200);

    const edits: Array<[string, string]> = [["5", "beta call back"], ["6", "alpha call back"], ["8", "zeta"]];
    for (const [id, text] of edits) {
      const row = await leadRow(id);
      expect(row.cells.notes).toBeUndefined();
      const res = await op<ChangeResult>("leads", "applyChanges", {
        id: `notes-${id}`,
        source: "edit",
        baseVersions: { [id]: row.version },
        changes: [{ rowId: id, columnId: "notes", prev: null, next: text }],
      });
      expect(res.data.errors).toEqual([]);
      expect(res.data.applied).toHaveLength(1);
    }
    const stored = await rawQuery<{ row_id: string; cells: unknown }>(
      database.db,
      "SELECT row_id, cells FROM it_grid_extension_cells WHERE grid_id = 'leads' ORDER BY row_id",
    );
    expect(stored.map((r) => r.row_id)).toEqual(["5", "6", "8"]);
    const [base] = await rawQuery<{ n: number }>(
      database.db,
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'it_leads' AND COLUMN_NAME = 'notes'",
    );
    expect(Number(base?.n)).toBe(0); // the existing table is never altered

    // "Restart": a new app / registry reads the schema back from the Drizzle schema store.
    created = makeApp();
    const reloaded = (await op<GridSchema>("leads", "getSchema", null)).data;
    expect(reloaded.columns.map((c) => c.key)).toContain("notes");
    expect(reloaded.schemaVersion).toBe(saved.data.schemaVersion);

    const filtered = await fetchLeads({
      filter: { columnId: "notes", operator: "contains", value: "call back" },
      sort: [{ columnId: "notes", dir: "asc" }],
    });
    expect(filtered.status).toBe(200);
    expect(filtered.data.rows.map((r) => [r.id, r.cells.notes])).toEqual([
      ["6", "alpha call back"],
      ["5", "beta call back"],
    ]);
    const sorted = await fetchLeads({ sort: [{ columnId: "notes", dir: "desc" }], page: { offset: 0, limit: 3 } });
    expect(sorted.data.rows.map((r) => r.id)).toEqual(["8", "5", "6"]);
  });
});
