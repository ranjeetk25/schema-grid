import { describe, expect, it } from "vitest";
import { projectRow, projectionSql } from "../../../src/access/projection";
import { resolveAccess } from "../../../src/access/query-access";
import type { GridRow } from "../../../src/internal/core";
import { col, makeCtx, tables } from "../../helpers/schemas";
import { mockDb, renderQuery } from "../../helpers/sql";

const schema = {
  id: "g",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("salary", "number", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
    col("contactEmail", "email", { source: { valueField: "email_addr" } }),
    col("balance", "formula", { formula: "1 + 1", config: { resultType: "number" } }),
  ],
};

describe("projectionSql", () => {
  it("omits hidden keys and formula columns; includes physical columns", () => {
    const ctx = makeCtx(schema, { user: { id: "c", roles: ["counsellor"] } });
    const sel = projectionSql(schema, resolveAccess(ctx), tables);
    const q = renderQuery(mockDb().select(sel).from(tables.rows));
    expect(q.sql).toMatchInlineSnapshot(
      `"select \`id\`, \`version\`, \`updated_at\`, \`updated_by\`, \`email_addr\`, JSON_OBJECT('name', JSON_EXTRACT(\`cells\`, '$.name')) from \`grid_rows\`"`,
    );
    expect(q.sql).not.toContain("salary");
    expect(q.params).toEqual([]);
  });

  it("admin sees salary", () => {
    const ctx = makeCtx(schema);
    const q = renderQuery(mockDb().select(projectionSql(schema, resolveAccess(ctx), tables)).from(tables.rows));
    expect(q.sql).toContain("'salary', JSON_EXTRACT(`cells`, '$.salary')");
  });
});

describe("projectRow", () => {
  it("removes hidden and unknown keys even if SQL projection were bypassed", () => {
    const ctx = makeCtx(schema, { user: { id: "c", roles: ["counsellor"] } });
    const row: GridRow = { id: "r", version: 1, updatedAt: "x", cells: { name: "A", salary: 10, stray: 1, balance: 2 } };
    expect(projectRow(row, schema, resolveAccess(ctx)).cells).toEqual({ name: "A", balance: 2 });
    expect(row.cells.salary).toBe(10);
  });
});
