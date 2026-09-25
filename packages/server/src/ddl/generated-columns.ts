import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { SchemaValidationError } from "../errors";
import { formulaGeneratedSql } from "../formula/formula-plan";
import type { ColumnDef, FormulaResultType } from "../internal/core";
import { TEXT_COLLATION, typedJsonExpr } from "../sql/column-expr";
import type { SqlScope } from "../sql/scope";
import { type StorageKind, type StorageOverrides, formulaResultKind, storageKindOf } from "../sql/storage-kind";
import { assertSafeColumnKey, generatedColumnName, generatedIndexName } from "../storage/keys";
import type { DdlStatement } from "./tables-ddl";

export interface GeneratedColumnOptions {
  /**
   * Result-typed SQL for a formula column, with literals inlined (no bound
   * params) — e.g. `formulaSqlHook(scope)`. Absent, or returning `null`,
   * rejects the column with `SchemaValidationError` code `formulaNotTranslatable`.
   */
  formulaSql?: (column: ColumnDef) => SQL | null;
  storageOverrides?: StorageOverrides;
}

const dialect = new MySqlDialect();

/**
 * Text-ish generated columns declare `TEXT_COLLATION` explicitly: comparisons on
 * `gc_<key>` use the COLUMN's collation (not the `COLLATE` inside the generation
 * expression), so without it they would silently follow the table default.
 */
const TEXT_GC_TYPE = `VARCHAR(191) CHARACTER SET utf8mb4 COLLATE ${TEXT_COLLATION}`;

const SQL_TYPE_BY_KIND: Readonly<Partial<Record<StorageKind, string>>> = {
  text: TEXT_GC_TYPE,
  choice: TEXT_GC_TYPE,
  ref: TEXT_GC_TYPE,
  number: "DECIMAL(38,10)",
  date: "DATE",
  datetime: "DATETIME(3)",
  boolean: "TINYINT(1)",
};

function quoteIdent(name: string): string {
  return `\`${name}\``;
}

function notIndexable(column: ColumnDef, reason: string): never {
  throw new SchemaValidationError([
    {
      code: "notIndexable",
      columnId: column.id,
      path: ["indexed"],
      message: `Column "${column.id}" (${column.type}) cannot be indexed: ${reason}`,
    },
  ]);
}

function formulaNotTranslatable(column: ColumnDef): never {
  throw new SchemaValidationError([
    {
      code: "formulaNotTranslatable",
      columnId: column.id,
      path: ["formula"],
      message: `Formula column "${column.id}" is not SQL-translatable and cannot be indexed`,
    },
  ]);
}

/** Renders `expr` to plain SQL text for DDL. Throws if it carries any bound param. */
function renderNoParams(expr: SQL, column: ColumnDef): string {
  const { sql: text, params } = dialect.sqlToQuery(expr);
  if (params.length > 0) {
    throw new SchemaValidationError([
      {
        code: "notIndexable",
        columnId: column.id,
        path: ["indexed"],
        message: `Generated-column expression for column "${column.id}" must not use bound parameters`,
      },
    ]);
  }
  return text;
}

/**
 * DDL for a `gc_<key>` VIRTUAL generated column plus its index, for an
 * `indexed: true` column. JSON-sourced columns use the same typed expression
 * as `resolveColumnExpr` (T5), byte for byte. Formula columns use
 * `options.formulaSql`.
 */
export function generatedColumnDDL(table: string, column: ColumnDef, options: GeneratedColumnOptions = {}): DdlStatement {
  assertSafeColumnKey(table);
  if (column.source) notIndexable(column, "physical-source columns are indexed by the consumer");

  let kind: StorageKind;
  let expr: SQL;

  if (column.type === "formula") {
    const resultType = (column.config as { resultType?: FormulaResultType } | null)?.resultType;
    kind = formulaResultKind(resultType);
    const formulaExpr = options.formulaSql?.(column) ?? null;
    if (!formulaExpr) formulaNotTranslatable(column);
    expr = formulaExpr;
  } else {
    if (column.type === "longText") notIndexable(column, "longText columns are not indexable");
    const info = storageKindOf(column, undefined, options.storageOverrides);
    kind = info.kind;
    if (kind === "multi") notIndexable(column, "multi-valued columns are not indexable");
    if (kind === "json") notIndexable(column, "unknown/custom-typed columns are not indexable");
    expr = typedJsonExpr(column.key, kind, info.subPath);
  }

  const sqlType = SQL_TYPE_BY_KIND[kind];
  if (!sqlType) notIndexable(column, `no generated-column SQL type for storage kind "${kind}"`);

  const gcName = generatedColumnName(column.key);
  const idxName = generatedIndexName(column.key);
  const exprText = renderNoParams(expr, column);

  const alterSql = `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(gcName)} ${sqlType} GENERATED ALWAYS AS (${exprText}) VIRTUAL, ADD INDEX ${quoteIdent(idxName)} (${quoteIdent(gcName)})`;

  return {
    sql: alterSql,
    description: `Add generated column \`${gcName}\` and index \`${idxName}\` on \`${table}\``,
  };
}

/**
 * Convenience `formulaSql` hook that wraps `formulaGeneratedSql` (T15) over a
 * fixed SQL scope, for passing straight into `generatedColumnDDL`/`diffIndexedColumns`.
 */
export function formulaSqlHook(scope: Omit<SqlScope, "formulaPlans">): (column: ColumnDef) => SQL | null {
  return (column) => formulaGeneratedSql(column, scope);
}

/** DDL to remove a column's generated column and its index. */
export function dropGeneratedColumnDDL(table: string, key: string): DdlStatement {
  assertSafeColumnKey(table);
  const gcName = generatedColumnName(key);
  const idxName = generatedIndexName(key);
  return {
    sql: `ALTER TABLE ${quoteIdent(table)} DROP INDEX ${quoteIdent(idxName)}, DROP COLUMN ${quoteIdent(gcName)}`,
    description: `Drop generated column \`${gcName}\` and index \`${idxName}\` on \`${table}\``,
  };
}
