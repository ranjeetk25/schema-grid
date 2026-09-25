import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { UnsupportedOperatorError } from "../../../src/errors";
import { registerOperatorTranslator } from "../../../src/filter/operator-table";
import { translateFilter } from "../../../src/filter/translate-filter";
import type { FilterNode } from "../../../src/internal/core";
import { allTypesSchema, col, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const schema = allTypesSchema([col("rating", "rating")]);
const scope = makeScope(makeCtx(schema));
const t = (node: FilterNode | null) => {
  const out = translateFilter(node, scope);
  return out ? renderSql(out) : undefined;
};

const NAME = "IF(JSON_TYPE(JSON_EXTRACT(`cells`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(`cells`, '$.name'))) COLLATE utf8mb4_0900_ai_ci";
const NAME_EMPTY = `(${NAME} IS NULL OR ${NAME} = '')`;
const FEE =
  "(CASE WHEN JSON_TYPE(JSON_EXTRACT(`cells`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(`cells`, '$.fee') AS DECIMAL(38,10)) END)";
const FEE_EMPTY = `(${FEE} IS NULL)`;

describe("translateFilter: text", () => {
  it("isNot includes empty values: (expr <> ? OR expr IS NULL ...)", () => {
    const r = t({ columnId: "name", operator: "isNot", value: "Paid" });
    expect(r?.sql).toBe(`(${NAME} <> ? OR ${NAME_EMPTY})`);
    expect(r?.params).toEqual(["Paid"]);
  });

  it("notContains includes the empty branch; contains excludes it and escapes", () => {
    const nc = t({ columnId: "name", operator: "notContains", value: "x" });
    expect(nc?.sql).toBe(`(${NAME} NOT LIKE ? ESCAPE '!' OR ${NAME_EMPTY})`);
    expect(nc?.params).toEqual(["%x%"]);
    const c = t({ columnId: "name", operator: "contains", value: "5%_" });
    expect(c?.sql).toBe(`(${NAME} LIKE ? ESCAPE '!' AND NOT ${NAME_EMPTY})`);
    expect(c?.params).toEqual(["%5!%!_%"]);
  });

  it("startsWith / is", () => {
    expect(t({ columnId: "name", operator: "startsWith", value: "As" })?.params).toEqual(["As%"]);
    const is = t({ columnId: "name", operator: "is", value: "Asha" });
    expect(is?.sql).toBe(`(${NAME} = ? AND NOT ${NAME_EMPTY})`);
  });

  it("isEmpty / isNotEmpty use the empty predicate", () => {
    expect(t({ columnId: "name", operator: "isEmpty" })?.sql).toBe(NAME_EMPTY);
    expect(t({ columnId: "name", operator: "isNotEmpty" })?.sql).toBe(`NOT ${NAME_EMPTY}`);
  });
});

describe("translateFilter: number", () => {
  it("neq includes nulls; gt excludes them and casts to DECIMAL", () => {
    const neq = t({ columnId: "fee", operator: "neq", value: 5 });
    expect(neq?.sql).toBe(`(${FEE} <> ? OR ${FEE_EMPTY})`);
    expect(neq?.params).toEqual([5]);
    const gt = t({ columnId: "fee", operator: "gt", value: 5 });
    expect(gt?.sql).toBe(`(${FEE} > ? AND NOT ${FEE_EMPTY})`);
    expect(gt?.params).toEqual([5]);
  });

  it("between binds two params, inclusive", () => {
    const r = t({ columnId: "fee", operator: "between", value: { from: 1, to: 10 } });
    expect(r?.sql).toBe(`((${FEE} >= ? AND ${FEE} <= ?) AND NOT ${FEE_EMPTY})`);
    expect(r?.params).toEqual([1, 10]);
  });

  it("rejects non-numeric values", () => {
    expect(() => t({ columnId: "fee", operator: "gt", value: "abc" })).toThrow(UnsupportedOperatorError);
  });
});

describe("translateFilter: boolean", () => {
  it("isFalse does not match empty (no OR-empty branch)", () => {
    const r = t({ columnId: "isActive", operator: "isFalse" });
    expect(r?.sql).toMatchInlineSnapshot(
      `"((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.isActive')) = 'BOOLEAN' THEN JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.isActive')) = 'true' END) = 0 AND NOT ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.isActive')) = 'BOOLEAN' THEN JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.isActive')) = 'true' END) IS NULL))"`,
    );
    expect(r?.sql).not.toMatch(/ OR \(JSON_EXTRACT/);
    expect(t({ columnId: "isActive", operator: "isTrue" })?.sql).toContain("= 1 AND NOT");
  });
});

describe("translateFilter: groups", () => {
  it("parenthesizes a nested OR inside AND", () => {
    const r = t({
      op: "and",
      children: [
        { columnId: "fee", operator: "gt", value: 1 },
        {
          op: "or",
          children: [
            { columnId: "name", operator: "is", value: "a" },
            { columnId: "name", operator: "is", value: "b" },
          ],
        },
      ],
    });
    expect(r?.sql).toBe(
      `((${FEE} > ? AND NOT ${FEE_EMPTY}) AND ((${NAME} = ? AND NOT ${NAME_EMPTY}) OR (${NAME} = ? AND NOT ${NAME_EMPTY})))`,
    );
    expect(r?.params).toEqual([1, "a", "b"]);
  });

  it("null filter and empty AND return undefined; empty OR matches nothing", () => {
    expect(t(null)).toBeUndefined();
    expect(t({ op: "and", children: [] })).toBeUndefined();
    expect(t({ op: "or", children: [] })?.sql).toBe("FALSE");
    expect(t({ op: "or", children: [{ op: "and", children: [] }, { columnId: "fee", operator: "gt", value: 1 }] })).toBeUndefined();
  });

  it("single-child group collapses", () => {
    expect(t({ op: "and", children: [{ columnId: "fee", operator: "eq", value: 3 }] })?.sql).toBe(
      `(${FEE} = ? AND NOT ${FEE_EMPTY})`,
    );
  });

  it("unknown operator throws UnsupportedOperatorError", () => {
    expect(() => t({ columnId: "fee", operator: "contains", value: "x" })).toThrow(UnsupportedOperatorError);
    expect(() => t({ columnId: "nope", operator: "is", value: "x" })).toThrow(UnsupportedOperatorError);
  });
});

describe("registerOperatorTranslator", () => {
  it("custom translator for kind json is used", () => {
    const reg = scope.ctx.registry;
    reg.register({
      ...(reg.get("text") as NonNullable<ReturnType<typeof reg.get>>),
      id: "rating",
      operators: [{ id: "atLeast", label: "at least", valueKind: "single" }],
    });
    registerOperatorTranslator("json", "atLeast", ({ expr, value }) => sql`JSON_EXTRACT(${expr.raw}, '$.stars') >= ${value as number}`);
    const r = t({ columnId: "rating", operator: "atLeast", value: 4 });
    expect(r?.sql).toBe(
      "(JSON_EXTRACT(JSON_EXTRACT(`cells`, '$.rating'), '$.stars') >= ? AND NOT (JSON_EXTRACT(`cells`, '$.rating') IS NULL OR JSON_TYPE(JSON_EXTRACT(`cells`, '$.rating')) = 'NULL'))",
    );
    expect(r?.params).toEqual([4]);
  });
});
