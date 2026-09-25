import { describe, expect, it } from "vitest";
import { formulaToSql } from "../../../src/formula/formula-to-sql";
import { type FormulaNode, type GridSchema, isFormulaError, parseFormula } from "../../../src/internal/core";
import { col, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const schema: GridSchema = {
  id: "grid_formula",
  schemaVersion: 1,
  columns: [
    col("fee", "currency"),
    col("discount", "number"),
    col("a", "number"),
    col("name", "text"),
    col("status", "select"),
    col("isActive", "boolean"),
    col("callDate", "date"),
    col("owner", "user"),
    col("tags", "multiSelect"),
    col("net", "formula", { formula: "{fee} - {discount}", config: { resultType: "number" } }),
    col("cycA", "formula", { formula: "{cycB} + 1", config: { resultType: "number" } }),
    col("cycB", "formula", { formula: "{cycA} + 1", config: { resultType: "number" } }),
  ],
};
const scope = makeScope(makeCtx(schema));

function ast(src: string): FormulaNode {
  const parsed = parseFormula(src);
  if (isFormulaError(parsed)) throw new Error(parsed.message);
  return parsed;
}
const render = (src: string, opts?: { inlineLiterals?: boolean }) => {
  const out = formulaToSql(ast(src), scope, opts);
  return out ? renderSql(out) : null;
};

describe("formulaToSql — translatable subset", () => {
  it("arithmetic on currency/number refs with DECIMAL casts and COALESCE(…, 0)", () => {
    const r = render("{fee} * 2 + {discount}");
    expect(r?.sql).toMatchInlineSnapshot(
      `"((COALESCE((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END), 0) * ?) + COALESCE((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.discount')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.discount') AS DECIMAL(38,10)) END), 0))"`,
    );
    expect(r?.params).toEqual([2]);
  });

  it("IF becomes CASE WHEN with bound literals", () => {
    const r = render('IF({fee} > 1000, "high", "low")');
    expect(r?.sql).toMatchInlineSnapshot(
      `"(CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) > ?) THEN ? ELSE ? END)"`,
    );
    expect(r?.params).toEqual([1000, "high", "low"]);
  });

  it("IF without else yields NULL", () => {
    expect(render("IF({a} > 1, 5)")?.sql).toContain("ELSE NULL END");
  });

  it("COALESCE translates", () => {
    const r = render("COALESCE({a}, 0)");
    expect(r?.sql).toMatchInlineSnapshot(`"COALESCE((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.a')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.a') AS DECIMAL(38,10)) END), ?)"`);
    expect(r?.params).toEqual([0]);
  });

  it("% becomes MOD and != renders as <>", () => {
    expect(render("{a} % 3")?.sql).toContain("MOD(");
    expect(render("{a} != 3")?.sql).toContain(" <> ");
  });

  it("logical and unary operators", () => {
    const r = render("!({a} > 1) && ({fee} < 2 || -{a} = 3)");
    expect(r?.sql).toContain(" AND ");
    expect(r?.sql).toContain(" OR ");
    expect(r?.sql).toContain("(NOT ");
    expect(r?.sql).toContain("(-COALESCE(");
    expect(r?.params).toEqual([1, 2, 3]);
  });

  it("text comparison and select refs translate", () => {
    const r = render('{name} = "Bob" && {status} = "paid"');
    expect(r?.sql).toContain("IF(JSON_TYPE(JSON_EXTRACT(`cells`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(`cells`, '$.name'))) COLLATE utf8mb4_0900_ai_ci");
    expect(r?.params).toEqual(["Bob", "paid"]);
  });

  it("IS_EMPTY on a ref uses the column empty predicate", () => {
    expect(render("IS_EMPTY({name})")?.sql).toContain("JSON_TYPE(");
  });

  it("inlines another translatable formula column", () => {
    const r = render("{net} * 2");
    expect(r?.sql).toContain("'$.fee'");
    expect(r?.sql).toContain("'$.discount'");
    expect(r?.params).toEqual([2]);
  });

  it("formula cycle returns null without overflowing", () => {
    expect(render("{cycA}")).toBeNull();
    expect(formulaToSql(ast("{cycB} + 1"), scope, { visiting: new Set(["cycA"]) })).toBeNull();
  });

  it("division by zero still translates", () => {
    // MySQL returns NULL for `x / 0` and `MOD(x, 0)` natively; core `evaluate`
    // also yields null for ÷0. Parity between the two is asserted in T25.
    const r = render("{a} / 0");
    expect(r?.sql).toMatchInlineSnapshot(`"(COALESCE((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.a')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.a') AS DECIMAL(38,10)) END), 0) / ?)"`);
    expect(r?.params).toEqual([0]);
  });
});

describe("formulaToSql — untranslatable → null", () => {
  it.each([
    ['CONCAT({name}, "x")'],
    ["TODAY()"],
    ["NOW()"],
    ['DATEADD({callDate}, 1, "days")'],
    ['{name} + "x"'],
    ["{callDate}"],
    ["{isActive}"],
    ["{owner}"],
    ["{tags}"],
    ["{missing} + 1"],
    ['IF("x", 1, 2)'],
  ])("%s", (src) => {
    expect(formulaToSql(ast(src), scope)).toBeNull();
  });
});

describe("formulaToSql — inlineLiterals (DDL)", () => {
  it("inlines numbers and escapes strings, binding zero params", () => {
    const r = render(`IF({fee} > 1000.5, "it's \\\\ high", "low")`, { inlineLiterals: true });
    expect(r?.params).toEqual([]);
    expect(r?.sql).toContain("> 1000.5)");
    expect(r?.sql).toContain(String.raw`'it''s \\ high'`);
    expect(r?.sql).toContain("ELSE 'low' END");
  });
});
