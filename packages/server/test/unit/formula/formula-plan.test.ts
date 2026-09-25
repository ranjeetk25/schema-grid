import { describe, expect, it } from "vitest";
import { formulaGeneratedSql, planFormulaColumns } from "../../../src/formula/formula-plan";
import type { GridSchema } from "../../../src/internal/core";
import { col, column, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const schema: GridSchema = {
  id: "grid_plan",
  schemaVersion: 1,
  columns: [
    col("fee", "currency"),
    col("discount", "number"),
    col("a", "number"),
    col("name", "text"),
    col("total", "formula", { formula: "{fee} * 2 + {discount}", indexed: true, config: { resultType: "number" } }),
    col("net", "formula", { formula: "{fee} - {discount}", config: { resultType: "number" } }),
    col("band", "formula", { formula: "IF({fee} > 1000, \"it's high\", \"low\")", indexed: true, config: { resultType: "text" } }),
    col("big", "formula", { formula: "{fee} > 1000", config: { resultType: "boolean" } }),
    col("label", "formula", { formula: 'CONCAT({name}, "x")', config: { resultType: "text" } }),
    col("today", "formula", { formula: "TODAY()", config: { resultType: "date" } }),
    col("textPlus", "formula", { formula: '{name} + "x"', config: { resultType: "text" } }),
    col("broken", "formula", { formula: "{fee} +", config: { resultType: "number" } }),
    col("nested", "formula", { formula: "{net} * 2", config: { resultType: "number" } }),
    col("cycA", "formula", { formula: "{cycB} + 1", config: { resultType: "number" } }),
    col("cycB", "formula", { formula: "{cycA} + 1", config: { resultType: "number" } }),
  ],
};
const { formulaPlans: _omit, ...scope } = makeScope(makeCtx(schema));

describe("planFormulaColumns", () => {
  const plans = planFormulaColumns(scope);

  it("plans every formula column and nothing else", () => {
    expect([...plans.keys()].sort()).toEqual(
      ["band", "big", "broken", "cycA", "cycB", "label", "nested", "net", "textPlus", "today", "total"].sort(),
    );
  });

  it("indexed translatable → generated; not indexed → inline", () => {
    expect(plans.get("total")?.mode).toBe("generated");
    expect(plans.get("band")?.mode).toBe("generated");
    expect(plans.get("net")?.mode).toBe("inline");
    expect(plans.get("big")?.mode).toBe("inline");
    expect(plans.get("nested")?.mode).toBe("inline");
  });

  it("untranslatable, unparsable and cyclic formulas fall back without sql", () => {
    for (const id of ["label", "today", "textPlus", "broken", "cycA", "cycB"]) {
      const p = plans.get(id);
      expect(p?.mode, id).toBe("fallback");
      expect(p?.sql, id).toBeUndefined();
    }
  });

  it("resultKind follows config.resultType", () => {
    expect(plans.get("total")?.resultKind).toBe("number");
    expect(plans.get("band")?.resultKind).toBe("text");
    expect(plans.get("big")?.resultKind).toBe("boolean");
    expect(plans.get("today")?.resultKind).toBe("datetime");
  });

  it("number results are wrapped in the DECIMAL cast", () => {
    const r = renderSql(plans.get("total")?.sql as never);
    expect(r.sql).toMatchInlineSnapshot(
      `"CAST((((COALESCE((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END), 0) * ?) + COALESCE((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.discount')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.discount') AS DECIMAL(38,10)) END), 0))) AS DECIMAL(38,10))"`,
    );
    expect(r.params).toEqual([2]);
  });

  it("text and boolean results are parenthesized", () => {
    expect(renderSql(plans.get("band")?.sql as never).sql.startsWith("((CASE WHEN")).toBe(true);
    expect(renderSql(plans.get("big")?.sql as never).sql.startsWith("(((CASE WHEN")).toBe(true);
  });
});

describe("formulaGeneratedSql", () => {
  it("renders the same expression as the plan, with literals inlined and zero params", () => {
    const ddl = formulaGeneratedSql(column(schema, "total"), scope);
    expect(ddl).not.toBeNull();
    const r = renderSql(ddl as never);
    expect(r.params).toEqual([]);
    const planned = renderSql(planFormulaColumns(scope).get("total")?.sql as never);
    expect(r.sql).toBe(planned.sql.replace("?", "2"));
  });

  it("escapes single quotes in string literals", () => {
    const r = renderSql(formulaGeneratedSql(column(schema, "band"), scope) as never);
    expect(r.params).toEqual([]);
    expect(r.sql).toContain("THEN 'it''s high' ELSE 'low' END");
  });

  it("returns null for untranslatable or non-formula columns", () => {
    expect(formulaGeneratedSql(column(schema, "label"), scope)).toBeNull();
    expect(formulaGeneratedSql(column(schema, "fee"), scope)).toBeNull();
  });
});
