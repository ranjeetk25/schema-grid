/**
 * Reference suite for `createSqlViewDataSource` (spec v0.2 §C4/§C7/§C8): the
 * §8 filter, parity with core's in-memory source, search, keyset paging,
 * grouping, optimistic writes, extension columns and the `updated_at` feed —
 * all over a plain `leads` table with NO `cells` JSON.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { affectedRowsOf } from "../../src/changes/db";
import {
  type ColumnDef,
  type DataSource,
  type FilterNode,
  type GridQuery,
  type GridRow,
  type GridSchema,
  type SortSpec,
  createRolePermissionResolver,
} from "../../src/internal/core";
import { createExtensionCellStore } from "../../src/sqlview/extension-store";
import {
  type SqlViewDataSource,
  type SqlViewDataSourceOptions,
  type SqlViewWriteHooks,
  createSqlViewDataSource,
} from "../../src/sqlview/create-sql-view-data-source";
import {
  FIXTURE_COLUMN_IDS,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  SECTION_8_EXPECTED_IDS,
  SECTION_8_FILTER,
  SECTION_8_NEXT_DAY_EXPECTED_IDS,
  createServerFixtureRows,
  serverFixtureSchema,
} from "../fixtures/admissions";
import {
  IT_EXTENSION_TABLE,
  type StartedMysql,
  describeMysql,
  leadSeedFromFixture,
  leadsTable,
  setupLeadsTable,
  startMysql,
} from "./mysql";
import { referenceGroups, referenceIds } from "./reference";

const NOW = new Date(FIXTURE_NOW);
const TZ = FIXTURE_TIME_ZONE;
const col = FIXTURE_COLUMN_IDS;
const KEYS = ["name", "email", "status", "callDate", "isActive", "fee"] as const;
const leads = leadsTable;

const byKey = new Map(serverFixtureSchema.columns.map((c) => [c.key, c]));
function fixtureColumn(key: string): ColumnDef {
  const c = byKey.get(key);
  if (!c) throw new Error(`fixture has no column ${key}`);
  return key === "isActive" ? ({ ...c, settable: false } as ColumnDef) : c;
}

const T = "2026-09-01T00:00:00.000Z";
const noteColumn: ColumnDef = { id: "col_note", key: "note", label: "Note", type: "text", config: {}, order: 20, createdAt: T, updatedAt: T };
const scoreColumn: ColumnDef = { id: "col_score", key: "score", label: "Score", type: "number", config: {}, order: 21, createdAt: T, updatedAt: T };

const leadsSchema: GridSchema = { id: "leads", schemaVersion: 1, columns: KEYS.map(fixtureColumn) };
const extSchema: GridSchema = { ...leadsSchema, columns: [...leadsSchema.columns, noteColumn, scoreColumn] };

/** Fixture r1..r7 restricted to the leads keys, ids "1".."7" (the in-memory reference). */
const fixtureRows = createServerFixtureRows();
const referenceRows: GridRow[] = fixtureRows.map((r) => ({
  id: r.id.replace(/^r/, ""),
  version: 1,
  updatedAt: T,
  cells: Object.fromEntries(KEYS.filter((k) => r.cells[k] !== undefined).map((k) => [k, r.cells[k]])),
}));
const mapId = (ids: string[]) => ids.map((id) => id.replace(/^r/, ""));

// updated_at: rows 1..7 at distinct instants, except 3/4 and 6/7 which tie (tiebreak by id).
const BASE_TS = Date.parse("2026-09-20T00:00:00.000Z");
const SEED_TS = [0, 1, 2, 2, 3, 4, 4].map((n) => new Date(BASE_TS + n * 1000));
const seeds = fixtureRows.map((r, i) => leadSeedFromFixture(r, SEED_TS[i] as Date));

const DB_COLUMN: Record<string, keyof typeof leads.$inferInsert> = {
  name: "name",
  email: "email",
  status: "paymentStatus",
  callDate: "callDate",
  fee: "fee",
};

describeMysql("SQL view over a plain table (MySQL 8.4)", () => {
  let mysql: StartedMysql;

  const hooks = (): SqlViewWriteHooks => ({
    async update(ctx, { rowId, changes, baseVersion }) {
      const set: Record<string, unknown> = { version: sql`${leads.version} + 1`, updatedAt: sql`NOW(3)` };
      for (const c of changes) {
        const key = ctx.schema.columns.find((x) => x.id === c.columnId)?.key ?? "";
        const field = DB_COLUMN[key];
        if (!field) throw new Error(`unmapped ${key}`);
        set[field] = c.next === null ? null : key === "fee" ? String(c.next) : c.next;
      }
      const res = await ctx.db
        .update(leads)
        .set(set as never)
        .where(and(eq(leads.id, Number(rowId)), eq(leads.version, baseVersion)));
      if (affectedRowsOf(res) === 0) {
        const first = changes[0];
        return {
          conflict: { rowId, columnId: first?.columnId ?? "", serverValue: null, serverVersion: baseVersion, updatedAt: T },
        };
      }
      return { applied: changes, version: baseVersion + 1 };
    },
    async create(ctx, partials) {
      const top = (await ctx.db.select({ maxId: sql<number>`COALESCE(MAX(${leads.id}), 0)` }).from(leads)) as {
        maxId: number;
      }[];
      let next = Number(top[0]?.maxId ?? 0);
      const values = partials.map((p) => {
        const cells = (p.cells ?? {}) as Record<string, unknown>;
        next += 1;
        return {
          id: next,
          name: (cells.name as string | undefined) ?? null,
          email: (cells.email as string | undefined) ?? null,
          paymentStatus: (cells.status as "paid" | "pending" | "partial" | undefined) ?? null,
          callDate: (cells.callDate as string | undefined) ?? null,
          fee: cells.fee === undefined || cells.fee === null ? null : String(cells.fee),
          updatedAt: sql`NOW(3)` as unknown as Date,
        };
      });
      await ctx.db.insert(leads).values(values);
      return values.map((v) => ({ id: String(v.id) }));
    },
    async delete(ctx, ids) {
      await ctx.db.delete(leads).where(inArray(leads.id, ids.map(Number)));
    },
  });

  const make = (extra: Partial<SqlViewDataSourceOptions> = {}, now: Date = NOW): SqlViewDataSource =>
    createSqlViewDataSource({
      db: mysql.db,
      schema: leadsSchema,
      resolver: createRolePermissionResolver(),
      user: { id: "u1", roles: ["admin"] },
      tz: TZ,
      now: () => now,
      baseQuery: (ctx) => ctx.db.select().from(leads),
      columns: {
        name: { expr: leads.name },
        email: { expr: leads.email },
        status: { expr: leads.paymentStatus },
        callDate: { expr: leads.callDate },
        isActive: { expr: leads.aiVerified },
        fee: { expr: leads.fee },
      },
      rowId: leads.id,
      version: leads.version,
      updatedAt: leads.updatedAt,
      write: hooks(),
      ...extra,
    });
  const withExt = (extra: Partial<SqlViewDataSourceOptions> = {}) =>
    make({ schema: extSchema, extension: createExtensionCellStore({ db: mysql.db, table: IT_EXTENSION_TABLE }), ...extra });

  const ids = async (source: DataSource<GridRow>, filter: FilterNode | null, sort: SortSpec[] = []) =>
    (await source.fetch({ filter, sort, page: { offset: 0, limit: 1000 } })).rows.map((r) => r.id);
  const reference = (filter: FilterNode | null, sort: SortSpec[] = [], rows = referenceRows) =>
    referenceIds(leadsSchema, rows, { filter, sort }, { now: NOW, tz: TZ, userId: "u1" });
  const walk = async (source: DataSource<GridRow>, query: Omit<GridQuery, "page">, limit: number) => {
    const seen: string[] = [];
    let page: GridQuery["page"] = { cursor: "", limit };
    for (let i = 0; i < 50; i++) {
      const res = await source.fetch({ ...query, page });
      seen.push(...res.rows.map((r) => r.id));
      if (!res.nextCursor) break;
      page = { cursor: res.nextCursor, limit };
    }
    return seen;
  };
  const row = async (source: DataSource<GridRow>, id: string) =>
    (await source.fetch({ filter: null, sort: [], page: { offset: 0, limit: 1000 } })).rows.find((r) => r.id === id);

  beforeAll(async () => {
    mysql = await startMysql();
  }, 180_000);
  beforeEach(async () => {
    await setupLeadsTable(mysql.db, seeds);
  });
  afterAll(async () => {
    await mysql?.stop();
  });

  it("§8: isNot Paid AND callDate within yesterday (IST) — and the view reopened the next day", async () => {
    expect(await ids(make(), SECTION_8_FILTER)).toEqual(mapId(SECTION_8_EXPECTED_IDS));
    const nextDay = new Date(NOW.getTime() + 86_400_000);
    expect(await ids(make({}, nextDay), SECTION_8_FILTER)).toEqual(mapId(SECTION_8_NEXT_DAY_EXPECTED_IDS));
  });

  it("§8 over a raw SQL base query", async () => {
    const source = make({ baseQuery: () => sql`SELECT * FROM leads` });
    expect(await ids(source, SECTION_8_FILTER)).toEqual(mapId(SECTION_8_EXPECTED_IDS));
  });

  const parityCases: [string, FilterNode | null, SortSpec[]][] = [
    ["text contains (ci)", { columnId: col.name, operator: "contains", value: "A" }, [{ columnId: col.name, dir: "asc" }]],
    ["text notContains incl. empty", { columnId: col.email, operator: "notContains", value: "example.com" }, []],
    ["number neq incl. empty", { columnId: col.fee, operator: "neq", value: 55000 }, [{ columnId: col.fee, dir: "desc" }]],
    ["number between", { columnId: col.fee, operator: "between", value: { from: 45000, to: 60000 } }, [{ columnId: col.fee, dir: "asc" }]],
    ["select isNoneOf incl. empty", { columnId: col.status, operator: "isNoneOf", value: ["paid", "partial"] }, []],
    ["select sort asc by option order", null, [{ columnId: col.status, dir: "asc" }]],
    ["select sort desc by option order", null, [{ columnId: col.status, dir: "desc" }]],
    ["boolean isFalse excludes empty", { columnId: col.isActive, operator: "isFalse" }, []],
    ["date isBetween inclusive", { columnId: col.callDate, operator: "isBetween", value: { from: "2026-09-23", to: "2026-09-24" } }, [{ columnId: col.callDate, dir: "desc" }]],
    ["no filter, sort nulls last", null, [{ columnId: col.fee, dir: "asc" }]],
  ];
  for (const [name, filter, sort] of parityCases) {
    it(`parity: ${name}`, async () => {
      expect(await ids(make(), filter, sort)).toEqual(await reference(filter, sort));
    });
  }

  it("search is case-insensitive across text columns", async () => {
    const res = await make().fetch({ filter: null, sort: [], search: "ESHA", page: { offset: 0, limit: 100 } });
    expect(res.rows.map((r) => r.id)).toEqual(["5"]);
  });

  it("keyset cursor paging walks the whole result with no dups or gaps, in reference order", async () => {
    const sort: SortSpec[] = [
      { columnId: col.status, dir: "asc" },
      { columnId: col.fee, dir: "desc" },
    ];
    const seen = await walk(make(), { filter: null, sort }, 2);
    expect(seen).toEqual(await reference(null, sort));
    expect(new Set(seen).size).toBe(seen.length);
    const byName = await walk(make(), { filter: null, sort: [{ columnId: col.name, dir: "desc" }] }, 3);
    expect(byName).toEqual(await reference(null, [{ columnId: col.name, dir: "desc" }]));
  });

  it("grouping by status with sum(fee) matches the in-memory reference", async () => {
    const res = await make().fetch({
      filter: null,
      sort: [],
      groupBy: [{ columnId: col.status, aggregations: [{ columnId: col.fee, agg: "sum" }] }],
      page: { offset: 0, limit: 50 },
    });
    const expected = await referenceGroups(leadsSchema, referenceRows, col.status, [{ columnId: col.fee, agg: "sum" }], {
      now: NOW,
      tz: TZ,
      userId: "u1",
    });
    expect(res.groups).toEqual(expected);
  });

  it("hydrates driver values as cells (DECIMAL → number, TINYINT → boolean, DATE → YYYY-MM-DD)", async () => {
    const r1 = await row(make(), "1");
    expect(r1).toMatchObject({ id: "1", version: 1, updatedAt: SEED_TS[0]?.toISOString() });
    const expected = Object.fromEntries(Object.entries(referenceRows[0]?.cells ?? {}).filter(([, v]) => v !== null));
    expect(r1?.cells).toEqual(expected);
  });

  it("optimistic writes: the second writer from the same base version conflicts; settable:false is read-only", async () => {
    const a = make();
    const b = make({ user: { id: "u2", roles: ["admin"] } });
    const base = (await row(a, "2"))?.version as number;
    const first = await a.applyChanges({
      id: "a1",
      source: "edit",
      changes: [{ rowId: "2", columnId: col.name, prev: "Bhavesh Rao", next: "Bhavesh R." }],
      baseVersions: { "2": base },
    });
    expect(first.applied).toHaveLength(1);
    expect(first.versions).toEqual({ "2": base + 1 });
    const second = await b.applyChanges({
      id: "b1",
      source: "edit",
      changes: [{ rowId: "2", columnId: col.name, prev: "Bhavesh Rao", next: "B. Rao" }],
      baseVersions: { "2": base },
    });
    expect(second.applied).toEqual([]);
    expect(second.conflicts).toEqual([
      expect.objectContaining({ rowId: "2", columnId: col.name, serverValue: "Bhavesh R.", serverVersion: base + 1 }),
    ]);
    expect((await row(a, "2"))?.cells.name).toBe("Bhavesh R.");

    const ro = await a.applyChanges({
      id: "a2",
      source: "edit",
      changes: [{ rowId: "2", columnId: col.isActive, prev: false, next: true }],
      baseVersions: { "2": base + 1 },
    });
    // settable:false is rejected by the shared planChanges (same message as createDrizzleDataSource);
    // "Read-only" is reserved for a view without write hooks.
    expect(ro.errors).toEqual([{ rowId: "2", columnId: col.isActive, message: "Column is read-only" }]);
    expect(ro.applied).toEqual([]);
  });

  it("extension columns: write (insert then update), filter, sort, group, stale edit conflicts, survive reload", async () => {
    const ds = withExt();
    const v3 = (await row(ds, "3"))?.version as number;
    const ins = await ds.applyChanges({
      id: "e1",
      source: "edit",
      changes: [
        { rowId: "3", columnId: noteColumn.id, prev: null, next: "Call back Monday" },
        { rowId: "3", columnId: scoreColumn.id, prev: null, next: 7 },
        { rowId: "5", columnId: scoreColumn.id, prev: null, next: 9 },
      ],
      baseVersions: { "3": v3, "5": (await row(ds, "5"))?.version as number },
    });
    expect(ins.errors).toEqual([]);
    expect(ins.conflicts).toEqual([]);
    expect(ins.applied).toHaveLength(3);
    expect(ins.versions?.["3"]).toBe(v3 + 1);

    const upd = await ds.applyChanges({
      id: "e2",
      source: "edit",
      changes: [{ rowId: "3", columnId: scoreColumn.id, prev: 7, next: 8 }],
      baseVersions: { "3": v3 + 1 },
    });
    expect(upd.applied).toHaveLength(1);
    expect(upd.versions?.["3"]).toBe(v3 + 2);

    const stale = await ds.applyChanges({
      id: "e3",
      source: "edit",
      changes: [{ rowId: "3", columnId: noteColumn.id, prev: "Call back Monday", next: "stale" }],
      baseVersions: { "3": v3 + 1 },
    });
    expect(stale.applied).toEqual([]);
    expect(stale.conflicts).toEqual([
      expect.objectContaining({ rowId: "3", columnId: noteColumn.id, serverValue: "Call back Monday", serverVersion: v3 + 2 }),
    ]);

    const fresh = withExt();
    expect(await ids(fresh, { columnId: noteColumn.id, operator: "contains", value: "MONDAY" })).toEqual(["3"]);
    expect(await ids(fresh, { columnId: scoreColumn.id, operator: "gt", value: 8 })).toEqual(["5"]);
    expect(await ids(fresh, { columnId: noteColumn.id, operator: "isEmpty" })).toEqual(["1", "2", "4", "5", "6", "7"]);
    expect(await ids(fresh, null, [{ columnId: scoreColumn.id, dir: "desc" }])).toEqual(["5", "3", "1", "2", "4", "6", "7"]);
    const groups = await fresh.fetch({
      filter: null,
      sort: [],
      groupBy: [{ columnId: scoreColumn.id }],
      page: { offset: 0, limit: 10 },
    });
    expect(groups.groups?.map((g) => [g.value, g.count])).toEqual([
      [8, 1],
      [9, 1],
      [null, 5],
    ]);
    expect((await row(fresh, "3"))?.cells).toMatchObject({ note: "Call back Monday", score: 8 });
  });

  it("updated_at feed: mapped and extension edits show up once; equal timestamps are not skipped", async () => {
    const ds = withExt();
    const boot = await ds.getChanges?.("");
    expect(boot?.rows).toEqual([]);
    expect(boot?.deletedRowIds).toEqual([]);
    const cursor = boot?.cursor as string;

    // Two rows touched at the SAME instant, the lower id second → the tiebreak must not skip either.
    await mysql.db.execute(sql`UPDATE leads SET updated_at = '2026-09-21 00:00:00.000', version = version + 1 WHERE id IN (6, 1)`);
    const e1 = (await ds.getChanges?.(cursor)) as NonNullable<Awaited<ReturnType<NonNullable<DataSource<GridRow>["getChanges"]>>>>;
    expect(e1.rows.map((r) => r.id)).toEqual(["1", "6"]);

    const v4 = (await row(ds, "4"))?.version as number;
    const mapped = await ds.applyChanges({
      id: "f1",
      source: "edit",
      changes: [{ rowId: "4", columnId: col.name, prev: "Dev Patel", next: "Dev P." }],
      baseVersions: { "4": v4 },
    });
    expect(mapped.applied).toHaveLength(1);
    const v2 = (await row(ds, "2"))?.version as number;
    const ext = await ds.applyChanges({
      id: "f2",
      source: "edit",
      changes: [{ rowId: "2", columnId: noteColumn.id, prev: null, next: "ext only" }],
      baseVersions: { "2": v2 },
    });
    expect(ext.applied).toHaveLength(1);

    const e2 = (await ds.getChanges?.(e1.cursor)) as typeof e1;
    expect(new Set(e2.rows.map((r) => r.id))).toEqual(new Set(["4", "2"]));
    expect(e2.rows.find((r) => r.id === "4")?.cells.name).toBe("Dev P.");
    expect(e2.rows.find((r) => r.id === "2")?.cells.note).toBe("ext only");

    const e3 = (await ds.getChanges?.(e2.cursor)) as typeof e1;
    expect(e3.rows).toEqual([]);
    expect(e3.cursor).toBe(e2.cursor);
  });

  it("createRows (with extension cells) and deleteRows (extension row removed)", async () => {
    const ds = withExt();
    const created = await ds.createRows([
      { cells: { name: "Zoya Khan", status: "pending", fee: 42000, note: "walk-in" } },
      { cells: { name: "Yash Mehta" } },
    ]);
    expect(created.map((r) => r.id)).toEqual(["8", "9"]);
    expect(created[0]?.cells).toMatchObject({ name: "Zoya Khan", status: "pending", fee: 42000, note: "walk-in" });
    expect(await ids(ds, { columnId: noteColumn.id, operator: "is", value: "walk-in" })).toEqual(["8"]);

    await ds.deleteRows(["8"]);
    expect(await ids(ds, { columnId: col.name, operator: "contains", value: "Zoya" })).toEqual([]);
    const extRows = (await mysql.db.execute(
      sql`SELECT row_id FROM ${sql.identifier(IT_EXTENSION_TABLE)} WHERE row_id = '8'`,
    )) as unknown as [unknown[]];
    expect(extRows[0]).toEqual([]);
  });

  it("filter on a column that is neither mapped nor extension-backed cannot be configured", () => {
    const schema: GridSchema = { ...leadsSchema, columns: [...leadsSchema.columns, noteColumn] };
    expect(() => make({ schema })).toThrow(/no mapped expression/);
  });

  it("v0.3 computed column: derived after fetch, not selected, unsortable / unfilterable / read-only, absent from capabilities scopes", async () => {
    const contact: ColumnDef = { id: "col_contact", key: "contact", label: "Contact", type: "text", config: {}, order: 30, createdAt: T, updatedAt: T };
    const source = make({
      schema: { ...leadsSchema, columns: [...leadsSchema.columns, contact] },
      columns: {
        name: { expr: leads.name },
        email: { expr: leads.email },
        status: { expr: leads.paymentStatus },
        callDate: { expr: leads.callDate },
        isActive: { expr: leads.aiVerified },
        fee: { expr: leads.fee },
        contact: { compute: (r) => (r.cells.name ? `${r.cells.name} <${r.cells.email ?? "?"}>` : null) },
      },
    });
    const first = (await source.fetch({ filter: null, sort: [{ columnId: col.name, dir: "asc" }], page: { offset: 0, limit: 1 } })).rows[0] as GridRow;
    expect(first.cells.contact).toBe(`${first.cells.name} <${first.cells.email ?? "?"}>`);
    const caps = source.capabilities();
    expect(caps.sort).toEqual({ columnIds: leadsSchema.columns.map((c) => c.id) });
    expect(caps.filter).toEqual({ columnIds: leadsSchema.columns.map((c) => c.id) });
    await expect(source.fetch({ filter: null, sort: [{ columnId: "col_contact", dir: "asc" }], page: { offset: 0, limit: 5 } })).rejects.toMatchObject({
      code: "UNSORTABLE_COLUMN",
    });
    const write = await source.applyChanges({
      id: "cmp1",
      changes: [{ rowId: first.id, columnId: "col_contact", prev: first.cells.contact, next: "x" }],
      baseVersions: { [first.id]: first.version },
      source: "edit",
    });
    expect(write.errors).toEqual([{ rowId: first.id, columnId: "col_contact", message: "Column is read-only" }]);
    const feed = await source.getChanges?.("");
    expect(feed?.cursor).toBeTruthy();
  });

  it("v0.3 meta reaches write.update (change + batch) and a hook's `rejected` is passed through", async () => {
    const seen: unknown[] = [];
    const base = hooks();
    const source = make({
      write: {
        ...base,
        update: async (ctx, input) => {
          seen.push(input);
          const [keep, ...drop] = input.changes;
          const res = await (base.update as NonNullable<SqlViewWriteHooks["update"]>)(ctx, { ...input, changes: keep ? [keep] : [] });
          return "conflict" in res ? res : { ...res, rejected: drop };
        },
      },
    });
    const r1 = await row(source, "1");
    if (!r1) throw new Error("row 1");
    const res = await source.applyChanges({
      id: "meta-view",
      meta: { reuploadDeadline: "2026-10-01" },
      changes: [
        { rowId: "1", columnId: col.name, prev: r1.cells.name, next: "Meta name", meta: { decisionMessage: "ok" } },
        { rowId: "1", columnId: col.email, prev: r1.cells.email, next: "meta@example.com" },
      ],
      baseVersions: { "1": r1.version },
      source: "edit",
    });
    expect(seen[0]).toMatchObject({
      rowId: "1",
      meta: { reuploadDeadline: "2026-10-01" },
      changes: [{ columnId: col.name, meta: { decisionMessage: "ok" } }, { columnId: col.email }],
    });
    expect(res.applied).toEqual([{ rowId: "1", columnId: col.name, prev: r1.cells.name, next: "Meta name", meta: { decisionMessage: "ok" } }]);
    expect(res.rejected).toEqual([{ rowId: "1", columnId: col.email, prev: r1.cells.email, next: "meta@example.com" }]);
    expect(res.errors).toEqual([]);
    expect((await row(source, "1"))?.cells.email).toBe(r1.cells.email);
  });
});
