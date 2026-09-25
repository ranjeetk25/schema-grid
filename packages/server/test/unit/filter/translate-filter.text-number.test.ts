import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { UnsupportedOperatorError } from "../../../src/errors";
import { registerOperatorTranslator } from "../../../src/filter/operator-table";
import { translateFilter } from "../../../src/filter/translate-filter";
import type { FilterNode, FilterValue } from "../../../src/internal/core";
import { allTypesSchema, col, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const schema = allTypesSchema([col("rating", "rating")]);
const scope = makeScope(makeCtx(schema));
const t = (node: FilterNode | null) => {
  const out = translateFilter(node, scope);
  return out ? renderSql(out) : undefined;
};

const NAME = "IF(JSON_TYPE(JSON_EXTRACT(`cells`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(`cells`, '$.name'))) COLLATE utf8mb4_0900_as_ci";
const NAME_EMPTY = `(${NAME} IS NULL OR REGEXP_LIKE(${NAME}, '^[[:space:]]*$'))`;
const FEE =
  "(CASE WHEN JSON_TYPE(JSON_EXTRACT(`cells`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(`cells`, '$.fee') AS DECIMAL(38,10)) END)";
const FEE_EMPTY = `(${FEE} IS NULL)`;

describe("translateFilter: text", () => {
  it("isNot includes empty values and trims both sides: (TRIM(expr) <> ? OR empty)", () => {
    const r = t({ columnId: "name", operator: "isNot", value: "  Paid " });
    expect(r?.sql).toBe(`(TRIM(${NAME}) <> ? OR ${NAME_EMPTY})`);
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

  it("startsWith / contains do not trim; is trims both sides (param JS-trimmed)", () => {
    expect(t({ columnId: "name", operator: "startsWith", value: " As" })?.params).toEqual([" As%"]);
    expect(t({ columnId: "name", operator: "contains", value: " a " })?.params).toEqual(["% a %"]);
    const is = t({ columnId: "name", operator: "is", value: "\tAsha  " });
    expect(is?.sql).toBe(`(TRIM(${NAME}) = ? AND NOT ${NAME_EMPTY})`);
    expect(is?.params).toEqual(["Asha"]);
  });

  it("numbers and booleans are usable text values (stringified)", () => {
    expect(t({ columnId: "name", operator: "is", value: 42 })?.params).toEqual(["42"]);
    expect(t({ columnId: "name", operator: "contains", value: true })?.params).toEqual(["%true%"]);
  });

  it("an unusable value (object / array / null) → FALSE: positives match nothing, negatives only empties", () => {
    const obj = { a: 1 } as unknown as FilterValue;
    expect(t({ columnId: "name", operator: "contains", value: obj })?.sql).toBe(`(FALSE AND NOT ${NAME_EMPTY})`);
    expect(t({ columnId: "name", operator: "is", value: null })?.sql).toBe(`(FALSE AND NOT ${NAME_EMPTY})`);
    expect(t({ columnId: "name", operator: "isNot", value: obj })?.sql).toBe(`(FALSE OR ${NAME_EMPTY})`);
    expect(t({ columnId: "name", operator: "notContains", value: ["x"] })?.sql).toBe(`(FALSE OR ${NAME_EMPTY})`);
  });

  it("isEmpty / isNotEmpty use the whitespace-aware empty predicate", () => {
    expect(NAME_EMPTY).toContain("REGEXP_LIKE(");
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

  it("coerces numeric strings strictly (trimmed decimal / exponent)", () => {
    expect(t({ columnId: "fee", operator: "gt", value: " 5.5 " })?.params).toEqual([5.5]);
    expect(t({ columnId: "fee", operator: "eq", value: "-1e3" })?.params).toEqual([-1000]);
    expect(t({ columnId: "fee", operator: "eq", value: ".5" })?.params).toEqual([0.5]);
  });

  it("unusable values → FALSE (never matches a non-empty cell, even for neq)", () => {
    for (const value of ["abc", "0x10", "Infinity", "", "  ", true, null, "1e400"] as FilterValue[]) {
      expect(t({ columnId: "fee", operator: "gt", value })?.sql).toBe(`(FALSE AND NOT ${FEE_EMPTY})`);
      expect(t({ columnId: "fee", operator: "neq", value })?.sql).toBe(`(FALSE OR ${FEE_EMPTY})`);
    }
  });

  it("between: blank/null bounds are open; both open matches any non-empty cell", () => {
    const lo = t({ columnId: "fee", operator: "between", value: { from: "2", to: null } });
    expect(lo?.sql).toBe(`(${FEE} >= ? AND NOT ${FEE_EMPTY})`);
    expect(lo?.params).toEqual([2]);
    const hi = t({ columnId: "fee", operator: "between", value: { from: " ", to: 9 } });
    expect(hi?.sql).toBe(`(${FEE} <= ? AND NOT ${FEE_EMPTY})`);
    expect(t({ columnId: "fee", operator: "between", value: { from: null, to: "" } })?.sql).toBe(
      `(TRUE AND NOT ${FEE_EMPTY})`,
    );
    // Only one key present is still a range (core isRange).
    expect(t({ columnId: "fee", operator: "between", value: { from: 1 } as unknown as FilterValue })?.params).toEqual([1]);
  });

  it("between: a non-numeric bound or a non-range value is unusable", () => {
    expect(t({ columnId: "fee", operator: "between", value: { from: "abc", to: 5 } })?.sql).toBe(
      `(FALSE AND NOT ${FEE_EMPTY})`,
    );
    expect(t({ columnId: "fee", operator: "between", value: 5 })?.sql).toBe(`(FALSE AND NOT ${FEE_EMPTY})`);
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

  it("isEmpty / isNotEmpty test the typed boolean for NULL (false is not empty)", () => {
    const typed = `(CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.isActive')) = 'BOOLEAN' THEN JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.isActive')) = 'true' END)`;
    expect(t({ columnId: "isActive", operator: "isEmpty" })?.sql).toBe(`(${typed} IS NULL)`);
    expect(t({ columnId: "isActive", operator: "isNotEmpty" })?.sql).toBe(`NOT (${typed} IS NULL)`);
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
      `((${FEE} > ? AND NOT ${FEE_EMPTY}) AND ((TRIM(${NAME}) = ? AND NOT ${NAME_EMPTY}) OR (TRIM(${NAME}) = ? AND NOT ${NAME_EMPTY})))`,
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
      "(JSON_EXTRACT(JSON_EXTRACT(`cells`, '$.rating'), '$.stars') >= ? AND NOT (JSON_EXTRACT(`cells`, '$.rating') IS NULL OR JSON_TYPE(JSON_EXTRACT(`cells`, '$.rating')) = 'NULL' OR (JSON_TYPE(JSON_EXTRACT(`cells`, '$.rating')) = 'STRING' AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(`cells`, '$.rating')), '^[[:space:]]*$')) OR (JSON_TYPE(JSON_EXTRACT(`cells`, '$.rating')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(`cells`, '$.rating')) = 0)))",
    );
    expect(r?.params).toEqual([4]);
  });
});
