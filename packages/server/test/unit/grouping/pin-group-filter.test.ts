import { describe, expect, it } from "vitest";
import { assertQueryAccess, resolveAccess } from "../../../src/access/query-access";
import { GroupingError } from "../../../src/errors";
import { pinGroupFilter } from "../../../src/grouping/pin-group-filter";
import { buildGroupQuery } from "../../../src/grouping/translate-grouping";
import { type GridQuery, createDefaultRegistry } from "../../../src/internal/core";
import { buildQuery } from "../../../src/query/build-query";
import { allTypesSchema, makeCtx, makeScope } from "../../helpers/schemas";
import { mockDb } from "../../helpers/sql";

const schema = allTypesSchema();
const registry = createDefaultRegistry();
const ctx = makeCtx(schema);
const scope = { ...makeScope(ctx), gridId: "grid_all" };

const base = (filter: GridQuery["filter"], groupBy: GridQuery["groupBy"]): GridQuery => ({
  filter,
  sort: [],
  groupBy,
  page: { offset: 0, limit: 25 },
});

const TWO_LEVELS = [
  { columnId: "paymentStatus", aggregations: [{ columnId: "fee", agg: "sum" as const }] },
  { columnId: "isActive" },
];

describe("pinGroupFilter", () => {
  it("drops the pinned groupBy level and adds an `is` condition (null filter → AND[pins])", () => {
    const next = pinGroupFilter(base(null, TWO_LEVELS), [{ columnId: "paymentStatus", value: "paid" }], schema, registry);
    expect(next.groupBy).toEqual([{ columnId: "isActive" }]);
    expect(next.filter).toEqual({ op: "and", children: [{ columnId: "paymentStatus", operator: "is", value: "paid" }] });
    expect(() => buildGroupQuery(next, scope, mockDb())).not.toThrow();
  });

  it("uses isEmpty for a null / empty group value", () => {
    for (const value of [null, undefined, ""]) {
      const next = pinGroupFilter(base(null, TWO_LEVELS), [{ columnId: "paymentStatus", value }], schema, registry);
      expect(next.filter).toEqual({ op: "and", children: [{ columnId: "paymentStatus", operator: "isEmpty" }] });
    }
  });

  it("uses eq for numbers and isTrue / isFalse for booleans", () => {
    const q = base(null, [{ columnId: "fee" }, { columnId: "isActive" }, { columnId: "name" }]);
    const next = pinGroupFilter(
      q,
      [
        { columnId: "fee", value: 100 },
        { columnId: "isActive", value: false },
      ],
      schema,
      registry,
    );
    expect(next.groupBy).toEqual([{ columnId: "name" }]);
    expect(next.filter).toEqual({
      op: "and",
      children: [
        { columnId: "fee", operator: "eq", value: 100 },
        { columnId: "isActive", operator: "isFalse" },
      ],
    });
    const t = pinGroupFilter(q, [{ columnId: "fee", value: 1 }, { columnId: "isActive", value: true }], schema, registry);
    expect((t.filter as { children: unknown[] }).children[1]).toEqual({ columnId: "isActive", operator: "isTrue" });
  });

  it("appends pins to an AND root", () => {
    const root = { op: "and" as const, children: [{ columnId: "name", operator: "contains", value: "a" }] };
    const next = pinGroupFilter(base(root, TWO_LEVELS), [{ columnId: "paymentStatus", value: "paid" }], schema, registry);
    expect(next.filter).toEqual({
      op: "and",
      children: [
        { columnId: "name", operator: "contains", value: "a" },
        { columnId: "paymentStatus", operator: "is", value: "paid" },
      ],
    });
    expect(root.children).toHaveLength(1); // input not mutated
  });

  it("wraps a condition root as AND[pins, root]", () => {
    const root = { columnId: "name", operator: "contains", value: "a" };
    const next = pinGroupFilter(base(root, TWO_LEVELS), [{ columnId: "paymentStatus", value: "paid" }], schema, registry);
    expect(next.filter).toEqual({ op: "and", children: [{ columnId: "paymentStatus", operator: "is", value: "paid" }, root] });
  });

  it("pinning onto an OR root (with a nested group, depth 3) produces AND[pins, OR] and passes assertQueryAccess", () => {
    const or = {
      op: "or" as const,
      children: [
        { columnId: "name", operator: "contains", value: "a" },
        {
          op: "and" as const,
          children: [
            { columnId: "fee", operator: "gt", value: 10 },
            { columnId: "callDate", operator: "isEmpty" },
          ],
        },
      ],
    };
    const next = pinGroupFilter(
      base(or, TWO_LEVELS),
      [
        { columnId: "paymentStatus", value: null },
        { columnId: "isActive", value: true },
      ],
      schema,
      registry,
    );
    expect(next.filter).toEqual({
      op: "and",
      children: [
        { columnId: "paymentStatus", operator: "isEmpty" },
        { columnId: "isActive", operator: "isTrue" },
        or,
      ],
    });
    expect(() => assertQueryAccess(next, ctx, resolveAccess(ctx))).not.toThrow();
    // Last level: groupBy is empty, so the caller fetches rows with the pinned filter.
    expect(next.groupBy).toEqual([]);
    expect(() => buildQuery(next, scope, mockDb())).not.toThrow();
  });

  it("resets paging to the first page (parent cursors would not match the child fingerprint)", () => {
    const q: GridQuery = { ...base(null, TWO_LEVELS), page: { cursor: "abc", limit: 10 } };
    const next = pinGroupFilter(q, [{ columnId: "paymentStatus", value: "paid" }], schema, registry);
    expect(next.page).toEqual({ offset: 0, limit: 10 });
  });

  it("rejects pins that do not match the groupBy levels, unknown columns, and unfilterable empty pins", () => {
    expect(() =>
      pinGroupFilter(base(null, TWO_LEVELS), [{ columnId: "isActive", value: true }], schema, registry),
    ).toThrow(GroupingError);
    expect(() =>
      pinGroupFilter(base(null, TWO_LEVELS), [{ columnId: "paymentStatus", value: "paid" }, { columnId: "isActive", value: true }, { columnId: "name", value: "x" }], schema, registry),
    ).toThrow(GroupingError);
    // Booleans have no isEmpty operator, so an empty boolean group cannot be pinned.
    expect(() =>
      pinGroupFilter(base(null, [{ columnId: "isActive" }]), [{ columnId: "isActive", value: null }], schema, registry),
    ).toThrow(GroupingError);
  });
});
