import { varchar } from "drizzle-orm/mysql-core";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { CommitOutcome } from "../../../src/changes/after-commit";
import type { GridDb } from "../../../src/changes/db";
import type { ServerWarning } from "../../../src/context";
import { createDrizzleDataSource, type DrizzleDataSourceOptions } from "../../../src/datasource/create-drizzle-data-source";
import { PermissionError, SchemaValidationError } from "../../../src/errors";
import {
  type DataSource,
  type GridRow,
  createDefaultRegistry,
  createRolePermissionResolver,
} from "../../../src/internal/core";
import { defineGridTables } from "../../../src/storage/tables";
import { type FakeCall, asRows, createFakeMysql } from "../../helpers/fake-mysql";
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

describe("createDrizzleDataSource: rows after a save and getRows (v0.3.1)", () => {
  const ORDER = ["id", "gridId", "version", "updatedAt", "updatedBy", "deletedAt", "cells", "email_addr"];
  type State = Record<string, Record<string, unknown>>;
  const dbRow = (id: string, cells: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id,
    gridId: "admissions",
    version: 1,
    updatedAt: "2026-09-24 10:00:00.000",
    updatedBy: "u9",
    deletedAt: null,
    cells,
    email_addr: null,
    ...extra,
  });
  const freshState = (): State => ({
    r1: dbRow("r1", { name: "Asha", fee: 100, paid: 40, notes: "hidden" }),
    r2: dbRow("r2", { name: "Bhavesh", fee: 300, paid: 0 }),
    r9: dbRow("r9", { name: "Deleted" }, { deletedAt: "2026-09-24 11:00:00.000" }),
  });
  /** Selects answer from `state`; an UPDATE writes fee = 500 and bumps the version (so a re-read proves read-after-write). */
  const script = (state: State) => (c: FakeCall) => {
    if (c.rowsAsArray && c.sql.startsWith("select")) {
      const ids = c.params.filter((p): p is string => typeof p === "string" && p in state);
      return asRows(ids.map((id) => state[id] as Record<string, unknown>), ORDER);
    }
    if (c.sql.startsWith("update")) {
      const id = c.params.find((p) => typeof p === "string" && p in state) as string;
      const row = state[id] as Record<string, unknown>;
      state[id] = { ...row, version: (row.version as number) + 1, cells: { ...(row.cells as Record<string, unknown>), fee: 500 } };
      return { affectedRows: 1 };
    }
    return undefined;
  };
  function live(extra: Partial<DrizzleDataSourceOptions> = {}, roles = ["admin"]) {
    const state = freshState();
    const fake = createFakeMysql(script(state));
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
    return { ds, state, ...fake };
  }
  const balance = FIXTURE_COLUMN_IDS.balance;
  const key = (id: string) => serverFixtureSchema.columns.find((c) => c.id === id)?.key as string;

  it("applyChanges returns the rows read after the write with formulas recomputed and hidden cells stripped", async () => {
    const { ds } = live({}, ["counsellor"]);
    const res = await ds.applyChanges({
      id: "b1",
      source: "edit",
      changes: [{ rowId: "r1", columnId: FIXTURE_COLUMN_IDS.name, prev: "Asha", next: "Asha K" }],
      baseVersions: { r1: 1 },
    });
    expect(res.applied).toHaveLength(1);
    const [r1] = res.rows ?? [];
    expect(r1).toMatchObject({ id: "r1", version: 2 });
    expect(r1?.cells[key(fee)]).toBe(500);
    expect(r1?.cells[key(balance)]).toBe(460); // {fee} - {paid} on the post-write fee
    expect(r1?.cells).not.toHaveProperty(key(notes));
  });

  it("applyChanges rows go through mapRows / mapRow; unknown and deleted ids are skipped", async () => {
    const { ds } = live({
      mapRows: (rows) => rows.map((r) => ({ ...r, cells: { ...r.cells, [key(FIXTURE_COLUMN_IDS.website)]: "https://mapped" } })),
      mapRow: (row) => ({ ...row, cells: { ...row.cells, [key(FIXTURE_COLUMN_IDS.name)]: `${String(row.cells[key(FIXTURE_COLUMN_IDS.name)])}!` } }),
    });
    const res = await ds.applyChanges({
      id: "b2",
      source: "edit",
      changes: [
        { rowId: "r2", columnId: FIXTURE_COLUMN_IDS.name, prev: "Bhavesh", next: "B" },
        { rowId: "nope", columnId: FIXTURE_COLUMN_IDS.name, prev: null, next: "x" },
        { rowId: "r9", columnId: FIXTURE_COLUMN_IDS.name, prev: null, next: "y" },
      ],
      baseVersions: { r2: 1, nope: 1, r9: 1 },
    });
    expect(res.rows?.map((r) => r.id)).toEqual(["r2"]);
    expect(res.rows?.[0]?.cells).toMatchObject({ [key(FIXTURE_COLUMN_IDS.website)]: "https://mapped", [key(FIXTURE_COLUMN_IDS.name)]: "Bhavesh!" });
  });

  it("getRows follows the order of ids, skips unknown / deleted ids, projects and evaluates formulas", async () => {
    const { ds, statements } = live({}, ["counsellor"]);
    const rows = await ds.getRows?.(["r2", "nope", "r9", "r1"]);
    expect(rows?.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(rows?.[1]?.cells[key(balance)]).toBe(60);
    expect(rows?.[1]?.cells).not.toHaveProperty(key(notes));
    expect(statements()).toHaveLength(1);
    expect(statements()[0]?.sql).toMatch(/^select .* from `grid_rows` where \(`grid_rows`.`grid_id` = \? and `grid_rows`.`id` in \(\?, \?, \?, \?\)\)$/);
    expect(await ds.getRows?.([])).toEqual([]);
    expect(statements()).toHaveLength(1);
  });

  describe("afterCommit (v0.3.1)", () => {
    const nameId = FIXTURE_COLUMN_IDS.name;
    /** r1: name applied + fee invalid (error); r2: stale base version (conflict). */
    const mixed = {
      id: "b3",
      source: "edit" as const,
      changes: [
        { rowId: "r1", columnId: nameId, prev: "Asha", next: "Asha K" },
        { rowId: "r1", columnId: fee, prev: 100, next: "not-a-number" },
        { rowId: "r2", columnId: nameId, prev: "Bhavesh", next: "B" },
      ],
      baseVersions: { r1: 1, r2: 7 },
      meta: { reason: "bulk" },
    };
    const withWarnings = (extra: Partial<DrizzleDataSourceOptions> = {}) => {
      const warnings: ServerWarning[] = [];
      return { warnings, ...live({ onWarning: (w) => warnings.push(w), ...extra }) };
    };

    it("applyChanges: the hook gets applied / rejected / errors / conflicts / meta / rows with the ServerContext, after commit", async () => {
      const seen: CommitOutcome[] = [];
      let seenCtx: unknown;
      let committedAt = -1;
      const { ds, calls, warnings } = withWarnings({
        afterCommit: async (ctx, outcome) => {
          seenCtx = ctx;
          seen.push(outcome);
          committedAt = calls.map((c) => c.sql.toLowerCase()).lastIndexOf("commit");
        },
      });
      const res = await ds.applyChanges(mixed);
      expect(committedAt).toBeGreaterThan(-1); // COMMIT had already been issued when the hook ran
      expect(res.applied).toHaveLength(1);
      expect(res.errors).toEqual([expect.objectContaining({ rowId: "r1", columnId: fee })]);
      expect(res.conflicts).toEqual([expect.objectContaining({ rowId: "r2", columnId: nameId })]);
      const o = seen[0];
      if (o?.kind !== "applyChanges") throw new Error("expected an applyChanges outcome");
      expect(o.applied).toBe(res.applied);
      expect(o.rejected).toEqual([]);
      expect(o.errors).toBe(res.errors);
      expect(o.conflicts).toBe(res.conflicts);
      expect(o.meta).toEqual({ reason: "bulk" });
      expect(o.rows).toBe(res.rows);
      expect(o.rows.map((r) => r.id)).toEqual(["r1", "r2"]);
      expect((seenCtx as { user: { id: string } }).user.id).toBe("u1");
      expect(warnings).toEqual([]);
    });

    it("applyChanges: the hook's own statement lands after `commit`; a throwing / rejecting hook only warns", async () => {
      const { ds, calls, warnings } = withWarnings({
        afterCommit: async () => {
          calls.push({ sql: "-- hook marker", params: [], rowsAsArray: false });
          throw new Error("notify failed");
        },
      });
      const res = await ds.applyChanges(mixed);
      expect(res.applied).toHaveLength(1);
      const sqls = calls.map((c) => c.sql.toLowerCase());
      expect(sqls.indexOf("-- hook marker")).toBeGreaterThan(sqls.indexOf("commit"));
      expect(warnings).toEqual([{ code: "AFTER_COMMIT_FAILED", op: "applyChanges", error: expect.objectContaining({ message: "notify failed" }) }]);

      const sync = withWarnings({
        afterCommit: () => {
          throw new Error("sync");
        },
      });
      await expect(sync.ds.applyChanges(mixed)).resolves.toMatchObject({ applied: [expect.anything()] });
      expect(sync.warnings).toMatchObject([{ code: "AFTER_COMMIT_FAILED", op: "applyChanges" }]);
    });

    it("applyChanges: not called when the transaction rolls back", async () => {
      const hook = vi.fn();
      const state = freshState();
      const fake = createFakeMysql((c) => {
        if (c.sql.startsWith("update")) throw new Error("deadlock");
        return script(state)(c);
      });
      const ds = createDrizzleDataSource({
        db: fake.db as unknown as GridDb,
        gridId: "admissions",
        schema: serverFixtureSchema,
        registry: createDefaultRegistry(),
        resolver: createRolePermissionResolver(),
        user: { id: "u1", roles: ["admin"] },
        now: () => new Date(FIXTURE_NOW),
        tables,
        afterCommit: hook,
      });
      await expect(ds.applyChanges(mixed)).rejects.toThrow(/deadlock|Failed query/);
      expect(fake.calls.at(-1)?.sql.toLowerCase()).toBe("rollback");
      expect(hook).not.toHaveBeenCalled();
    });

    it("createRows → { created } with ids; deleteRows → { deletedIds } of the rows actually deleted", async () => {
      const seen: CommitOutcome[] = [];
      const { ds, calls } = withWarnings({
        afterCommit: (_ctx, outcome) => {
          seen.push(outcome);
        },
      });
      const created = await ds.createRows([{ id: "n1", cells: { [key(nameId)]: "New" } }]);
      expect(created.map((r) => r.id)).toEqual(["n1"]);
      expect(seen).toEqual([{ kind: "createRows", created }]);
      expect(calls.map((c) => c.sql.toLowerCase())).toContain("commit");

      await ds.deleteRows(["r1", "r2", "r1"]);
      expect(seen[1]).toEqual({ kind: "deleteRows", deletedIds: ["r1", "r2"] });

      // Nothing live to delete → the transaction still commits but nothing was deleted.
      await ds.deleteRows(["nope"]);
      expect(seen[2]).toEqual({ kind: "deleteRows", deletedIds: [] });
      // Empty input → no transaction → no hook.
      await ds.deleteRows([]);
      await ds.createRows([]);
      expect(seen).toHaveLength(3);
    });
  });
});
