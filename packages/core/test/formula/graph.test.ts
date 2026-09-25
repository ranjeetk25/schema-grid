import { describe, expect, it } from "vitest";
import {
  detectFormulaCycles,
  getFormulaEvaluationOrder,
  validateFormulaColumns,
} from "../../src/formula/graph";
import { isFormulaError } from "../../src/formula/types";
import type { ColumnDef, GridSchema } from "../../src/schema/types";

const TS = "2026-09-01T00:00:00.000Z";
function col(key: string, type: string, formula?: string, config: unknown = {}): ColumnDef {
  return {
    id: `id_${key}`,
    key,
    label: key,
    type,
    config: type === "formula" ? { resultType: "number" } : config,
    order: 0,
    createdAt: TS,
    updatedAt: TS,
    ...(formula !== undefined ? { formula } : {}),
  };
}
function schema(...columns: ColumnDef[]): GridSchema {
  return { id: "s", schemaVersion: 1, columns };
}
const base = [col("fee", "currency"), col("paid", "number")];

describe("formula graph", () => {
  it("detects a two-column cycle and reports it everywhere", () => {
    const s = schema(...base, col("A", "formula", "{B} + 1"), col("B", "formula", "{A} + 1"));
    expect(detectFormulaCycles(s)).toEqual([["A", "B"]]);
    const errors = validateFormulaColumns(s);
    expect(errors.get("id_A")?.code).toBe("cycle");
    expect(errors.get("id_B")?.code).toBe("cycle");
    const order = getFormulaEvaluationOrder(s);
    expect(isFormulaError(order) && order.code).toBe("cycle");
  });

  it("treats a self-reference as a cycle", () => {
    const s = schema(col("A", "formula", "{A}"));
    expect(detectFormulaCycles(s)).toEqual([["A"]]);
    expect(validateFormulaColumns(s).get("id_A")?.code).toBe("cycle");
  });

  it("reports a three-column cycle once with all keys", () => {
    const s = schema(
      col("A", "formula", "{B}"),
      col("B", "formula", "{C}"),
      col("C", "formula", "{A}"),
    );
    const cycles = detectFormulaCycles(s);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["A", "B", "C"]);
  });

  it("orders dependencies first", () => {
    const s = schema(...base, col("C", "formula", "{B} * 2"), col("B", "formula", "{fee} - {paid}"));
    expect(getFormulaEvaluationOrder(s)).toEqual(["B", "C"]);
    expect(detectFormulaCycles(s)).toEqual([]);
    expect(validateFormulaColumns(s).size).toBe(0);
  });

  it("never includes non-formula columns in the order", () => {
    const s = schema(...base, col("B", "formula", "{fee} - {paid}"));
    expect(getFormulaEvaluationOrder(s)).toEqual(["B"]);
  });

  it("reports syntax errors per column without stopping other validation", () => {
    const s = schema(
      ...base,
      col("bad", "formula", "1 +"),
      col("unknown", "formula", "{missing} + 1"),
      col("ok", "formula", "{fee} - {paid}"),
      col("noSrc", "formula"),
    );
    const errors = validateFormulaColumns(s);
    expect(errors.get("id_bad")?.code).toBe("syntax");
    expect(errors.get("id_unknown")?.code).toBe("unknownColumn");
    expect(errors.get("id_noSrc")?.code).toBe("syntax");
    expect(errors.has("id_ok")).toBe(false);
    expect(getFormulaEvaluationOrder(s)).toEqual(["bad", "unknown", "ok", "noSrc"]);
  });
});
