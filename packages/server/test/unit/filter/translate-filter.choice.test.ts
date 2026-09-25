import { describe, expect, it } from "vitest";
import { UnsupportedOperatorError } from "../../../src/errors";
import { translateFilter } from "../../../src/filter/translate-filter";
import type { FilterNode, FilterValue } from "../../../src/internal/core";
import { allTypesSchema, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const schema = allTypesSchema();
const scope = makeScope(makeCtx(schema, { user: { id: "me-42", roles: ["admin"] } }));
const t = (node: FilterNode | null) => {
  const out = translateFilter(node, scope);
  return out ? renderSql(out) : undefined;
};

const PS = "IF(JSON_TYPE(JSON_EXTRACT(`cells`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(`cells`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci";
const PS_EMPTY = `(${PS} IS NULL OR ${PS} = '')`;
const OWNER = "IF(JSON_TYPE(JSON_EXTRACT(`cells`, '$.owner.id')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(`cells`, '$.owner.id'))) COLLATE utf8mb4_0900_ai_ci";
const OWNER_EMPTY = `(${OWNER} IS NULL OR ${OWNER} = '')`;
const TAGS = "JSON_EXTRACT(`cells`, '$.tags')";
const TAGS_EMPTY = `(${TAGS} IS NULL OR JSON_TYPE(${TAGS}) = 'NULL' OR JSON_LENGTH(${TAGS}) = 0)`;
const LINKS = "JSON_EXTRACT(`cells`, '$.links[*].id')";

describe("translateFilter: choice (select / creatableSelect)", () => {
  it("is / isNot", () => {
    const is = t({ columnId: "paymentStatus", operator: "is", value: "paid" });
    expect(is?.sql).toBe(`(${PS} = ? AND NOT ${PS_EMPTY})`);
    expect(is?.params).toEqual(["paid"]);
    const isNot = t({ columnId: "source", operator: "isNot", value: "paid" });
    expect(isNot?.sql).toContain(" <> ? OR (IF(JSON_TYPE(JSON_EXTRACT(`cells`, '$.source')) = 'NULL'");
    expect(isNot?.params).toEqual(["paid"]);
  });

  it("isAnyOf binds one param per value; primitives become strings", () => {
    const r = t({ columnId: "paymentStatus", operator: "isAnyOf", value: ["paid", 2] });
    expect(r?.sql).toBe(`(${PS} IN (?, ?) AND NOT ${PS_EMPTY})`);
    expect(r?.params).toEqual(["paid", "2"]);
  });

  it("isNoneOf [a, b] → (expr NOT IN (?, ?) OR empty)", () => {
    const r = t({ columnId: "paymentStatus", operator: "isNoneOf", value: ["a", "b"] });
    expect(r?.sql).toBe(`(${PS} NOT IN (?, ?) OR ${PS_EMPTY})`);
    expect(r?.params).toEqual(["a", "b"]);
  });

  it("empty isAnyOf is a constant false; empty isNoneOf a constant true", () => {
    const any = t({ columnId: "paymentStatus", operator: "isAnyOf", value: [] });
    expect(any?.sql).toBe(`(FALSE AND NOT ${PS_EMPTY})`);
    expect(any?.params).toEqual([]);
    const none = t({ columnId: "paymentStatus", operator: "isNoneOf", value: [] });
    expect(none?.sql).toBe(`(TRUE OR ${PS_EMPTY})`);
    expect(none?.params).toEqual([]);
  });

  it("rejects non-array values for list operators and non-primitives for is", () => {
    expect(() => t({ columnId: "paymentStatus", operator: "isAnyOf", value: "paid" })).toThrow(UnsupportedOperatorError);
    expect(() => t({ columnId: "paymentStatus", operator: "isAnyOf", value: [null] })).toThrow(UnsupportedOperatorError);
    expect(() => t({ columnId: "paymentStatus", operator: "is", value: ["paid"] })).toThrow(UnsupportedOperatorError);
  });
});

describe("translateFilter: user (ref)", () => {
  it("user column extracts $.owner.id", () => {
    const r = t({ columnId: "owner", operator: "is", value: "u7" });
    expect(r?.sql).toBe(`(${OWNER} = ? AND NOT ${OWNER_EMPTY})`);
    expect(r?.params).toEqual(["u7"]);
  });

  it("isMe binds ctx.user.id and ignores anything else in the value", () => {
    const value = { me: true, id: "attacker", userId: "attacker" } as unknown as FilterValue;
    const r = t({ columnId: "owner", operator: "isMe", value });
    expect(r?.sql).toBe(`(${OWNER} = ? AND NOT ${OWNER_EMPTY})`);
    expect(r?.params).toEqual(["me-42"]);
  });

  it("isMe requires { me: true }", () => {
    expect(() => t({ columnId: "owner", operator: "isMe", value: "me-42" })).toThrow(UnsupportedOperatorError);
    expect(() => t({ columnId: "owner", operator: "isMe" })).toThrow(UnsupportedOperatorError);
  });

  it("isNotMe includes empty", () => {
    const r = t({ columnId: "owner", operator: "isNotMe", value: { me: true } });
    expect(r?.sql).toBe(`(${OWNER} <> ? OR ${OWNER_EMPTY})`);
    expect(r?.params).toEqual(["me-42"]);
  });

  it("isMe is not available on choice columns", () => {
    expect(() => t({ columnId: "paymentStatus", operator: "isMe", value: { me: true } })).toThrow(
      UnsupportedOperatorError,
    );
  });
});

describe("translateFilter: multiSelect", () => {
  it("hasAllOf binds the array as ONE JSON string param", () => {
    const r = t({ columnId: "tags", operator: "hasAllOf", value: ["a", "b"] });
    expect(r?.sql).toBe(`(JSON_CONTAINS(${TAGS}, CAST(? AS JSON)) AND NOT ${TAGS_EMPTY})`);
    expect(r?.params).toEqual(['["a","b"]']);
  });

  it("hasAnyOf uses JSON_OVERLAPS", () => {
    const r = t({ columnId: "tags", operator: "hasAnyOf", value: ["a", 1] });
    expect(r).toMatchInlineSnapshot(`
      {
        "params": [
          "["a","1"]",
        ],
        "sql": "(JSON_OVERLAPS(JSON_EXTRACT(\`cells\`, '$.tags'), CAST(? AS JSON)) AND NOT (JSON_EXTRACT(\`cells\`, '$.tags') IS NULL OR JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.tags')) = 'NULL' OR JSON_LENGTH(JSON_EXTRACT(\`cells\`, '$.tags')) = 0))",
      }
    `);
    expect(r?.params).toEqual(['["a","1"]']);
  });

  it("hasNoneOf includes empty (NOT JSON_OVERLAPS(NULL, …) is NULL, so the OR-empty branch covers it)", () => {
    const r = t({ columnId: "tags", operator: "hasNoneOf", value: ["a"] });
    expect(r?.sql).toBe(`(NOT JSON_OVERLAPS(${TAGS}, CAST(? AS JSON)) OR ${TAGS_EMPTY})`);
    expect(r?.params).toEqual(['["a"]']);
  });

  it("empty lists: hasAnyOf FALSE, hasAllOf TRUE, hasNoneOf TRUE", () => {
    expect(t({ columnId: "tags", operator: "hasAnyOf", value: [] })?.sql).toBe(`(FALSE AND NOT ${TAGS_EMPTY})`);
    expect(t({ columnId: "tags", operator: "hasAllOf", value: [] })?.sql).toBe(`(TRUE AND NOT ${TAGS_EMPTY})`);
    expect(t({ columnId: "tags", operator: "hasNoneOf", value: [] })?.sql).toBe(`(TRUE OR ${TAGS_EMPTY})`);
  });
});

describe("translateFilter: link", () => {
  it("is uses $.links[*].id with a single-element JSON array", () => {
    const r = t({ columnId: "links", operator: "is", value: "rec_1" });
    expect(r).toMatchInlineSnapshot(`
      {
        "params": [
          "["rec_1"]",
        ],
        "sql": "(JSON_OVERLAPS(JSON_EXTRACT(\`cells\`, '$.links[*].id'), CAST(? AS JSON)) AND NOT (JSON_EXTRACT(\`cells\`, '$.links') IS NULL OR JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.links')) = 'NULL' OR JSON_LENGTH(JSON_EXTRACT(\`cells\`, '$.links')) = 0))",
      }
    `);
    expect(r?.sql).toContain(`JSON_OVERLAPS(${LINKS}, CAST(? AS JSON))`);
    expect(r?.params).toEqual(['["rec_1"]']);
  });

  it("isAnyOf binds the id array as one param; empty → FALSE", () => {
    const r = t({ columnId: "links", operator: "isAnyOf", value: ["rec_1", "rec_2"] });
    expect(r?.sql).toContain(`JSON_OVERLAPS(${LINKS}, CAST(? AS JSON))`);
    expect(r?.params).toEqual(['["rec_1","rec_2"]']);
    expect(t({ columnId: "links", operator: "isAnyOf", value: [] })?.sql).toMatch(/^\(FALSE AND NOT /);
  });
});
