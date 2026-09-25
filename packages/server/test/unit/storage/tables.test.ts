import { varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { defineGridTables } from "../../../src/storage/tables";
import { mockDb, renderQuery } from "../../helpers/sql";

describe("defineGridTables", () => {
  it("selects the fixed row columns", () => {
    const t = defineGridTables({ rowsTable: "grid_rows", changeLogTable: "grid_change_log" });
    const q = renderQuery(mockDb().select().from(t.rows));
    expect(q).toMatchInlineSnapshot(`
      {
        "params": [],
        "sql": "select \`id\`, \`grid_id\`, \`version\`, \`updated_at\`, \`updated_by\`, \`deleted_at\`, \`cells\` from \`grid_rows\`",
      }
    `);
  });

  it("includes physical columns and exposes them by valueField", () => {
    const t = defineGridTables({
      rowsTable: "grid_rows",
      changeLogTable: "grid_change_log",
      physicalColumns: { email_addr: varchar("email_addr", { length: 191 }) },
    });
    expect(Object.keys(t.physical)).toEqual(["email_addr"]);
    const q = renderQuery(mockDb().select().from(t.rows));
    expect(q.sql).toContain("`email_addr`");
  });

  it("change log columns", () => {
    const t = defineGridTables({ rowsTable: "grid_rows", changeLogTable: "grid_change_log" });
    const q = renderQuery(mockDb().select().from(t.changeLog));
    expect(q.sql).toBe(
      "select `id`, `grid_id`, `row_id`, `column_id`, `kind`, `prev`, `next`, `actor`, `at`, `batch_id` from `grid_change_log`",
    );
  });

  it("rejects unsafe table names and reserved physical names", () => {
    expect(() => defineGridTables({ rowsTable: "a;b", changeLogTable: "c" })).toThrow();
    expect(() =>
      defineGridTables({ rowsTable: "a", changeLogTable: "c", physicalColumns: { cells: varchar("cells", { length: 1 }) } }),
    ).toThrow();
  });
});
