import type { AccessMap } from "../access/query-access";
import { isReadable } from "../access/query-access";
import type { ServerContext } from "../context";
import {
  type FormulaNode,
  type GridRow,
  type GridSchema,
  evaluate,
  isEmptyValue,
  isFormulaError,
  parseFormula,
} from "../internal/core";

const astCache = new WeakMap<GridSchema, Map<string, FormulaNode | null>>();
const byIdVersion = new Map<string, { schema: GridSchema; asts: Map<string, FormulaNode | null> }>();

/** Parses each formula once per schema (memoized by schema object, then by `id@schemaVersion`). */
export function formulaAsts(schema: GridSchema): Map<string, FormulaNode | null> {
  const cached = astCache.get(schema);
  if (cached) return cached;
  const versionKey = `${schema.id}@${schema.schemaVersion}`;
  const byVersion = byIdVersion.get(versionKey);
  if (byVersion && byVersion.schema.columns.length === schema.columns.length) {
    astCache.set(schema, byVersion.asts);
    return byVersion.asts;
  }
  const asts = new Map<string, FormulaNode | null>();
  for (const c of schema.columns) {
    if (c.type !== "formula") continue;
    const ast = c.formula ? parseFormula(c.formula) : null;
    asts.set(c.id, ast && !isFormulaError(ast) ? ast : null);
  }
  astCache.set(schema, asts);
  byIdVersion.set(versionKey, { schema, asts });
  return asts;
}

/**
 * Fills `cells[key]` for every READABLE formula column with core `evaluate`
 * (env: `ctx.now()`, `ctx.tz`). Hidden formulas are neither evaluated nor
 * returned. Evaluation errors become empty (key absent) and are logged, never thrown.
 * Returns new row objects; input rows are not mutated.
 */
export function evaluateFormulaCells<Row extends GridRow>(rows: Row[], access: AccessMap, ctx: ServerContext): Row[] {
  const schema = ctx.schema;
  const formulas = schema.columns.filter((c) => c.type === "formula");
  if (formulas.length === 0 || rows.length === 0) return rows;
  const asts = formulaAsts(schema);
  const env = { now: ctx.now(), tz: ctx.tz };
  return rows.map((row) => {
    const cells: Record<string, unknown> = { ...row.cells };
    for (const column of formulas) {
      delete cells[column.key];
      if (!isReadable(access, column.id)) continue;
      const ast = asts.get(column.id);
      if (!ast) continue;
      const value = evaluate(ast, row, schema, env);
      if (isFormulaError(value)) {
        console.error(`[schema-grid-server] formula ${column.id} failed on row ${row.id}: ${value.message}`);
        continue;
      }
      if (!isEmptyValue(value)) cells[column.key] = value;
    }
    return { ...row, cells };
  });
}
