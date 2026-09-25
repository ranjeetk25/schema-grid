import { evaluate } from "../formula/evaluate";
import { parseFormula } from "../formula/parser";
import { type FormulaEnv, type FormulaNode, isFormulaError } from "../formula/types";
import type { GridRow } from "../rows/types";
import type { GridSchema } from "../schema/types";

const astCache = new Map<string, FormulaNode | null>();

function parseCached(source: string): FormulaNode | null {
  let ast = astCache.get(source);
  if (ast === undefined) {
    const parsed = parseFormula(source);
    ast = isFormulaError(parsed) ? null : parsed;
    if (astCache.size > 1000) astCache.clear();
    astCache.set(source, ast);
  }
  return ast;
}

/**
 * Writes every formula column's value into `row.cells` (mutates `row`).
 * `evaluate` recomputes formula refs from source, so no ordering is needed.
 * Formula errors (including cycles) materialise as null.
 */
export function materializeFormulas(row: GridRow, schema: GridSchema, env: FormulaEnv): void {
  for (const col of schema.columns) {
    if (col.type !== "formula") continue;
    const ast = typeof col.formula === "string" ? parseCached(col.formula) : null;
    const value = ast ? evaluate(ast, row, schema, env) : null;
    row.cells[col.key] = isFormulaError(value) ? null : value;
  }
}

/** Removes formula values (the store only keeps editable data; formulas are computed on read). */
export function stripFormulas(row: GridRow, schema: GridSchema): void {
  for (const col of schema.columns) {
    if (col.type === "formula") delete row.cells[col.key];
  }
}

/** A deep copy of `row` with formulas computed for `env`. */
export function materialized<Row extends GridRow>(row: Row, schema: GridSchema, env: FormulaEnv): Row {
  const copy = structuredClone(row);
  materializeFormulas(copy, schema, env);
  return copy;
}

/** Returns a copy of `row` whose cells only contain the given column keys. */
export function projectRow<Row extends GridRow>(row: Row, readableKeys: ReadonlySet<string>): Row {
  const cells: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row.cells)) {
    if (readableKeys.has(key)) cells[key] = structuredClone(value);
  }
  return { ...structuredClone({ ...row, cells: {} }), cells };
}
