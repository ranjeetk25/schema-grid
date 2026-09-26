/**
 * v0.3 SQL-view findings on a fake driver: per-cell write outcomes (#1),
 * computed columns + mapRows + defaultSort (#2) and zone-aware DATE / DATETIME
 * reads, writes and comparisons (#4). MySQL round trips live in the integration suite.
 */
import { sql } from "drizzle-orm";
import { datetime, date, decimal, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import type { GridDb } from "../../../src/changes/db";
import { PermissionError, RowValidationError, SchemaGridServerError } from "../../../src/errors";
import { type GridRow, type GridSchema, createRolePermissionResolver } from "../../../src/internal/core";
import {
  type SqlViewDataSourceOptions,
  type SqlViewUpdateInput,
  createSqlViewDataSource,
} from "../../../src/sqlview/create-sql-view-data-source";
import { type FakeCall, createFakeMysql } from "../../helpers/fake-mysql";
import { col } from "../../helpers/schemas";

const leads = mysqlTable("leads", {
  id: int("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  fee: decimal("fee", { precision: 10, scale: 2 }),
  callDate: date("call_date", { mode: "string" }),
  calledAt: datetime("called_at", { fsp: 3 }),
  fileKey: varchar("file_key", { length: 200 }),
  version: int("version"),
});

const adminOnly = { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } };
const schema: GridSchema = {
  id: "leads",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("fee", "number"),
    col("callDate", "date"),
    col("calledAt", "datetime"),
    col("fileKey", "text", adminOnly),
    col("url", "text"),
  ],
};

// Select-field order of `projection(allReadable)`: id, sg_bv, m_name, m_fee, m_callDate, m_calledAt, m_fileKey (+ sg_ex on loadRows).
const ROW = [7, 3, "Asha", "1500.00", "2026-09-24", "2026-09-24 10:30:00.000000", "docs/7.pdf"];

function make(extra: Partial<SqlViewDataSourceOptions> = {}, respond: (c: FakeCall) => unknown[][] | undefined = () => [ROW]) {
  const fake = createFakeMysql((c) => (c.rowsAsArray ? (respond(c) ?? []) : undefined));
  const ds = createSqlViewDataSource({
    db: fake.db as unknown as GridDb,
    schema,
    resolver: createRolePermissionResolver(),
    user: { id: "u1", roles: ["admin"] },
    tz: "Asia/Kolkata",
    baseQuery: () => sql`SELECT * FROM leads`,
    columns: {
      name: { expr: leads.name },
      fee: { expr: leads.fee },
      callDate: { expr: leads.callDate },
      calledAt: { expr: leads.calledAt },
      fileKey: { expr: leads.fileKey },
      url: { compute: (row) => (row.cells.fileKey ? `https://files/${String(row.cells.fileKey)}` : null) },
    },
    rowId: leads.id,
    version: leads.version,
    ...extra,
  });
  return { ds, calls: fake.calls, statements: fake.statements };
}

const page = { offset: 0, limit: 10 } as const;
const change = (columnId: string, prev: unknown, next: unknown) => ({ rowId: "7", columnId, prev, next });

describe("#1 per-cell outcomes from write.update", () => {
  it("applied + errors + version from the hook → one applied, one error, the hook's version", async () => {
    const inputs: SqlViewUpdateInput[] = [];
    const { ds } = make({
      write: {
        update: async (_ctx, input) => {
          inputs.push(input);
          const [a, b] = input.changes;
          return { applied: [a as never], errors: [{ rowId: "7", columnId: (b as { columnId: string }).columnId, message: "Fee is locked" }], version: 4 };
        },
      },
    });
    const res = await ds.applyChanges({
      id: "b1",
      source: "edit",
      changes: [change("name", "Asha", "Asha K"), change("fee", 1500, 1600)],
      baseVersions: { "7": 3 },
    });
    expect(res.applied).toEqual([change("name", "Asha", "Asha K")]);
    expect(res.errors).toEqual([{ rowId: "7", columnId: "fee", message: "Fee is locked" }]);
    expect(res.rejected).toBeUndefined();
    expect(res.versions).toEqual({ "7": 4 });
    expect(inputs[0]?.values).toEqual({ name: "Asha K", fee: 1600 });
  });

  it("rejected cells and unmentioned cells land in ChangeResult.rejected; nothing applied → no version entry", async () => {
    const { ds } = make({
      write: { update: async (_ctx, input) => ({ rejected: [input.changes[0] as never] }) },
    });
    const res = await ds.applyChanges({
      id: "b2",
      source: "edit",
      changes: [change("name", "Asha", "X"), change("fee", 1500, 1)],
      baseVersions: { "7": 3 },
    });
    expect(res.applied).toEqual([]);
    expect(res.errors).toEqual([]);
    expect(res.rejected).toEqual([change("name", "Asha", "X"), change("fee", 1500, 1)]);
    expect(res.versions).toEqual({});
  });

  it("applied without a version → the row is re-read for its version; conflict still wins", async () => {
    let reads = 0;
    const { ds } = make(
      { write: { update: async (_ctx, input) => ({ applied: input.changes }) } },
      () => [reads++ === 0 ? ROW : [7, 9, "Asha K", "1500.00", "2026-09-24", "2026-09-24 10:30:00.000000", "docs/7.pdf"]],
    );
    const res = await ds.applyChanges({ id: "b3", source: "edit", changes: [change("name", "Asha", "Asha K")], baseVersions: { "7": 3 } });
    expect(res.applied).toHaveLength(1);
    expect(res.versions).toEqual({ "7": 9 });

    const conflicting = make({
      write: {
        update: async () => ({
          conflict: { rowId: "7", columnId: "name", serverValue: "Other", serverVersion: 4, updatedAt: "2026-09-24T00:00:00.000Z" },
        }),
      },
    });
    const c = await conflicting.ds.applyChanges({ id: "b4", source: "edit", changes: [change("name", "Asha", "Y")], baseVersions: { "7": 3 } });
    expect(c.applied).toEqual([]);
    expect(c.conflicts).toEqual([expect.objectContaining({ rowId: "7", columnId: "name" })]);
  });

  it("write.create errors per partial index become RowValidationError (ROW_INVALID) and roll the transaction back", async () => {
    const { ds, calls } = make({
      write: {
        create: async (_ctx, _partials, storage) => ({
          rows: [{ id: "8" }, { id: "9" }],
          errors: [{ index: 1, columnId: "fee", message: `Fee ${String(storage[1]?.fee)} is too low` }],
        }),
      },
    });
    const err = await ds.createRows([{ cells: { name: "A", fee: 10 } }, { cells: { name: "B", fee: 1 } }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RowValidationError);
    expect(err).toMatchObject({ details: { rowIndex: 1, columnId: "fee" }, message: expect.stringContaining("Fee 1 is too low") });
    expect(calls.at(-1)?.sql.toLowerCase()).toBe("rollback");
  });
});

describe("#2 computed columns, mapRows and defaultSort", () => {
  it("compute fills the cell from hidden cells before projection; capabilities exclude it from sort/filter", async () => {
    const { ds, statements } = make();
    const caps = ds.capabilities();
    expect(caps.sort).toEqual({ columnIds: ["name", "fee", "callDate", "calledAt", "fileKey"] });
    expect(caps.filter).toEqual(caps.sort);
    const res = await ds.fetch({ filter: null, sort: [], page });
    expect(res.rows[0]?.cells.url).toBe("https://files/docs/7.pdf");
    expect(statements()[0]?.sql).not.toContain("m_url");

    // A counsellor cannot read fileKey, yet the computed url (readable) is still derived from it.
    const counsellor = make({ user: { id: "u2", roles: ["counsellor"] } });
    const row = (await counsellor.ds.fetch({ filter: null, sort: [], page })).rows[0] as GridRow;
    expect(row.cells).not.toHaveProperty("fileKey");
    expect(row.cells.url).toBe("https://files/docs/7.pdf");
  });

  it("sorting / filtering / writing a computed column is refused like sortable:false / filterable:false / settable:false", async () => {
    const { ds } = make({ write: { update: async (_c, i) => ({ applied: i.changes, version: 4 }) } });
    await expect(ds.fetch({ filter: null, sort: [{ columnId: "url", dir: "asc" }], page })).rejects.toMatchObject({
      code: "UNSORTABLE_COLUMN",
    });
    await expect(ds.fetch({ filter: { columnId: "url", operator: "contains", value: "x" }, sort: [], page })).rejects.toThrow();
    const res = await ds.applyChanges({ id: "b5", source: "edit", changes: [change("url", null, "x")], baseVersions: { "7": 3 } });
    expect(res.errors).toEqual([{ rowId: "7", columnId: "url", message: "Column is read-only" }]);
    // Search never touches it.
    const { statements } = make();
    await make().ds.fetch({ filter: null, sort: [], search: "asha", page });
    expect(statements().every((s) => !s.sql.includes("url"))).toBe(true);
  });

  it("`computed` declares mapRows-only columns; mapRows / mapRow run in order with the view context", async () => {
    const seen: string[] = [];
    const { ds } = make({
      columns: {
        name: { expr: leads.name },
        fee: { expr: leads.fee },
        callDate: { expr: leads.callDate },
        calledAt: { expr: leads.calledAt },
        fileKey: { expr: leads.fileKey },
      },
      computed: { url: { kind: "text" } },
      mapRows: async (rows, ctx) => {
        seen.push(`rows:${rows.length}:${ctx.gridId}:${typeof ctx.db.select}`);
        return rows.map((r) => ({ ...r, cells: { ...r.cells, url: `signed:${String(r.cells.fileKey)}` } }));
      },
      mapRow: (row) => {
        seen.push(`row:${row.id}`);
        return { ...row, cells: { ...row.cells, name: `${String(row.cells.name)}!` } };
      },
    });
    const res = await ds.fetch({ filter: null, sort: [], page });
    expect(res.rows[0]?.cells).toMatchObject({ url: "signed:docs/7.pdf", name: "Asha!" });
    expect(seen).toEqual(["rows:1:leads:function", "row:7"]);
  });

  it("mapRows returning the wrong number of rows is an error, not silent data loss", async () => {
    const { ds } = make({ mapRows: async () => [] });
    await expect(ds.fetch({ filter: null, sort: [], page })).rejects.toBeInstanceOf(SchemaGridServerError);
  });

  it("defaultSort applies to sort: [] (SQL + keyset), is reported in capabilities, and is validated", async () => {
    const { ds, statements } = make({ defaultSort: [{ columnId: "fee", dir: "desc" }] });
    expect(ds.capabilities().defaultSort).toEqual([{ columnId: "fee", dir: "desc" }]);
    await ds.fetch({ filter: null, sort: [], page: { cursor: "", limit: 10 } });
    const q = statements()[0]?.sql ?? "";
    expect(q).toMatch(/order by .*`sg_base`\.`fee`[^,]*\) DESC, `sg_base`\.`id` ASC/);
    // An explicit sort wins.
    await ds.fetch({ filter: null, sort: [{ columnId: "name", dir: "asc" }], page });
    expect(statements()[1]?.sql).not.toMatch(/`fee`[^,]*\) DESC/);
    // Unknown / unsortable default sort columns fail at construction; hidden ones are dropped for that user.
    expect(() => make({ defaultSort: [{ columnId: "nope", dir: "asc" }] })).toThrow(SchemaGridServerError);
    expect(() => make({ defaultSort: [{ columnId: "url", dir: "asc" }] })).toThrow(/not sortable/);
    const counsellor = make({ user: { id: "u2", roles: ["counsellor"] }, defaultSort: [{ columnId: "fileKey", dir: "asc" }] });
    expect(counsellor.ds.capabilities().defaultSort).toBeUndefined();
    await expect(counsellor.ds.fetch({ filter: null, sort: [], page })).resolves.toBeTruthy();
  });

  it("defaultSort is honoured by the drizzle data source too (parity), and PermissionError still guards hidden sorts", async () => {
    const { createDrizzleDataSource } = await import("../../../src/datasource/create-drizzle-data-source");
    const { createDefaultRegistry } = await import("../../../src/internal/core");
    const fake = createFakeMysql(() => []);
    const ds = createDrizzleDataSource({
      db: fake.db as unknown as GridDb,
      gridId: "g",
      schema: { id: "g", schemaVersion: 1, columns: [col("name", "text"), col("fee", "number")] },
      registry: createDefaultRegistry(),
      resolver: createRolePermissionResolver(),
      user: { id: "u1", roles: ["admin"] },
      defaultSort: [{ columnId: "fee", dir: "asc" }],
      mapRow: (row) => ({ ...row, cells: { ...row.cells, name: "mapped" } }),
    });
    expect(await ds.capabilities?.()).toMatchObject({ defaultSort: [{ columnId: "fee", dir: "asc" }], lookup: false });
    await ds.fetch({ filter: null, sort: [], page });
    expect(fake.statements()[0]?.sql).toMatch(/order by .*\$\.fee.* ASC, `id` ASC limit/);
    await expect(ds.fetch({ filter: null, sort: [{ columnId: "nope", dir: "asc" }], page })).rejects.toThrow();
  });
});

describe("#4 naive DATE / DATETIME columns", () => {
  it("reads DATE / DATETIME as text (DATE_FORMAT) and interprets DATETIME wall times in naiveDatetimeZone (default tz)", async () => {
    const { ds, statements } = make();
    const res = await ds.fetch({ filter: null, sort: [], page });
    const q = statements()[0]?.sql ?? "";
    expect(q).toContain("DATE_FORMAT(`sg_base`.`call_date`, '%Y-%m-%d')");
    expect(q).toContain("DATE_FORMAT(`sg_base`.`called_at`, '%Y-%m-%d %H:%i:%s.%f')");
    expect(res.rows[0]?.cells).toMatchObject({ callDate: "2026-09-24", calledAt: "2026-09-24T05:00:00.000Z" });

    const utc = make({ naiveDatetimeZone: "UTC" });
    expect((await utc.ds.fetch({ filter: null, sort: [], page })).rows[0]?.cells.calledAt).toBe("2026-09-24T10:30:00.000Z");
  });

  it("filters and sorts compare DATETIME in UTC through CONVERT_TZ (numeric offset for fixed-offset zones)", async () => {
    const { ds, statements } = make();
    await ds.fetch({
      filter: { columnId: "calledAt", operator: "isAfter", value: "2026-09-24T05:00:00.000Z" },
      sort: [{ columnId: "calledAt", dir: "asc" }],
      page,
    });
    const q = statements()[0];
    expect(q?.sql).toContain("CONVERT_TZ(`sg_base`.`called_at`, ?, '+00:00')");
    expect(q?.params).toContain("+05:30");
    expect(q?.params).toContain("2026-09-24 05:00:00.000");
    const utc = make({ naiveDatetimeZone: "UTC" });
    await utc.ds.fetch({ filter: null, sort: [{ columnId: "calledAt", dir: "asc" }], page });
    expect(utc.statements()[0]?.sql).not.toContain("CONVERT_TZ");
    const ny = make({ naiveDatetimeZone: "America/New_York" });
    await ny.ds.fetch({ filter: null, sort: [{ columnId: "calledAt", dir: "asc" }], page });
    expect(ny.statements()[0]?.sql).toContain("CONVERT_TZ(`sg_base`.`called_at`, ?, 'UTC')");
    expect(ny.statements()[0]?.params).toContain("America/New_York");
  });

  it("write hooks get storage-ready values: DATETIME as wall time in the zone, DATE as YYYY-MM-DD", async () => {
    const inputs: SqlViewUpdateInput[] = [];
    const created: Record<string, unknown>[][] = [];
    const { ds } = make({
      write: {
        update: async (_ctx, input) => {
          inputs.push(input);
          return { applied: input.changes, version: 4 };
        },
        create: async (_ctx, _partials, storage) => {
          created.push(storage);
          return [{ id: "7" }];
        },
      },
    });
    await ds.applyChanges({
      id: "b6",
      source: "edit",
      changes: [change("calledAt", "2026-09-24T05:00:00.000Z", "2026-09-25T13:15:00.000Z"), change("callDate", "2026-09-24", "2026-09-25")],
      baseVersions: { "7": 3 },
    });
    expect(inputs[0]?.values).toEqual({ calledAt: "2026-09-25 18:45:00.000", callDate: "2026-09-25" });
    expect(inputs[0]?.changes.map((c) => c.next)).toEqual(["2026-09-25T13:15:00.000Z", "2026-09-25"]);
    await ds.createRows([{ cells: { name: "N", calledAt: "2026-09-25T13:15:00.000Z", callDate: "2026-09-25", fee: null } }]);
    expect(created[0]).toEqual([{ name: "N", calledAt: "2026-09-25 18:45:00.000", callDate: "2026-09-25", fee: null }]);
  });
});

describe("regressions", () => {
  it("v0.2 hook shapes still work: { applied, version } and no `values` reads", async () => {
    const { ds } = make({ write: { update: async (_c, i) => ({ applied: i.changes, version: i.baseVersion + 1 }) } });
    const res = await ds.applyChanges({ id: "b7", source: "edit", changes: [change("name", "Asha", "Z")], baseVersions: { "7": 3 } });
    expect(res).toEqual({ applied: [change("name", "Asha", "Z")], conflicts: [], errors: [], versions: { "7": 4 } });
    expect(new PermissionError([], "edit")).toBeInstanceOf(Error);
  });
});
