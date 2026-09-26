/**
 * v0.3.1 `write.afterCommit` on the SQL view: runs strictly after COMMIT with the
 * batch's outcome, never inside the transaction, never on a rollback, and a
 * failing hook only warns (`AFTER_COMMIT_FAILED`) — the answer is untouched.
 */
import { sql } from "drizzle-orm";
import { decimal, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GridDb } from "../../../src/changes/db";
import type { ServerWarning } from "../../../src/context";
import { RowValidationError } from "../../../src/errors";
import { type GridSchema, createRolePermissionResolver } from "../../../src/internal/core";
import {
  type SqlViewCommitOutcome,
  type SqlViewDataSourceOptions,
  createSqlViewDataSource,
} from "../../../src/sqlview/create-sql-view-data-source";
import { type FakeCall, createFakeMysql } from "../../helpers/fake-mysql";
import { col } from "../../helpers/schemas";

const leads = mysqlTable("leads", {
  id: int("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  fee: decimal("fee", { precision: 10, scale: 2 }),
  note: varchar("note", { length: 100 }),
  version: int("version"),
});

const schema: GridSchema = {
  id: "leads",
  schemaVersion: 1,
  columns: [col("name", "text"), col("fee", "number"), col("note", "text")],
};

// Select-field order of `projection(allReadable)`: id, sg_bv, m_name, m_fee, m_note (+ sg_ex on loadRows).
const ROW7 = [7, 3, "Asha", "1500.00", "n7"];
const ROW8 = [8, 5, "Bhavesh", "300.00", "n8"];

function make(extra: Partial<SqlViewDataSourceOptions> = {}, respond: (c: FakeCall) => unknown[][] | undefined = () => [ROW7, ROW8]) {
  const fake = createFakeMysql((c) => (c.rowsAsArray ? (respond(c) ?? []) : undefined));
  const warnings: ServerWarning[] = [];
  const ds = createSqlViewDataSource({
    db: fake.db as unknown as GridDb,
    schema,
    resolver: createRolePermissionResolver(),
    user: { id: "u1", roles: ["admin"] },
    baseQuery: () => sql`SELECT * FROM leads`,
    columns: { name: { expr: leads.name }, fee: { expr: leads.fee }, note: { expr: leads.note } },
    rowId: leads.id,
    version: leads.version,
    onWarning: (w) => warnings.push(w),
    ...extra,
  });
  return { ds, db: fake.db as unknown as GridDb, calls: fake.calls, warnings };
}

const change = (rowId: string, columnId: string, prev: unknown, next: unknown) => ({ rowId, columnId, prev, next });
/** Row 7: name applied, fee errored, note unmentioned (→ rejected); row 8: stale base version (→ conflict). */
const mixedBatch = {
  id: "b1",
  source: "edit" as const,
  changes: [change("7", "name", "Asha", "Asha K"), change("7", "fee", 1500, 1), change("7", "note", "n7", "x"), change("8", "name", "Bhavesh", "B")],
  baseVersions: { "7": 3, "8": 1 },
  meta: { reason: "bulk" },
};
const updateHook: NonNullable<SqlViewDataSourceOptions["write"]>["update"] = async (_ctx, input) => {
  const [name, fee] = input.changes;
  return { applied: [name as never], errors: [{ rowId: "7", columnId: (fee as { columnId: string }).columnId, message: "Fee is locked" }], version: 4 };
};

describe("createSqlViewDataSource: write.afterCommit (v0.3.1)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("applyChanges: the hook receives applied / rejected / errors / conflicts / meta / rows and the non-transactional db", async () => {
    const seen: SqlViewCommitOutcome[] = [];
    let hookDb: unknown;
    const { ds, db: outerDb, warnings } = make({
      write: {
        update: updateHook,
        afterCommit: (ctx, outcome) => {
          hookDb = ctx.db;
          seen.push(outcome);
        },
      },
    });
    const res = await ds.applyChanges(mixedBatch);
    expect(seen).toHaveLength(1);
    const o = seen[0];
    if (o?.kind !== "applyChanges") throw new Error("expected an applyChanges outcome");
    expect(o.applied).toEqual([change("7", "name", "Asha", "Asha K")]);
    expect(o.rejected).toEqual([change("7", "note", "n7", "x")]);
    expect(o.errors).toEqual([{ rowId: "7", columnId: "fee", message: "Fee is locked" }]);
    expect(o.conflicts).toEqual([expect.objectContaining({ rowId: "8", columnId: "name", serverVersion: 5 })]);
    expect(o.meta).toEqual({ reason: "bulk" });
    expect(o.rows.map((r) => r.id)).toEqual(["7", "8"]);
    expect(o.rows).toBe(res.rows);
    expect(res.versions).toEqual({ "7": 4 });
    expect(hookDb).toBe(outerDb);
    expect(warnings).toEqual([]);
  });

  it("applyChanges: the hook runs after COMMIT, on the outer db (its own statements come after `commit`)", async () => {
    const order: string[] = [];
    const { ds, calls } = make({
      write: {
        update: updateHook,
        afterCommit: async (ctx) => {
          order.push("hook");
          await ctx.db.execute(sql`SELECT 1 AS marker`);
        },
      },
    });
    await ds.applyChanges(mixedBatch);
    const sqls = calls.map((c) => c.sql.trim().toLowerCase());
    const commitAt = sqls.indexOf("commit");
    const markerAt = sqls.findIndex((s) => s.includes("marker"));
    expect(commitAt).toBeGreaterThan(-1);
    expect(markerAt).toBeGreaterThan(commitAt);
    // The marker was not wrapped in a transaction of its own and no later commit follows it.
    expect(sqls.slice(markerAt + 1)).not.toContain("commit");
    expect(order).toEqual(["hook"]);
  });

  it("applyChanges: a throwing (sync) or rejecting hook leaves the ChangeResult intact and warns AFTER_COMMIT_FAILED", async () => {
    const sync = make({
      write: {
        update: updateHook,
        afterCommit: () => {
          throw new Error("sync boom");
        },
      },
    });
    const res = await sync.ds.applyChanges(mixedBatch);
    expect(res.applied).toEqual([change("7", "name", "Asha", "Asha K")]);
    expect(res.versions).toEqual({ "7": 4 });
    expect(sync.warnings).toEqual([{ code: "AFTER_COMMIT_FAILED", op: "applyChanges", error: expect.objectContaining({ message: "sync boom" }) }]);

    const async = make({ write: { update: updateHook, afterCommit: async () => Promise.reject(new Error("async boom")) } });
    const res2 = await async.ds.applyChanges(mixedBatch);
    expect(res2.applied).toHaveLength(1);
    expect(async.warnings).toMatchObject([{ code: "AFTER_COMMIT_FAILED", op: "applyChanges" }]);
  });

  it("without onWarning a failing hook is reported through console.error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ds } = make({
      onWarning: undefined,
      write: { update: updateHook, afterCommit: async () => Promise.reject(new Error("no sink")) },
    });
    const res = await ds.applyChanges(mixedBatch);
    expect(res.applied).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("applyChanges: the hook is NOT called when the write throws (transaction rolled back)", async () => {
    const hook = vi.fn();
    const { ds, calls, warnings } = make({
      write: {
        update: async () => {
          throw new Error("db down");
        },
        afterCommit: hook,
      },
    });
    await expect(ds.applyChanges(mixedBatch)).rejects.toThrow("db down");
    expect(calls.at(-1)?.sql.toLowerCase()).toBe("rollback");
    expect(hook).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });

  it("createRows → { kind: 'createRows', created } with the created ids, after commit", async () => {
    const seen: SqlViewCommitOutcome[] = [];
    const { ds, calls } = make(
      {
        write: {
          create: async () => [{ id: "8" }, { id: "7" }],
          afterCommit: (_ctx, outcome) => {
            seen.push(outcome);
          },
        },
      },
      () => [ROW7, ROW8],
    );
    const created = await ds.createRows([{ cells: { name: "B" } }, { cells: { name: "A" } }]);
    expect(created.map((r) => r.id)).toEqual(["8", "7"]);
    expect(seen).toEqual([{ kind: "createRows", created }]);
    expect(calls.map((c) => c.sql.toLowerCase())).toContain("commit");
  });

  it("createRows: a hook failure does not fail the call; a failing create skips the hook", async () => {
    const hook = vi.fn(async () => Promise.reject(new Error("later")));
    const ok = make({ write: { create: async () => [{ id: "8" }], afterCommit: hook } }, () => [ROW8]);
    await expect(ok.ds.createRows([{ cells: { name: "B" } }])).resolves.toHaveLength(1);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(ok.warnings).toMatchObject([{ code: "AFTER_COMMIT_FAILED", op: "createRows" }]);

    const skipped = vi.fn();
    const bad = make({
      write: {
        create: async () => ({ errors: [{ index: 0, message: "nope" }] }),
        afterCommit: skipped,
      },
    });
    await expect(bad.ds.createRows([{ cells: { name: "B" } }])).rejects.toBeInstanceOf(RowValidationError);
    expect(skipped).not.toHaveBeenCalled();
  });

  it("deleteRows → { kind: 'deleteRows', deletedIds } (deduplicated), after commit; not on failure", async () => {
    const seen: SqlViewCommitOutcome[] = [];
    const { ds, calls } = make({
      write: {
        delete: async () => {},
        afterCommit: (_ctx, outcome) => {
          seen.push(outcome);
        },
      },
    });
    await expect(ds.deleteRows(["7", "8", "7"])).resolves.toBeUndefined();
    expect(seen).toEqual([{ kind: "deleteRows", deletedIds: ["7", "8"] }]);
    expect(calls.map((c) => c.sql.toLowerCase())).toContain("commit");

    const hook = vi.fn();
    const failing = make({
      write: {
        delete: async () => {
          throw new Error("locked");
        },
        afterCommit: hook,
      },
    });
    await expect(failing.ds.deleteRows(["7"])).rejects.toThrow("locked");
    expect(hook).not.toHaveBeenCalled();
    // Nothing to delete → no transaction → no hook.
    await failing.ds.deleteRows([]);
    expect(hook).not.toHaveBeenCalled();
  });
});
