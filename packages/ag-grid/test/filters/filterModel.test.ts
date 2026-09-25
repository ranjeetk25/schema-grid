import { describe, expect, it } from "vitest";
import { astToFilterModel, filterModelToAst } from "../../src/filters/filterModel";
import { createDefaultRegistry, validateFilter, type FilterCondition, type FilterGroup, type FilterNode } from "../../src/internal/core";
import { fixtureSchema } from "../fixtures/schema";

const readableIds = fixtureSchema.columns.map((c) => c.id);
const registry = createDefaultRegistry();

function assertDepthOk(node: FilterNode | null): void {
  const errors = validateFilter(node, fixtureSchema, registry, readableIds);
  expect(errors.filter((e) => e.code === "depthExceeded")).toEqual([]);
}

const isPaid: FilterCondition = { columnId: "payment", operator: "is", value: "paid" };
const scoreGt: FilterCondition = { columnId: "score", operator: "gt", value: 5 };
const nameContains: FilterCondition = { columnId: "name", operator: "contains", value: "a" };

describe("astToFilterModel", () => {
  it("treats a single bare condition as a flat AND of one", () => {
    const { model, residual, advancedColumnIds } = astToFilterModel(isPaid);
    expect(model).toEqual({ payment: isPaid });
    expect(residual).toBeNull();
    expect(advancedColumnIds).toEqual([]);
  });

  it("pulls out top-level AND conditions that are the only condition on their column", () => {
    const ast: FilterGroup = { op: "and", children: [isPaid, scoreGt] };
    const { model, residual, advancedColumnIds } = astToFilterModel(ast);
    expect(model).toEqual({ payment: isPaid, score: scoreGt });
    expect(residual).toBeNull();
    expect(advancedColumnIds).toEqual([]);
  });

  it("puts an OR group entirely into residual", () => {
    const ast: FilterGroup = { op: "or", children: [isPaid, scoreGt] };
    const { model, residual, advancedColumnIds } = astToFilterModel(ast);
    expect(model).toEqual({});
    expect(residual).toEqual(ast);
    expect(advancedColumnIds).toEqual([]);
  });

  it("sends both conditions on a repeated column to residual and flags the column", () => {
    const secondPaymentCond: FilterCondition = { columnId: "payment", operator: "isNot", value: "failed" };
    const ast: FilterGroup = { op: "and", children: [isPaid, secondPaymentCond, scoreGt] };
    const { model, residual, advancedColumnIds } = astToFilterModel(ast);
    expect(model).toEqual({ score: scoreGt });
    expect(residual).toEqual({ op: "and", children: [isPaid, secondPaymentCond] });
    expect(advancedColumnIds).toEqual(["payment"]);
  });

  it("sends a column inside a nested group entirely to residual and flags it", () => {
    const nested: FilterGroup = { op: "or", children: [nameContains, scoreGt] };
    const ast: FilterGroup = { op: "and", children: [isPaid, nested] };
    const { model, residual, advancedColumnIds } = astToFilterModel(ast);
    expect(model).toEqual({ payment: isPaid });
    expect(residual).toEqual(nested);
    expect(advancedColumnIds.sort()).toEqual(["name", "score"]);
  });

  it("returns an empty model and null residual for a null ast", () => {
    const { model, residual, advancedColumnIds } = astToFilterModel(null);
    expect(model).toEqual({});
    expect(residual).toBeNull();
    expect(advancedColumnIds).toEqual([]);
  });
});

describe("filterModelToAst", () => {
  it("returns null when both model and residual are empty", () => {
    expect(filterModelToAst({}, null)).toBeNull();
  });

  it("returns a bare condition for exactly one model condition and no residual", () => {
    const ast = filterModelToAst({ payment: isPaid }, null);
    expect(ast).toEqual(isPaid);
    assertDepthOk(ast);
  });

  it("returns an AND group for 2+ model conditions", () => {
    const ast = filterModelToAst({ payment: isPaid, score: scoreGt }, null);
    expect(ast).toEqual({ op: "and", children: [isPaid, scoreGt] });
    assertDepthOk(ast);
  });

  it("flattens an AND residual into the root rather than nesting it", () => {
    const secondPaymentCond: FilterCondition = { columnId: "payment", operator: "isNot", value: "failed" };
    const residual: FilterGroup = { op: "and", children: [isPaid, secondPaymentCond] };
    const ast = filterModelToAst({ score: scoreGt }, residual);
    expect(ast).toEqual({ op: "and", children: [scoreGt, isPaid, secondPaymentCond] });
    assertDepthOk(ast);
  });

  it("nests an OR residual as one child, never deeper than 2", () => {
    const residual: FilterGroup = { op: "or", children: [nameContains, scoreGt] };
    const ast = filterModelToAst({ payment: isPaid }, residual);
    expect(ast).toEqual({ op: "and", children: [isPaid, residual] });
    assertDepthOk(ast);
  });

  it("returns the residual alone when the model is empty", () => {
    const residual: FilterGroup = { op: "or", children: [nameContains, scoreGt] };
    const ast = filterModelToAst({}, residual);
    expect(ast).toEqual(residual);
    assertDepthOk(ast);
  });
});

describe("round trip", () => {
  it("gives back the same AST for a flat AND", () => {
    const ast: FilterGroup = { op: "and", children: [isPaid, scoreGt, nameContains] };
    const { model, residual } = astToFilterModel(ast);
    const rebuilt = filterModelToAst(model, residual);
    // Normalised: astToFilterModel/filterModelToAst always emit an AND group for 2+ conditions.
    expect(rebuilt).toEqual(ast);
  });

  it("clearing one column's model entry removes only its condition", () => {
    const ast: FilterGroup = { op: "and", children: [isPaid, scoreGt, nameContains] };
    const { model, residual } = astToFilterModel(ast);
    const { score, ...rest } = model;
    void score;
    const rebuilt = filterModelToAst(rest, residual);
    expect(rebuilt).toEqual({ op: "and", children: [isPaid, nameContains] });
  });

  it("round trips a column-repeat + OR-nested case through validateFilter cleanly", () => {
    const nested: FilterGroup = { op: "or", children: [nameContains, scoreGt] };
    const secondPaymentCond: FilterCondition = { columnId: "payment", operator: "isNot", value: "failed" };
    const ast: FilterGroup = { op: "and", children: [isPaid, secondPaymentCond, nested] };
    const { model, residual } = astToFilterModel(ast);
    expect(model).toEqual({});
    const rebuilt = filterModelToAst(model, residual);
    assertDepthOk(rebuilt);
  });
});
