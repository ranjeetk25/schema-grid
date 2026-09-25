import { describe, expect, it } from "vitest";
import { createRows, deleteRows } from "../../../src/changes/rows-crud";
import { uuidv7 } from "../../../src/changes/uuid";
import { PermissionError, RowValidationError } from "../../../src/errors";
import { type FakeCall, asRows, createFakeMysql } from "../../helpers/fake-mysql";
import { OPTIONS, col, makeCtx, tables } from "../../helpers/schemas";

const schema = {
  id: "g",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("fee", "number", { defaultValue: 100 }),
    col("isActive", "boolean"),
    col("tags", "multiSelect", { config: OPTIONS }),
    col("contactEmail", "email", { source: { valueField: "email_addr" } }),
    col("balance", "formula", { formula: "{fee} * 2", config: { resultType: "number" } }),
    col("secret", "text", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
  ],
};
const NOW = new Date("2026-09-25T06:00:00.000Z");
const ctx = makeCtx(schema, { user: { id: "u1", roles: ["counsellor"] }, now: NOW });

describe("uuidv7", () => {
  it("is a v7 uuid and time-ordered", () => {
    const a = uuidv7(1000);
    const b = uuidv7(2000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe("createRows", () => {
  it("inserts with defaults at version 1 and logs create per row", async () => {
    const { db, statements } = createFakeMysql();
    const rows = await createRows(
      [{ id: "n1", cells: { name: "Asha", contactEmail: "a@b.co" } }, { cells: {} }],
      ctx,
      { db, tables, gridId: "grid1" },
      { generateId: () => "gen-1" },
    );
    const [insert, log] = statements() as [FakeCall, FakeCall];
    expect(insert.sql).toMatchInlineSnapshot(
      `"insert into \`grid_rows\` (\`id\`, \`grid_id\`, \`version\`, \`updated_at\`, \`updated_by\`, \`deleted_at\`, \`cells\`, \`email_addr\`) values (?, ?, ?, ?, ?, default, ?, ?), (?, ?, ?, ?, ?, default, ?, ?)"`,
    );
    expect(insert.params).toEqual([
      "n1", "grid1", 1, "2026-09-25 06:00:00.000", "u1", '{"name":"Asha","fee":100,"isActive":false}', "a@b.co",
      "gen-1", "grid1", 1, "2026-09-25 06:00:00.000", "u1", '{"fee":100,"isActive":false}', null,
    ]);
    expect(log.sql).toContain("`grid_change_log`");
    expect(log.params.filter((p) => p === "create")).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(["n1", "gen-1"]);
    expect(rows[0]).toMatchObject({ version: 1, cells: { name: "Asha", fee: 100, isActive: false, contactEmail: "a@b.co" } });
    expect(rows[0]?.cells).not.toHaveProperty("secret");
  });

  it("invalid values, formula values, unknown keys and non-editable columns throw before writing", async () => {
    const { db, calls } = createFakeMysql();
    const deps = { db, tables, gridId: "grid1" };
    const err = await createRows([{ cells: { name: "ok" } }, { cells: { fee: "abc" } }], ctx, deps).catch((e) => e);
    expect(err).toBeInstanceOf(RowValidationError);
    expect(err.details).toMatchObject({ rowIndex: 1, columnId: "fee" });
    await expect(createRows([{ cells: { balance: 3 } }], ctx, deps)).rejects.toBeInstanceOf(RowValidationError);
    await expect(createRows([{ cells: { nope: 3 } }], ctx, deps)).rejects.toBeInstanceOf(RowValidationError);
    await expect(createRows([{ cells: { secret: "x" } }], ctx, deps)).rejects.toThrow(/read-only/);
    expect(calls).toHaveLength(0);
  });
});

describe("deleteRows", () => {
  it("soft-deletes live rows, bumps version, logs one entry per row, skips unknown/deleted", async () => {
    const { db, statements } = createFakeMysql((c) => (c.rowsAsArray ? asRows([{ id: "r1" }, { id: "r2" }], ["id"]) : undefined));
    await deleteRows(["r1", "r2", "gone", "r1"], ctx, { db, tables, gridId: "grid1" });
    const [sel, upd, log] = statements() as [FakeCall, FakeCall, FakeCall];
    expect(sel.params).toEqual(["grid1", "r1", "r2", "gone"]);
    expect(upd.sql).toMatchInlineSnapshot(
      `"update \`grid_rows\` set \`version\` = \`version\` + 1, \`updated_at\` = ?, \`updated_by\` = ?, \`deleted_at\` = ? where (\`grid_rows\`.\`grid_id\` = ? and \`grid_rows\`.\`id\` in (?, ?) and \`grid_rows\`.\`deleted_at\` is null)"`,
    );
    expect(upd.params).toEqual(["2026-09-25 06:00:00.000", "u1", "2026-09-25 06:00:00.000", "grid1", "r1", "r2"]);
    expect(log.params.filter((p) => p === "delete")).toHaveLength(2);
  });

  it("no live rows → no update, no log", async () => {
    const { db, statements } = createFakeMysql((c) => (c.rowsAsArray ? [] : undefined));
    await deleteRows(["x"], ctx, { db, tables, gridId: "grid1" });
    expect(statements()).toHaveLength(1);
  });

  it("a denying canDeleteRows hook throws PermissionError(edit)", async () => {
    const { db } = createFakeMysql();
    const err = await deleteRows(["r1"], ctx, { db, tables, gridId: "grid1" }, { canDeleteRows: () => false }).catch((e) => e);
    expect(err).toBeInstanceOf(PermissionError);
    expect(err.details.usage).toBe("edit");
  });
});
