import { describe, expect, it } from "vitest";
import { getChanges } from "../../../src/feed/get-changes";
import { CursorError } from "../../../src/errors";
import { type FakeCall, asRows, createFakeMysql } from "../../helpers/fake-mysql";
import { col, makeCtx, tables } from "../../helpers/schemas";

const ROW_ORDER = ["id", "gridId", "version", "updatedAt", "updatedBy", "deletedAt", "cells", "email_addr"];
const LOG_ORDER = ["id", "rowId"];

const schema = {
  id: "g",
  schemaVersion: 3,
  columns: [
    col("name", "text"),
    col("fee", "number"),
    col("secret", "text", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
  ],
};

const ctx = makeCtx(schema, { user: { id: "u1", roles: ["counsellor"] } });
const adminCtx = makeCtx(schema, { user: { id: "adm", roles: ["admin"] } });

const dbRow = (id: string, version: number, cells: Record<string, unknown>, deletedAt: string | null = null) => ({
  id,
  gridId: "grid1",
  version,
  updatedAt: "2026-09-24 10:00:00.000",
  updatedBy: "u9",
  deletedAt,
  cells,
  email_addr: null,
});

describe("getChanges", () => {
  it("bootstraps: empty since returns the current max log id and no rows", async () => {
    const { db } = createFakeMysql((c) => (c.rowsAsArray ? asRows([{ maxId: 42 }], ["maxId"]) : undefined));
    const result = await getChanges("", ctx, { db, tables, gridId: "grid1" });
    expect(result).toEqual({ cursor: "42", rows: [], deletedRowIds: [], schemaVersion: 3 });
  });

  it("bootstraps to cursor 0 when the grid has no change_log rows yet", async () => {
    const { db } = createFakeMysql((c) => (c.rowsAsArray ? asRows([{ maxId: null }], ["maxId"]) : undefined));
    const result = await getChanges(undefined, ctx, { db, tables, gridId: "grid1" });
    expect(result.cursor).toBe("0");
  });

  it("snapshot: log query filters by grid + id, orders by id, limits", async () => {
    const { db, statements } = createFakeMysql((c) => (c.rowsAsArray && c.sql.startsWith("select") ? [] : undefined));
    await getChanges("10", ctx, { db, tables, gridId: "grid1" });
    const [logQuery] = statements();
    expect(logQuery?.sql).toMatchInlineSnapshot(
      `"select \`id\`, \`row_id\` from \`grid_change_log\` where (\`grid_change_log\`.\`grid_id\` = ? and \`grid_change_log\`.\`id\` > ?) order by \`grid_change_log\`.\`id\` asc limit ?"`,
    );
    expect(logQuery?.params).toEqual(["grid1", 10, 1000]);
  });

  it("multiple log entries for one row yield one row, in its latest state", async () => {
    const script = (c: FakeCall) => {
      if (!c.rowsAsArray || !c.sql.startsWith("select")) return undefined;
      if (c.sql.includes("grid_change_log")) {
        return asRows(
          [
            { id: 1, rowId: "r1" },
            { id: 2, rowId: "r1" },
          ],
          LOG_ORDER,
        );
      }
      return asRows([dbRow("r1", 3, { name: "Latest" })], ROW_ORDER);
    };
    const { db } = createFakeMysql(script);
    const result = await getChanges("0", ctx, { db, tables, gridId: "grid1" });
    expect(result.cursor).toBe("2");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toBe("r1");
    expect(result.rows[0]?.cells.name).toBe("Latest");
    expect(result.deletedRowIds).toEqual([]);
  });

  it("a deleted row goes to deletedRowIds, not rows", async () => {
    const script = (c: FakeCall) => {
      if (!c.rowsAsArray || !c.sql.startsWith("select")) return undefined;
      if (c.sql.includes("grid_change_log")) return asRows([{ id: 5, rowId: "r1" }], LOG_ORDER);
      return asRows([dbRow("r1", 4, {}, "2026-09-24 12:00:00.000")], ROW_ORDER);
    };
    const { db } = createFakeMysql(script);
    const result = await getChanges("0", ctx, { db, tables, gridId: "grid1" });
    expect(result.deletedRowIds).toEqual(["r1"]);
    expect(result.rows).toEqual([]);
  });

  it("a row id in the log but missing from the rows table is treated as deleted", async () => {
    const script = (c: FakeCall) => {
      if (!c.rowsAsArray || !c.sql.startsWith("select")) return undefined;
      if (c.sql.includes("grid_change_log")) return asRows([{ id: 7, rowId: "ghost" }], LOG_ORDER);
      return [];
    };
    const { db } = createFakeMysql(script);
    const result = await getChanges("0", ctx, { db, tables, gridId: "grid1" });
    expect(result.deletedRowIds).toEqual(["ghost"]);
    expect(result.rows).toEqual([]);
  });

  it("hidden columns are stripped from the projected rows", async () => {
    const script = (c: FakeCall) => {
      if (!c.rowsAsArray || !c.sql.startsWith("select")) return undefined;
      if (c.sql.includes("grid_change_log")) return asRows([{ id: 1, rowId: "r1" }], LOG_ORDER);
      return asRows([dbRow("r1", 1, { name: "Visible", secret: "classified" })], ROW_ORDER);
    };
    const { db } = createFakeMysql(script);
    const result = await getChanges("0", ctx, { db, tables, gridId: "grid1" });
    expect(result.rows[0]?.cells).toEqual({ name: "Visible" });

    const { db: adminDb } = createFakeMysql(script);
    const adminResult = await getChanges("0", adminCtx, { db: adminDb, tables, gridId: "grid1" });
    expect(adminResult.rows[0]?.cells).toEqual({ name: "Visible", secret: "classified" });
  });

  it("the page is capped at maxEntries and the cursor stops at the last included id", async () => {
    const { db, statements } = createFakeMysql((c) => (c.rowsAsArray && c.sql.startsWith("select") ? [] : undefined));
    await getChanges("0", ctx, { db, tables, gridId: "grid1" }, { maxEntries: 2 });
    const [logQuery] = statements();
    expect(logQuery?.params).toEqual(["grid1", 0, 2]);
  });

  it("clamps an out-of-range maxEntries into 1..10000", async () => {
    const { db, statements } = createFakeMysql((c) => (c.rowsAsArray && c.sql.startsWith("select") ? [] : undefined));
    await getChanges("0", ctx, { db, tables, gridId: "grid1" }, { maxEntries: 999999 });
    expect(statements()[0]?.params).toEqual(["grid1", 0, 10000]);
  });

  it("empty page keeps the cursor unchanged", async () => {
    const { db } = createFakeMysql((c) => (c.rowsAsArray && c.sql.startsWith("select") ? [] : undefined));
    const result = await getChanges("55", ctx, { db, tables, gridId: "grid1" });
    expect(result).toEqual({ cursor: "55", rows: [], deletedRowIds: [], schemaVersion: 3 });
  });

  it("throws CursorError for a non-numeric cursor", async () => {
    const { db } = createFakeMysql();
    await expect(getChanges("not-a-number", ctx, { db, tables, gridId: "grid1" })).rejects.toBeInstanceOf(CursorError);
  });

  it("throws CursorError for a negative or unsafe cursor", async () => {
    const { db } = createFakeMysql();
    await expect(getChanges("-1", ctx, { db, tables, gridId: "grid1" })).rejects.toBeInstanceOf(CursorError);
    await expect(getChanges("99999999999999999999", ctx, { db, tables, gridId: "grid1" })).rejects.toBeInstanceOf(CursorError);
  });
});
