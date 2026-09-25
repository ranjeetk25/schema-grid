import { createServerContext } from "../context";
import { defineGridTables } from "../storage/tables";
import { type SQL, sql } from "drizzle-orm";
import { type ColumnDef, type FormulaResultType, inferResultType, isFormulaError, parseFormula } from "../internal/core";
import type { FormulaPlan, SqlScope } from "../sql/scope";
import { formulaResultKind } from "../sql/storage-kind";
import { type FormulaToSqlOptions, formulaToSql } from "./formula-to-sql";

type PlanScope = Omit<SqlScope, "formulaPlans">;

function resultTypeOf(column: ColumnDef): FormulaResultType | undefined {
  return (column.config as { resultType?: FormulaResultType } | null)?.resultType;
}

/** Wrap a translated expression in the cast for the column's declared result type. */
function wrapResult(expr: SQL, resultType: FormulaResultType | undefined): SQL {
  return resultType === "number" ? sql`CAST((${expr}) AS DECIMAL(38,10))` : sql`(${expr})`;
}

/**
 * Result-typed SQL for a formula column, or null when it is not a formula,
 * does not parse, disagrees with its declared `config.resultType`, has a date
 * result, or falls outside the translatable subset.
 */
function translateColumn(column: ColumnDef, scope: PlanScope, options: FormulaToSqlOptions): SQL | null {
  if (column.type !== "formula" || !column.formula) return null;
  const ast = parseFormula(column.formula);
  if (isFormulaError(ast)) return null;
  const declared = resultTypeOf(column);
  if (declared === "date") return null;
  const inferred = inferResultType(ast, scope.ctx.schema);
  if (isFormulaError(inferred) || (declared !== undefined && inferred !== declared)) return null;
  const expr = formulaToSql(ast, scope, { ...options, visiting: new Set([column.key]) });
  return expr ? wrapResult(expr, declared) : null;
}

/**
 * How each formula column is filtered/sorted:
 * - `generated`: `indexed` and translatable (materialized as `gc_<key>`);
 * - `inline`: translatable, not indexed (expression inlined into queries);
 * - `fallback`: not translatable (in-memory evaluation, T16). No `sql`.
 */
export function planFormulaColumns(scope: PlanScope): Map<string, FormulaPlan> {
  const plans = new Map<string, FormulaPlan>();
  for (const column of scope.ctx.schema.columns) {
    if (column.type !== "formula") continue;
    const resultKind = formulaResultKind(resultTypeOf(column));
    const expr = translateColumn(column, scope, {});
    if (!expr) plans.set(column.id, { mode: "fallback", resultKind });
    else plans.set(column.id, { mode: column.indexed ? "generated" : "inline", sql: expr, resultKind });
  }
  return plans;
}

/**
 * The generated-column expression for a formula column (the `formulaSql` hook
 * of `generatedColumnDDL`): same SQL as the plan, but with literals inlined so
 * the DDL carries no params. Null when the formula is not translatable.
 */
export function formulaGeneratedSql(column: ColumnDef, scope: PlanScope): SQL | null {
  return translateColumn(column, scope, { inlineLiterals: true });
}

/**
 * `ValidateSchemaOptions.isFormulaTranslatable` implementation: plans the
 * schema's formulas once per (schema, registry) and reports whether a column
 * is in the SQL-translatable subset.
 */
export function formulaTranslatability(): (
  column: ColumnDef,
  schema: import("../internal/core").GridSchema,
  registry: import("../internal/core").FieldTypeRegistry,
) => boolean {
  const cache = new WeakMap<object, Map<string, FormulaPlan>>();
  return (column, schema, registry) => {
    let plans = cache.get(schema);
    if (!plans) {
      const ctx = createServerContext({
        schema,
        registry,
        resolver: () => "read",
        user: { id: "schema-validation", roles: [] },
      });
      const tables = defineGridTables({ rowsTable: "validate_rows", changeLogTable: "validate_log" });
      plans = planFormulaColumns({ ctx, tables, generatedColumns: "ignore" });
      cache.set(schema, plans);
    }
    const plan = plans.get(column.id);
    return plan !== undefined && plan.mode !== "fallback";
  };
}
