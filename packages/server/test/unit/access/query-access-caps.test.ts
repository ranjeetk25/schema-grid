/** v0.2 C1: sortable / filterable column options enforced by assertQueryAccess. */
import { describe, expect, it } from "vitest";
import { assertQueryAccess, resolveAccess } from "../../../src/access/query-access";
import { FilterValidationError, PermissionError } from "../../../src/errors";
import { type GridQuery, type PermissionUser, toWireError, httpStatusFor } from "../../../src/internal/core";
import { col, makeCtx } from "../../helpers/schemas";

const schema = {
  id: "g",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("ai", "text", { sortable: false }),
    col("secretRank", "number", { sortable: false, permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
    col("blob", "text", { filterable: false }),
  ],
};
const counsellor: PermissionUser = { id: "c", roles: ["counsellor"] };
const base: GridQuery = { filter: null, sort: [], page: { offset: 0, limit: 10 } };
const run = (q: Partial<GridQuery>) => {
  const ctx = makeCtx(schema, { user: counsellor });
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

describe("assertQueryAccess: sortable:false", () => {
  it("rejects sort on an unsortable column with UNSORTABLE_COLUMN (usage sort)", () => {
    const err = catchErr(run({ sort: [{ columnId: "name", dir: "asc" }, { columnId: "ai", dir: "desc" }] }));
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as PermissionError).code).toBe("UNSORTABLE_COLUMN");
    expect((err as PermissionError).details).toEqual({ columnIds: ["ai"], usage: "sort" });
  });

  it("maps to wire UNSORTABLE_COLUMN / HTTP 400", () => {
    const wire = toWireError(catchErr(run({ sort: [{ columnId: "ai", dir: "asc" }] })));
    expect(wire.code).toBe("UNSORTABLE_COLUMN");
    expect(httpStatusFor(wire.code)).toBe(400);
  });

  it("a hidden unsortable column still reports PERMISSION_DENIED (hidden check first)", () => {
    const err = catchErr(run({ sort: [{ columnId: "secretRank", dir: "asc" }] }));
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as PermissionError).code).toBe("PERMISSION_DENIED");
  });

  it("unsortable columns may still be filtered and grouped", () => {
    expect(run({ filter: { columnId: "ai", operator: "isEmpty" } })).not.toThrow();
    expect(run({ groupBy: [{ columnId: "ai" }] })).not.toThrow();
    expect(run({ sort: [{ columnId: "name", dir: "asc" }] })).not.toThrow();
  });
});

describe("assertQueryAccess: filterable:false", () => {
  it("rejects a filter condition on an unfilterable column (core validateFilter → INVALID_FILTER)", () => {
    const err = catchErr(run({ filter: { op: "and", children: [{ columnId: "blob", operator: "contains", value: "x" }] } }));
    expect(err).toBeInstanceOf(FilterValidationError);
    expect((err as FilterValidationError).code).toBe("INVALID_FILTER");
    expect((err as FilterValidationError).errors.map((e) => e.code)).toContain("unfilterableColumn");
  });

  it("an unfilterable column may still be sorted", () => {
    expect(run({ sort: [{ columnId: "blob", dir: "asc" }] })).not.toThrow();
  });
});
