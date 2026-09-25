import { evaluate } from "../formula/evaluate";
import { getFormulaEvaluationOrder } from "../formula/graph";
import { parseFormula } from "../formula/parser";
import { type FormulaEnv, isFormulaError } from "../formula/types";
import type { GridRow } from "../rows/types";
import type { GridSchema } from "../schema/types";

/**
 * Writes every formula column's value into `row.cells` (mutates `row`), in
 * dependency order. Formula errors (including cycles) materialise as null.
 */
export function materializeFormulas(row: GridRow, schema: GridSchema, env: FormulaEnv): void {
  const formulaCols = schema.columns.filter((c) => c.type === "formula");
  if (formulaCols.length === 0) return;
  const order = getFormulaEvaluationOrder(schema);
  const keys = isFormulaError(order) ? formulaCols.map((c) => c.key) : order;
  const byKey = new Map(formulaCols.map((c) => [c.key, c]));
  for (const key of keys) {
    const col = byKey.get(key);
    if (!col) continue;
    const ast = typeof col.formula === "string" ? parseFormula(col.formula) : null;
    if (ast === null || isFormulaError(ast)) {
      row.cells[key] = null;
      continue;
    }
    const value = evaluate(ast, row, schema, env);
    row.cells[key] = isFormulaError(value) ? null : value;
  }
}

/** Returns a copy of `row` whose cells only contain the given column keys. */
export function projectRow<Row extends GridRow>(row: Row, readableKeys: ReadonlySet<string>): Row {
  const cells: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row.cells)) {
    if (readableKeys.has(key)) cells[key] = structuredClone(value);
  }
  return { ...structuredClone(row), cells };
}
