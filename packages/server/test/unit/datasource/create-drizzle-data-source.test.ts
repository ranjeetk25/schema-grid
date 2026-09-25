import { varchar } from "drizzle-orm/mysql-core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { GridDb } from "../../../src/changes/db";
import { createDrizzleDataSource, type DrizzleDataSourceOptions } from "../../../src/datasource/create-drizzle-data-source";
import { PermissionError, SchemaValidationError } from "../../../src/errors";
import {
  type DataSource,
  type GridRow,
  createDefaultRegistry,
  createRolePermissionResolver,
} from "../../../src/internal/core";
import { defineGridTables } from "../../../src/storage/tables";
import { type FakeCall, createFakeMysql } from "../../helpers/fake-mysql";
import { FIXTURE_COLUMN_IDS, FIXTURE_NOW, serverFixtureSchema } from "../../fixtures/admissions";

const tables = defineGridTables({
  rowsTable: "grid_rows",
  changeLogTable: "grid_change_log",
  physicalColumns: { email_addr: varchar("email_addr", { length: 191 }) },
});

const fee = FIXTURE_COLUMN_IDS.fee;
const status = FIXTURE_COLUMN_IDS.status;
const notes = FIXTURE_COLUMN_IDS.notes;

function make(extra: Partial<DrizzleDataSourceOptions> = {}, roles = ["counsellor"]) {
  const fake = createFakeMysql((c) => (c.rowsAsArray ? [] : undefined));
  const ds = createDrizzleDataSource({
    db: fake.db as unknown as GridDb,
    gridId: "admissions",
    schema: serverFixtureSchema,
    registry: createDefaultRegistry(),
    resolver: createRolePermissionResolver(),
    user: { id: "u1", roles },
    now: () => new Date(FIXTURE_NOW),
    tables,
    ...extra,
  });
  return { ds, ...fake };
}

describe("createDrizzleDataSource", () => {
  it("satisfies the core DataSource<GridRow> type", () => {
    const { ds } = make();
    expectTypeOf(ds).toMatchTypeOf<DataSource<GridRow>>();
  });

  it("an invalid schema throws at construction", () => {
    const firstColumn = serverFixtureSchema.columns[0];
    if (!firstColumn) throw new Error("expected serverFixtureSchema to have at least one column");
    const bad = { ...serverFixtureSchema, columns: [...serverFixtureSchema.columns, { ...firstColumn, id: "dup" }] };
    expect(() => make({ schema: bad })).toThrow(SchemaValidationError);
    expect(() => make({ tables: defineGridTables({ rowsTable: "r", changeLogTable: "l" }) })).toThrow(SchemaValidationError);
  });

  it("fetch routes to grouping when groupBy is set", async () => {
    const { ds, statements } = make();
    const res = await ds.fetch({
      filter: null,
      sort: [],
      groupBy: [{ columnId: status, aggregations: [{ columnId: fee, agg: "sum" }] }],
      page: { offset: 0, limit: 10 },
    });
    expect(res.rows).toEqual([]);
    expect(res.groups).toEqual([]);
    expect((statements()[0] as FakeCall).sql).toMatch(/group by/i);
  });

  it("fetch without groupBy runs the row query", async () => {
    const { ds, statements } = make();
    const res = await ds.fetch({ filter: null, sort: [{ columnId: fee, dir: "desc" }], page: { offset: 0, limit: 10 } });
    expect(res.rows).toEqual([]);
    expect((statements()[0] as FakeCall).sql).toMatch(/order by/);
  });

  it("fetch with a hidden sort column rejects with PermissionError before any SQL", async () => {
    const { ds, calls } = make();
    await expect(
      ds.fetch({ filter: null, sort: [{ columnId: notes, dir: "asc" }], page: { offset: 0, limit: 10 } }),
    ).rejects.toBeInstanceOf(PermissionError);
    expect(calls).toHaveLength(0);
  });

  it("optional methods are absent without their hooks, present with them", async () => {
    const { ds } = make();
    expect(ds.createOption).toBeUndefined();
    expect(ds.lookup).toBeUndefined();
    const withHooks = make({
      onCreateOption: async (_c, label) => ({ id: "new", label }),
      linkLookup: async () => [{ id: "l1", label: "L1" }],
    }).ds;
    await expect(withHooks.createOption?.(status, "Refunded")).resolves.toEqual({ id: "new", label: "Refunded" });
    await expect(withHooks.lookup?.(FIXTURE_COLUMN_IDS.name, "x")).resolves.toEqual([{ id: "l1", label: "L1" }]);
    await expect(withHooks.lookup?.(notes, "x")).rejects.toBeInstanceOf(PermissionError);
  });

  it("getOptions filters by search case-insensitively; hidden columns are rejected", async () => {
    const { ds } = make();
    // "ai" matches only "Paid" among status's options (Paid/Pending/Partial)
    await expect(ds.getOptions?.(status, "ai")).resolves.toEqual([{ id: "paid", label: "Paid", color: "green" }]);
    await expect(ds.getOptions?.(status)).resolves.toHaveLength(3);
    await expect(ds.getOptions?.(notes)).rejects.toBeInstanceOf(PermissionError);
    const users = make({ userDirectory: async (s) => [{ id: "u9", label: `match:${s}` }] }).ds;
    await expect(users.getOptions?.(FIXTURE_COLUMN_IDS.owner, "ra")).resolves.toEqual([{ id: "u9", label: "match:ra" }]);
  });

  it("createOption requires edit access", async () => {
    const { ds } = make(
      { onCreateOption: async (_c, label) => ({ id: "x", label }) },
      ["viewer"],
    );
    // viewers still have edit on unrestricted columns under the default role resolver
    await expect(ds.createOption?.(status, "X")).resolves.toMatchObject({ label: "X" });
    await expect(ds.createOption?.(notes, "X")).rejects.toBeInstanceOf(PermissionError);
  });
});
