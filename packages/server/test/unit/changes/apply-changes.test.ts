import { describe, expect, it } from "vitest";
import { applyChanges, buildRowUpdate } from "../../../src/changes/apply-changes";
import type { RowWritePlan } from "../../../src/changes/plan-changes";
import type { ChangeBatch } from "../../../src/internal/core";
import { type FakeCall, asRows, createFakeMysql } from "../../helpers/fake-mysql";
import { col, makeCtx, tables } from "../../helpers/schemas";
import { mockDb, renderQuery } from "../../helpers/sql";

const schema = {
  id: "g",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("fee", "number"),
    col("contactEmail", "email", { source: { valueField: "email_addr" } }),
    col("notes", "text"),
    col("secret", "text", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
  ],
};
const NOW = new Date("2026-09-25T06:00:00.000Z");
const ctx = makeCtx(schema, { user: { id: "u1", roles: ["counsellor"] }, now: NOW });
const ORDER = ["id", "gridId", "version", "updatedAt", "updatedBy", "deletedAt", "cells", "email_addr"];
const dbRow = (id: string, version: number, cells: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  gridId: "grid1",
  version,
  updatedAt: "2026-09-24 10:00:00.000",
  updatedBy: "u9",
  deletedAt: null,
  cells,
  email_addr: null,
  ...extra,
});

describe("buildRowUpdate", () => {
  it("snapshot: two JSON cells, one physical cell, one emptied cell; version bumped once", () => {
    const [name, fee, email, notes] = schema.columns;
    if (!name || !fee || !email || !notes) throw new Error("expected all four fixture columns to be defined");
    const plan: RowWritePlan = {
      rowId: "r1",
      baseVersion: 3,
      sets: [
        { column: name, next: "Asha", serialized: "Asha", prev: "A", remove: false },
        { column: fee, next: 12.5, serialized: 12.5, prev: 1, remove: false },
        { column: email, next: "a@b.co", serialized: "a@b.co", prev: null, remove: false },
        { column: notes, next: null, serialized: null, prev: "x", remove: true },
      ],
    };
    const q = renderQuery(buildRowUpdate(plan, ctx, { db: mockDb(), tables, gridId: "grid1" }, NOW));
    expect(q.sql).toMatchInlineSnapshot(
      `"update \`grid_rows\` set \`version\` = \`version\` + 1, \`updated_at\` = ?, \`updated_by\` = ?, \`cells\` = JSON_REMOVE(JSON_SET(COALESCE(\`cells\`, JSON_OBJECT()), '$.name', CAST(? AS JSON), '$.fee', CAST(? AS JSON)), '$.notes'), \`email_addr\` = ? where (\`grid_rows\`.\`id\` = ? and \`grid_rows\`.\`grid_id\` = ? and \`grid_rows\`.\`version\` = ? and \`grid_rows\`.\`deleted_at\` is null)"`,
    );
    expect(q.params).toEqual(["2026-09-25 06:00:00.000", "u1", '"Asha"', "12.5", "a@b.co", "r1", "grid1", 3]);
    expect(q.sql.match(/`version` \+ 1/g)).toHaveLength(1);
  });
});

describe("applyChanges", () => {
  const batch = (changes: ChangeBatch["changes"], baseVersions: Record<string, number>): ChangeBatch => ({
    id: "batch-1",
    changes,
    baseVersions,
    source: "edit",
  });
  const ch = (rowId: string, columnId: string, next: unknown) => ({ rowId, columnId, prev: null, next });

  function script(state: Record<string, ReturnType<typeof dbRow>>, conflictRows: Set<string>) {
    return (c: FakeCall) => {
      if (c.rowsAsArray && c.sql.startsWith("select")) {
        const ids = c.params.filter((p): p is string => typeof p === "string" && p in state);
        return asRows(ids.map((id) => state[id] as Record<string, unknown>), ORDER);
      }
      if (c.sql.startsWith("update")) {
        const id = c.params.find((p) => typeof p === "string" && p in state) as string;
        return { affectedRows: conflictRows.has(id) ? 0 : 1 };
      }
      return undefined;
    };
  }

  it("mixed batch: A applied, B conflicts with server state, C errors; log only for A", async () => {
    const state = {
      rA: dbRow("rA", 1, { name: "Old", fee: 1 }),
      rB: dbRow("rB", 2, { name: "Theirs", secret: "s" }, { updatedBy: "u2" }),
      rC: dbRow("rC", 1, {}),
    };
    const { db, statements } = createFakeMysql(script(state, new Set(["rB"])));
    const result = await applyChanges(
      batch(
        [ch("rA", "name", "New"), ch("rA", "fee", 5), ch("rB", "name", "Mine"), ch("rC", "fee", "abc")],
        { rA: 1, rB: 1, rC: 1 },
      ),
      ctx,
      { db, tables, gridId: "grid1" },
    );
    expect(result.applied).toEqual([
      { rowId: "rA", columnId: "name", prev: "Old", next: "New" },
      { rowId: "rA", columnId: "fee", prev: 1, next: 5 },
    ]);
    expect(result.conflicts).toEqual([
      {
        rowId: "rB",
        columnId: "name",
        serverValue: "Theirs",
        serverVersion: 2,
        updatedBy: { id: "u2" },
        updatedAt: "2026-09-24T10:00:00.000Z",
      },
    ]);
    expect(result.errors).toEqual([{ rowId: "rC", columnId: "fee", message: expect.any(String) }]);

    const updates = statements().filter((s) => s.sql.startsWith("update"));
    // one UPDATE for A (two cells, one version bump); B's locked version already mismatches → no UPDATE
    expect(updates).toHaveLength(1);
    expect(updates[0]?.sql.match(/`version` \+ 1/g)).toHaveLength(1);
    const lockRead = statements()[0] as FakeCall;
    expect(lockRead.sql).toMatch(/order by `grid_rows`.`id` for update$/);

    const inserts = statements().filter((s) => s.sql.startsWith("insert"));
    expect(inserts).toHaveLength(1);
    const insert = inserts[0] as FakeCall;
    expect(insert.sql).toContain("`grid_change_log`");
    // two log rows, both for rA, with actor + batch id
    expect(insert.params.filter((p) => p === "rA")).toHaveLength(2);
    expect(insert.params).not.toContain("rB");
    expect(insert.params.filter((p) => p === "batch-1")).toHaveLength(2);
    expect(insert.params.filter((p) => p === "u1")).toHaveLength(2);
  });

  it("affectedRows 0 (backstop) is a conflict, not an error; nothing logged", async () => {
    const state = { r1: dbRow("r1", 1, { name: "Server" }) };
    const { db, statements } = createFakeMysql(script(state, new Set(["r1"])));
    const result = await applyChanges(batch([ch("r1", "name", "Client")], { r1: 1 }), ctx, { db, tables, gridId: "grid1" });
    expect(result.applied).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ serverValue: "Server", serverVersion: 1 });
    expect(statements().some((s) => s.sql.startsWith("insert"))).toBe(false);
  });

  it("version mismatch on the locked row is a conflict without an UPDATE", async () => {
    const state = { r1: dbRow("r1", 2, { name: "Server" }) };
    const { db, statements } = createFakeMysql(script(state, new Set()));
    const result = await applyChanges(batch([ch("r1", "name", "Client")], { r1: 1 }), ctx, { db, tables, gridId: "grid1" });
    expect(result).toMatchObject({ applied: [], errors: [], conflicts: [{ serverValue: "Server", serverVersion: 2 }] });
    expect(statements().some((s) => s.sql.startsWith("update"))).toBe(false);
  });

  it("rejects an oversized batch id before touching the database", async () => {
    const { db, calls } = createFakeMysql();
    await expect(
      applyChanges({ ...batch([], {}), id: "x".repeat(65) }, ctx, { db, tables, gridId: "grid1" }),
    ).rejects.toMatchObject({ code: "INVALID_BATCH" });
    expect(calls).toHaveLength(0);
  });

  it("unknown driver result shape throws instead of reporting a false conflict", async () => {
    const { affectedRowsOf } = await import("../../../src/changes/db");
    expect(affectedRowsOf([{ affectedRows: 1 }])).toBe(1);
    expect(affectedRowsOf({ rowsAffected: 2 })).toBe(2);
    expect(() => affectedRowsOf({})).toThrow();
  });

  it("conflict carries the readable server value for the edited column", async () => {
    const adminCtx = makeCtx(schema, { user: { id: "adm", roles: ["admin"] }, now: NOW });
    const state = { r1: dbRow("r1", 5, { secret: "classified" }) };
    const { db } = createFakeMysql(script(state, new Set(["r1"])));
    const res = await applyChanges(batch([ch("r1", "secret", "x")], { r1: 4 }), adminCtx, { db, tables, gridId: "grid1" });
    expect(res.conflicts[0]?.serverValue).toBe("classified");
  });

  it("commits the transaction and runs no writes for an all-error batch", async () => {
    const state = { r1: dbRow("r1", 1, {}) };
    const { db, calls } = createFakeMysql(script(state, new Set()));
    const res = await applyChanges(batch([ch("r1", "secret", "x")], { r1: 1 }), ctx, { db, tables, gridId: "grid1" });
    expect(res.errors).toHaveLength(1);
    expect(calls.map((c) => c.sql.split(" ")[0])).toEqual(["begin", "select", "commit"]);
  });
});

describe("physical column writes", () => {
  it("an undeclared valueField is a schema error, never silently dropped", async () => {
    const { physicalWriteValue } = await import("../../../src/changes/physical");
    const { SchemaValidationError } = await import("../../../src/errors");
    expect(() => physicalWriteValue(col("x", "text", { source: { valueField: "version" } }), "v", tables)).toThrow(
      SchemaValidationError,
    );
  });
  it("datetime values go to non-datetime physical columns as UTC strings", async () => {
    const { physicalWriteValue } = await import("../../../src/changes/physical");
    const c = col("seen", "datetime", { source: { valueField: "email_addr" } });
    expect(physicalWriteValue(c, "2026-09-24T19:00:00.000Z", tables)).toEqual({
      field: "email_addr",
      value: "2026-09-24 19:00:00.000",
    });
  });
});
