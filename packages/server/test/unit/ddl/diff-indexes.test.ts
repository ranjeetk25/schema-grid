import { describe, expect, it } from "vitest";
import { diffIndexedColumns } from "../../../src/ddl/diff-indexes";
import { formulaSqlHook } from "../../../src/ddl/generated-columns";
import type { GridSchema } from "../../../src/internal/core";
import { col, makeCtx, makeScope } from "../../helpers/schemas";

const TABLE = "grid_rows";

function schemaOf(columns: GridSchema["columns"]): GridSchema {
  return { id: "grid_diff", schemaVersion: 1, columns };
}

describe("diffIndexedColumns", () => {
  it("returns [] for an unchanged schema", () => {
    const schema = schemaOf([col("amount", "number", { indexed: true }), col("name", "text")]);
    expect(diffIndexedColumns(schema, schemaOf([...schema.columns]), TABLE)).toEqual([]);
  });

  it("adds one statement when indexed is turned on", () => {
    const prev = schemaOf([col("amount", "number")]);
    const next = schemaOf([col("amount", "number", { indexed: true })]);
    const stmts = diffIndexedColumns(prev, next, TABLE);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]?.sql).toContain("ADD COLUMN `gc_amount`");
  });

  it("drops one statement when indexed is turned off", () => {
    const prev = schemaOf([col("amount", "number", { indexed: true })]);
    const next = schemaOf([col("amount", "number")]);
    const stmts = diffIndexedColumns(prev, next, TABLE);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]?.sql).toContain("DROP INDEX `idx_gc_amount`");
  });

  it("drops one statement when an indexed column is removed entirely", () => {
    const prev = schemaOf([col("amount", "number", { indexed: true })]);
    const next = schemaOf([]);
    const stmts = diffIndexedColumns(prev, next, TABLE);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]?.sql).toContain("DROP COLUMN `gc_amount`");
  });

  it("renames: drops the old key then adds the new one", () => {
    const prev = schemaOf([col("c1", "number", { key: "amount", indexed: true })]);
    const next = schemaOf([col("c1", "number", { key: "amount2", indexed: true })]);
    const stmts = diffIndexedColumns(prev, next, TABLE);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]?.sql).toContain("DROP COLUMN `gc_amount`");
    expect(stmts[1]?.sql).toContain("ADD COLUMN `gc_amount2`");
  });

  it("drops then adds when the formula changes for an indexed formula column", () => {
    const prevSchema = schemaOf([
      col("fee", "number"),
      col("calc", "formula", { formula: "{fee} * 2", config: { resultType: "number" }, indexed: true }),
    ]);
    const nextSchema = schemaOf([
      col("fee", "number"),
      col("calc", "formula", { formula: "{fee} * 3", config: { resultType: "number" }, indexed: true }),
    ]);
    const options = { formulaSql: formulaSqlHook(makeScope(makeCtx(nextSchema))) };
    const stmts = diffIndexedColumns(prevSchema, nextSchema, TABLE, options);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]?.sql).toContain("DROP COLUMN `gc_calc`");
    expect(stmts[1]?.sql).toContain("ADD COLUMN `gc_calc`");
  });

  it("orders all drops before all adds in a mixed diff", () => {
    const prev = schemaOf([
      col("removed", "number", { indexed: true }), // dropped: removed
      col("turnedOff", "number", { indexed: true }), // dropped: no longer indexed
      col("renamed", "number", { key: "oldKey", indexed: true }), // drop + add
      col("stable", "number", { indexed: true }), // unchanged
    ]);
    const next = schemaOf([
      col("turnedOff", "number"),
      col("renamed", "number", { key: "newKey", indexed: true }),
      col("stable", "number", { indexed: true }),
      col("turnedOn", "text", { indexed: true }), // added: newly indexed
    ]);
    const stmts = diffIndexedColumns(prev, next, TABLE);
    expect(stmts).toHaveLength(5);
    const dropIdx = stmts.map((s, i) => (s.sql.includes("DROP INDEX") ? i : -1)).filter((i) => i >= 0);
    const addIdx = stmts.map((s, i) => (s.sql.includes("ADD COLUMN") && s.sql.includes("GENERATED") ? i : -1)).filter((i) => i >= 0);
    expect(Math.max(...dropIdx)).toBeLessThan(Math.min(...addIdx));
    expect(dropIdx).toHaveLength(3); // removed, turnedOff, renamed's old key
    // renamed contributes one drop + one add; turnedOn contributes one add.
    const allSql = stmts.map((s) => s.sql).join("\n");
    expect(allSql).toContain("DROP COLUMN `gc_removed`");
    expect(allSql).toContain("DROP INDEX `idx_gc_turnedOff`");
    expect(allSql).toContain("DROP COLUMN `gc_oldKey`");
    expect(allSql).toContain("ADD COLUMN `gc_newKey`");
    expect(allSql).toContain("ADD COLUMN `gc_turnedOn`");
    expect(allSql).not.toContain("gc_stable");
  });

  it("adds for every indexed column when prev is null", () => {
    const next = schemaOf([col("amount", "number", { indexed: true }), col("name", "text")]);
    const stmts = diffIndexedColumns(null, next, TABLE);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]?.sql).toContain("ADD COLUMN `gc_amount`");
  });
});
