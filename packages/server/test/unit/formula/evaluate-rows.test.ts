import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAccess } from "../../../src/access/query-access";
import { evaluateFormulaCells, formulaAsts } from "../../../src/formula/evaluate-rows";
import type { GridRow } from "../../../src/internal/core";
import { col, makeCtx } from "../../helpers/schemas";

const schema = {
  id: "g",
  schemaVersion: 1,
  columns: [
    col("fee", "currency"),
    col("paid", "number"),
    col("salary", "number", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
    col("balance", "formula", { formula: "{fee} - {paid}", config: { resultType: "number" } }),
    col("double", "formula", { formula: "{balance} * 2", config: { resultType: "number" } }),
    col("net", "formula", { formula: "{salary} - {fee}", config: { resultType: "number" } }),
    col("ratio", "formula", { formula: "{fee} / {paid}", config: { resultType: "number" } }),
    col("label", "formula", { formula: "CONCAT({fee}, \"x\")", config: { resultType: "text" } }),
  ],
};
const row = (cells: Record<string, unknown>): GridRow => ({ id: "r1", version: 1, updatedAt: "x", cells });

afterEach(() => vi.restoreAllMocks());

describe("evaluateFormulaCells", () => {
  it("rows gain formula values (incl. nested formula refs; empty operands count as 0; ÷0 → empty)", () => {
    const ctx = makeCtx(schema);
    const [out] = evaluateFormulaCells([row({ fee: 50000, paid: 20000, salary: 1 })], resolveAccess(ctx), ctx);
    expect(out?.cells).toMatchObject({ balance: 30000, double: 60000, net: -49999, ratio: 2.5 });
    const [noPaid] = evaluateFormulaCells([row({ fee: 50000, paid: 0 })], resolveAccess(ctx), ctx);
    expect(noPaid?.cells.balance).toBe(50000);
    expect(noPaid?.cells).not.toHaveProperty("ratio");
  });

  it("a hidden formula is not evaluated or returned (even if a stale value was present)", () => {
    const ctx = makeCtx(schema, { user: { id: "c", roles: ["counsellor"] } });
    const [out] = evaluateFormulaCells([row({ fee: 10, paid: 1, net: 999 })], resolveAccess(ctx), ctx);
    expect(out?.cells).not.toHaveProperty("net");
    expect(out?.cells.balance).toBe(9);
  });

  it("evaluation errors become empty and are logged, never thrown", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeCtx(schema);
    const [out] = evaluateFormulaCells([row({ fee: 1 })], resolveAccess(ctx), ctx);
    expect(out?.cells).not.toHaveProperty("label");
    expect(spy).toHaveBeenCalled();
  });

  it.todo("CONCAT/TODAY/DATEADD etc. evaluate via core `evaluate` (TODO(core): shim only evaluates the SQL subset)");

  it("parses once per schema", () => {
    expect(formulaAsts(schema)).toBe(formulaAsts(schema));
  });

  it("does not mutate input rows", () => {
    const ctx = makeCtx(schema);
    const input = row({ fee: 2, paid: 1 });
    evaluateFormulaCells([input], resolveAccess(ctx), ctx);
    expect(input.cells).toEqual({ fee: 2, paid: 1 });
  });
});
