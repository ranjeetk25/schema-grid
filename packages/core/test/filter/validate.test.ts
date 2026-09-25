import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../../src/field-types/default-registry";
import type { FilterNode } from "../../src/filter/types";
import { MAX_FILTER_DEPTH, validateFilter } from "../../src/filter/validate";
import type { GridSchema } from "../../src/schema/types";
import { createFixtureSchema, FIXTURE_COLUMN_IDS as C } from "../../src/testing/schema";

const registry = createDefaultRegistry();
const schema: GridSchema = createFixtureSchema();
const all = new Set(schema.columns.map((c) => c.id));
const validate = (node: FilterNode | null, readable: ReadonlySet<string> = all) =>
  validateFilter(node, schema, registry, readable);

const cond = (columnId: string, operator: string, value?: unknown): FilterNode =>
  (value === undefined ? { columnId, operator } : { columnId, operator, value }) as FilterNode;

describe("validateFilter", () => {
  it("accepts null and the spec §8 AST", () => {
    expect(validate(null)).toEqual([]);
    expect(
      validate({
        op: "and",
        children: [
          cond(C.status, "isNot", "paid"),
          cond(C.callDate, "isWithin", { relative: "yesterday" }),
        ],
      }),
    ).toEqual([]);
  });

  it("rejects groups nested deeper than 2", () => {
    expect(MAX_FILTER_DEPTH).toBe(2);
    const errors = validate({
      op: "and",
      children: [{ op: "or", children: [{ op: "and", children: [cond(C.name, "isEmpty")] }] }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "depthExceeded", path: [0, 0] });
  });

  it("accepts and → or → condition and a bare root condition", () => {
    expect(validate({ op: "and", children: [{ op: "or", children: [cond(C.name, "isEmpty")] }] })).toEqual([]);
    expect(validate(cond(C.name, "contains", "a"))).toEqual([]);
  });

  it("rejects unreadable columns without leaking the label", () => {
    const readable = new Set([...all].filter((id) => id !== C.notes));
    const errors = validate(cond(C.notes, "contains", "vip"), readable);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("unreadableColumn");
    expect(errors[0]?.message).not.toContain("Internal notes");
  });

  it("rejects unknown columns", () => {
    expect(validate(cond("nope", "is", "x"))[0]?.code).toBe("unknownColumn");
  });

  it("rejects operators the column type does not support", () => {
    expect(validate(cond(C.paid, "contains", "1"))[0]?.code).toBe("unknownOperator");
    expect(validate(cond(C.status, "isMe", { me: true }))[0]?.code).toBe("unknownOperator");
    expect(validate(cond(C.owner, "isMe", { me: true }))).toEqual([]);
  });

  it("rejects values that don't fit the operator's value kind", () => {
    const mismatches: FilterNode[] = [
      cond(C.status, "isAnyOf", "paid"),
      cond(C.paid, "between", 5),
      cond(C.callDate, "isWithin", { relative: "lastNDays" }),
      cond(C.name, "isEmpty", "x"),
      cond(C.owner, "isMe", { me: false }),
    ];
    for (const node of mismatches) {
      expect(validate(node).map((e) => e.code)).toEqual(["valueKindMismatch"]);
    }
    expect(validate(cond(C.paid, "between", { from: 1, to: 5 }))).toEqual([]);
    expect(validate(cond(C.callDate, "isWithin", { relative: "lastNDays", n: 7 }))).toEqual([]);
  });

  it("accepts an empty list for the negative list operators only (vacuously true)", () => {
    expect(validate(cond(C.status, "isNoneOf", []))).toEqual([]);
    expect(validate(cond(C.tags, "hasNoneOf", []))).toEqual([]);
    expect(validate(cond(C.status, "isAnyOf", [])).map((e) => e.code)).toEqual(["valueKindMismatch"]);
    expect(validate(cond(C.tags, "hasAllOf", [])).map((e) => e.code)).toEqual(["valueKindMismatch"]);
    expect(validate(cond(C.status, "isNoneOf", "paid")).map((e) => e.code)).toEqual(["valueKindMismatch"]);
  });

  it("boolean columns accept isEmpty / isNotEmpty without a value", () => {
    expect(validate(cond(C.isActive, "isEmpty"))).toEqual([]);
    expect(validate(cond(C.isActive, "isNotEmpty"))).toEqual([]);
    expect(validate(cond(C.isActive, "isEmpty", true)).map((e) => e.code)).toEqual(["valueKindMismatch"]);
  });

  it("resolves formula operators through resultType", () => {
    expect(validate(cond(C.balance, "gt", 0))).toEqual([]);
    expect(validate(cond(C.balance, "contains", "1"))[0]?.code).toBe("unknownOperator");
  });

  it("reports every error with its path", () => {
    const errors = validate({
      op: "or",
      children: [
        cond("nope", "is", "x"),
        cond(C.name, "contains", "a"),
        { op: "and", children: [cond(C.paid, "contains", "1"), cond(C.status, "isAnyOf", [])] },
      ],
    });
    expect(errors.map((e) => [e.code, e.path])).toEqual([
      ["unknownColumn", [0]],
      ["unknownOperator", [2, 0]],
      ["valueKindMismatch", [2, 1]],
    ]);
  });

  it("rejects conditions on filterable:false columns with unfilterableColumn", () => {
    const locked: GridSchema = {
      ...schema,
      columns: schema.columns.map((c) => (c.id === C.name ? { ...c, filterable: false } : c)),
    };
    const errors = validateFilter(
      { op: "and", children: [cond(C.status, "is", "paid"), cond(C.name, "contains", "a")] },
      locked,
      registry,
      all,
    );
    expect(errors).toEqual([expect.objectContaining({ code: "unfilterableColumn", path: [1], columnId: C.name })]);
    expect(validateFilter(cond(C.name, "contains", "a"), schema, registry, all)).toEqual([]);
  });

  it("reports an unreadable unfilterable column as unreadable (no label leak)", () => {
    const locked: GridSchema = {
      ...schema,
      columns: schema.columns.map((c) => (c.id === C.name ? { ...c, filterable: false } : c)),
    };
    const readable = new Set([...all].filter((id) => id !== C.name));
    expect(validateFilter(cond(C.name, "contains", "a"), locked, registry, readable)[0]?.code).toBe("unreadableColumn");
  });
});
