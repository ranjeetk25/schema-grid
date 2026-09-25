import { describe, expect, it } from "vitest";
import { dependencies } from "../../src/formula/dependencies";
import { columnTypeToFormulaType, inferResultType } from "../../src/formula/infer";
import { parseFormula } from "../../src/formula/parser";
import type { FormulaNode } from "../../src/formula/types";
import { isFormulaError } from "../../src/formula/types";
import type { ColumnDef, GridSchema } from "../../src/schema/types";
import { createFixtureSchema } from "../../src/testing/schema";

const schema = createFixtureSchema();

function ast(src: string): FormulaNode {
  const node = parseFormula(src);
  if (isFormulaError(node)) throw new Error(`parse failed: ${node.message}`);
  return node;
}

function infer(src: string, s: GridSchema = schema): unknown {
  return inferResultType(ast(src), s);
}

function column(key: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef {
  return {
    id: `col_${key}`,
    key,
    label: key,
    type,
    config: {},
    order: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  };
}

function schemaOf(...columns: ColumnDef[]): GridSchema {
  return { id: "s", schemaVersion: 1, columns };
}

describe("columnTypeToFormulaType", () => {
  it("maps field types to formula result types", () => {
    expect(columnTypeToFormulaType(column("a", "number"))).toBe("number");
    expect(columnTypeToFormulaType(column("a", "currency"))).toBe("number");
    expect(columnTypeToFormulaType(column("a", "boolean"))).toBe("boolean");
    expect(columnTypeToFormulaType(column("a", "date"))).toBe("date");
    expect(columnTypeToFormulaType(column("a", "datetime"))).toBe("date");
    for (const t of ["text", "longText", "select", "multiSelect", "creatableSelect", "user", "url", "email", "phone", "link", "custom"]) {
      expect(columnTypeToFormulaType(column("a", t))).toBe("text");
    }
  });

  it("uses config.resultType for formula columns (text when missing/invalid)", () => {
    expect(columnTypeToFormulaType(column("a", "formula", { config: { resultType: "date" } }))).toBe("date");
    expect(columnTypeToFormulaType(column("a", "formula", { config: { resultType: "bogus" } }))).toBe("text");
    expect(columnTypeToFormulaType(column("a", "formula", { config: null }))).toBe("text");
  });
});

describe("inferResultType", () => {
  it("{fee} - {paid} (currency - number) infers number", () => {
    expect(infer("{fee} - {paid}")).toBe("number");
  });

  it('IF(IS_EMPTY({status}), "none", {status}) with a select status infers text', () => {
    expect(infer('IF(IS_EMPTY({status}), "none", {status})')).toBe("text");
  });

  it("infers comparisons, CONCAT and DATEADD", () => {
    expect(infer("{fee} > 1000")).toBe("boolean");
    expect(infer('CONCAT({name}, " ", {fee})')).toBe("text");
    expect(infer('DATEADD({callDate}, 7, "days")')).toBe("date");
  });

  it("{name} * 2 gives a type error spanning the offending operand", () => {
    const r = infer("{name} * 2");
    expect(r).toMatchObject({ kind: "formulaError", code: "type", start: 0, end: 6 });
  });

  it("type error spans the right operand when it is the offender", () => {
    expect(infer("2 * {name}")).toMatchObject({ code: "type", start: 4, end: 10 });
  });

  it("{missing} + 1 gives unknownColumn with columnKey", () => {
    expect(infer("{missing} + 1")).toMatchObject({ code: "unknownColumn", columnKey: "missing", start: 0, end: 9 });
  });

  it("FOO(1) gives unknownFunction; NOT(1, 2) gives arity", () => {
    expect(infer("FOO(1)")).toMatchObject({ code: "unknownFunction", start: 0, end: 6 });
    expect(infer("NOT(1, 2)")).toMatchObject({ code: "arity", start: 0, end: 9 });
  });

  it("function argument type errors carry the call span", () => {
    expect(infer("1 + ABS({name})")).toMatchObject({ code: "type", start: 4, end: 15 });
  });

  it("infers through another formula column (balance)", () => {
    expect(infer("{balance} * 2")).toBe("number");
    expect(infer("{balance} > 0")).toBe("boolean");
  });

  it("infers a referenced formula from its source, not its config.resultType", () => {
    const s = schemaOf(
      column("n", "text"),
      column("f", "formula", { config: { resultType: "number" }, formula: "UPPER({n})" }),
    );
    expect(inferResultType(ast("{f}"), s)).toBe("text");
  });

  it("falls back to config.resultType when the referenced formula is missing or unparseable", () => {
    const s = schemaOf(
      column("f", "formula", { config: { resultType: "date" } }),
      column("g", "formula", { config: { resultType: "boolean" }, formula: "1 +" }),
    );
    expect(inferResultType(ast("{f}"), s)).toBe("date");
    expect(inferResultType(ast("{g}"), s)).toBe("boolean");
  });

  it("detects cycles between formula columns", () => {
    const s = schemaOf(
      column("a", "formula", { config: { resultType: "number" }, formula: "{b} + 1" }),
      column("b", "formula", { config: { resultType: "number" }, formula: "{a} * 2" }),
      column("c", "formula", { config: { resultType: "number" }, formula: "{c}" }),
    );
    const r = inferResultType(ast("{a} + 1"), s);
    expect(r).toMatchObject({ code: "cycle", start: 0, end: 3 });
    expect(isFormulaError(r) && typeof r.columnKey === "string").toBe(true);
    expect(inferResultType(ast("{c}"), s)).toMatchObject({ code: "cycle", columnKey: "c" });
  });

  it("checks unary and logical operators", () => {
    expect(infer("-{fee}")).toBe("number");
    expect(infer("-{name}")).toMatchObject({ code: "type", start: 1, end: 7 });
    expect(infer("!{isActive}")).toBe("boolean");
    expect(infer("!{fee}")).toMatchObject({ code: "type", start: 1, end: 6 });
    expect(infer("{isActive} && {fee} > 0")).toBe("boolean");
    expect(infer("{isActive} || {fee}")).toMatchObject({ code: "type", start: 14, end: 19 });
  });

  it("checks comparison operand types", () => {
    expect(infer('{name} = "x"')).toBe("boolean");
    expect(infer("{isActive} = true")).toBe("boolean");
    expect(infer("{name} = 1")).toMatchObject({ code: "type", start: 9, end: 10 });
    expect(infer("{isActive} < true")).toMatchObject({ code: "type" });
    expect(infer("{callDate} < TODAY()")).toBe("boolean");
    expect(infer('{name} < "m"')).toBe("boolean");
  });

  it("accepts a date-string literal compared with a date", () => {
    expect(infer('{callDate} >= "2026-09-01"')).toBe("boolean");
    expect(infer('"2026-09-01" < {calledAt}')).toBe("boolean");
    expect(infer('{callDate} >= "soon"')).toMatchObject({ code: "type" });
  });

  it("never throws on a garbage AST", () => {
    const bad = { type: "weird" } as unknown as FormulaNode;
    expect(inferResultType(bad, schema)).toMatchObject({ kind: "formulaError" });
  });
});

describe("dependencies", () => {
  it("returns unique keys in first-seen order", () => {
    expect(dependencies(ast("{a} + {b} * {a}"))).toEqual(["a", "b"]);
  });

  it("returns [] for a formula without refs", () => {
    expect(dependencies(ast('CONCAT("x", 1 + 2)'))).toEqual([]);
  });

  it("walks calls and unary operands", () => {
    expect(dependencies(ast("IF(!{x}, -{y}, SUM({z}, {x}))"))).toEqual(["x", "y", "z"]);
  });
});
