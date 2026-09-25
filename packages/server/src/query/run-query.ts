import { type AccessMap, resolveAccess } from "../access/query-access";
import { evaluateFormulaCells } from "../formula/evaluate-rows";
import { executeFallbackQuery, fallbackColumnIds } from "../formula/fallback";
import { planFormulaColumns } from "../formula/formula-plan";
import type { GridQuery, GridRow, QueryResult } from "../internal/core";
import { type GridSqlScope, type SelectCapableDb, buildQuery } from "./build-query";
import { executeQuery } from "./execute-query";

/**
 * Row query entry point: SQL path (filter/sort fully in MySQL, formulas
 * evaluated on the returned page) or, when the query filters/sorts on a
 * non-translatable formula, the capped in-memory fallback.
 */
export async function runRowQuery(
  query: GridQuery,
  scope: GridSqlScope,
  db: SelectCapableDb,
  access: AccessMap = resolveAccess(scope.ctx),
): Promise<QueryResult<GridRow>> {
  const formulaPlans = scope.formulaPlans ?? planFormulaColumns(scope);
  const planned: GridSqlScope = { ...scope, formulaPlans };
  if (fallbackColumnIds(query, formulaPlans).length > 0) {
    return executeFallbackQuery(query, planned, db, access);
  }
  const built = buildQuery(query, planned, db, access);
  return executeQuery(built, planned, { transformRows: (rows) => evaluateFormulaCells(rows, access, scope.ctx) });
}
