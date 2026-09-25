import { describe, expect, it } from "vitest";
import { assertQueryAccess, resolveAccess } from "../../../src/access/query-access";
import { FilterValidationError, PermissionError } from "../../../src/errors";
import type { GridQuery, PermissionUser } from "../../../src/internal/core";
import { allTypesSchema, col, makeCtx } from "../../helpers/schemas";

const ADMIN_ONLY = { read: { roles: ["admin"] }, edit: { roles: ["admin"] } };
const schema = allTypesSchema([
  col("salary", "number", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
  col("net", "formula", { formula: "{salary} - {fee}", config: { resultType: "number" } }),
  col("net2", "formula", { formula: "{net} * 2", config: { resultType: "number" } }),
  col("notesPriv", "text", { permissions: { ...ADMIN_ONLY, read: { roles: ["admin", "manager"] } } }),
]);

const users: Record<string, PermissionUser> = {
  admin: { id: "a", roles: ["admin"] },
  counsellor: { id: "c", roles: ["counsellor"] },
  manager: { id: "m", roles: ["manager"] },
};

const base: GridQuery = { filter: null, sort: [], page: { offset: 0, limit: 10 } };
const run = (who: keyof typeof users, q: Partial<GridQuery>) => {
  const ctx = makeCtx(schema, { user: users[who] as PermissionUser });
  return () => assertQueryAccess({ ...base, ...q }, ctx, resolveAccess(ctx));
};
const catchErr = (fn: () => void): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
};

describe("resolveAccess", () => {
  it("formula depending (transitively) on a hidden column is hidden", () => {
    const ctx = makeCtx(schema, { user: users.counsellor as PermissionUser });
    const access = resolveAccess(ctx);
    expect(access.get("salary")).toBe("hidden");
    expect(access.get("net")).toBe("hidden");
    expect(access.get("net2")).toBe("hidden");
    expect(access.get("balance")).toBe("read");
    const adminAccess = resolveAccess(makeCtx(schema, { user: users.admin as PermissionUser }));
    expect(adminAccess.get("net")).toBe("read");
    expect(adminAccess.get("salary")).toBe("edit");
  });
});

describe("assertQueryAccess permission matrix", () => {
  const usages = {
    filter: { filter: { columnId: "salary", operator: "gt", value: 1 } },
    sort: { sort: [{ columnId: "salary", dir: "asc" as const }] },
    groupBy: { groupBy: [{ columnId: "salary" }] },
    aggregate: { groupBy: [{ columnId: "paymentStatus", aggregations: [{ columnId: "salary", agg: "sum" as const }] }] },
  } satisfies Record<string, Partial<GridQuery>>;

  for (const [usage, q] of Object.entries(usages)) {
    it(`counsellor: hidden column in ${usage} → PermissionError(${usage})`, () => {
      const err = catchErr(run("counsellor", q));
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).details).toEqual({ columnIds: ["salary"], usage });
    });
    it(`admin: readable column in ${usage} passes`, () => {
      expect(run("admin", q)).not.toThrow();
    });
  }

  it("manager can read notesPriv (read-only) and filter on it", () => {
    expect(run("manager", { filter: { columnId: "notesPriv", operator: "contains", value: "x" } })).not.toThrow();
  });

  it("formula over hidden column is rejected as a permission error", () => {
    const err = catchErr(run("counsellor", { sort: [{ columnId: "net", dir: "desc" }] }));
    expect(err).toBeInstanceOf(PermissionError);
  });

  it("hidden column nested in an OR group is found", () => {
    const err = catchErr(
      run("counsellor", {
        filter: {
          op: "and",
          children: [{ op: "or", children: [{ columnId: "fee", operator: "gt", value: 1 }, { columnId: "salary", operator: "gt", value: 1 }] }],
        },
      }),
    );
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as PermissionError).details.usage).toBe("filter");
  });

  it("unknown operator surfaces FilterValidationError", () => {
    const err = catchErr(run("admin", { filter: { columnId: "fee", operator: "contains", value: "x" } }));
    expect(err).toBeInstanceOf(FilterValidationError);
    expect((err as FilterValidationError).errors[0]?.code).toBe("unknownOperator");
  });

  it("unknown sort column surfaces FilterValidationError", () => {
    expect(catchErr(run("admin", { sort: [{ columnId: "nope", dir: "asc" }] }))).toBeInstanceOf(FilterValidationError);
  });

  it("depth 3 is rejected except for the pinned-group shape", () => {
    const deep = {
      op: "or" as const,
      children: [
        { op: "and" as const, children: [{ columnId: "fee", operator: "gt", value: 1 }] },
        { columnId: "fee", operator: "lt", value: 0 },
      ],
    };
    // pinned: AND[pin, OR[AND[...]]] → allowed
    expect(
      run("admin", { filter: { op: "and", children: [{ columnId: "paymentStatus", operator: "is", value: "paid" }, deep] } }),
    ).not.toThrow();
    // genuinely too deep (group at depth 4)
    const tooDeep = { op: "and" as const, children: [{ op: "or" as const, children: [{ op: "and" as const, children: [deep] }] }] };
    expect(catchErr(run("admin", { filter: tooDeep }))).toBeInstanceOf(FilterValidationError);
  });
});
