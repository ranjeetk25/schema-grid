import { type SQL, sql } from "drizzle-orm";
import { UnsupportedOperatorError } from "../errors";
import type { ColumnDef } from "../internal/core";
import { generatedColumnName, jsonPath } from "../storage/keys";
import type { SqlScope } from "./scope";
import { type StorageKind, storageKindOf } from "./storage-kind";

export const TEXT_COLLATION = "utf8mb4_0900_ai_ci";

export interface ColumnExpr {
  column: ColumnDef;
  kind: StorageKind;
  source: "physical" | "generated" | "json" | "formula";
  /** Untyped value: `JSON_EXTRACT(cells, '$.key[sub]')` for JSON, else the column. */
  raw: SQL;
  /** Typed comparable expression (see `typedJsonExpr`). For `multi` it is the JSON id array. */
  typed: SQL;
  /** Predicate that is TRUE when the cell is empty (absent, JSON null, '' for text-like, [] for multi). */
  empty: SQL;
}

const CELLS = sql.identifier("cells");

/** Unqualified backtick-quoted identifier as an SQL fragment. */
export function ident(name: string): SQL {
  return sql`${sql.identifier(name)}`;
}

/** `JSON_EXTRACT(`cells`, '<path>')`. The path is built from a validated key, so inlining is safe. */
export function jsonExtract(key: string, subPath?: string): SQL {
  return sql`JSON_EXTRACT(${CELLS}, ${sql.raw(`'${jsonPath(key, subPath)}'`)})`;
}

/** The datetime cast shared by filter expressions and generated-column DDL. */
export function datetimeCast(inner: SQL): SQL {
  return sql`CAST(REPLACE(REPLACE(${inner}, 'T', ' '), 'Z', '') AS DATETIME(3))`;
}

/** Typed form of a JSON value extracted from `raw`. Exactly what `gc_<key>` columns are generated from. */
export function typedFromRaw(raw: SQL, kind: StorageKind): SQL {
  switch (kind) {
    case "text":
    case "choice":
    case "ref":
      return sql`JSON_UNQUOTE(${raw}) COLLATE ${sql.raw(TEXT_COLLATION)}`;
    case "number":
      return sql`CAST(${raw} AS DECIMAL(38,10))`;
    case "date":
      return sql`CAST(JSON_UNQUOTE(${raw}) AS DATE)`;
    case "datetime":
      return datetimeCast(sql`JSON_UNQUOTE(${raw})`);
    case "boolean":
      // 1 / 0, NULL when absent. JSON booleans unquote to 'true' / 'false'.
      return sql`(JSON_UNQUOTE(${raw}) = 'true')`;
    default:
      return raw;
  }
}

export function typedJsonExpr(key: string, kind: StorageKind, subPath?: string): SQL {
  return typedFromRaw(jsonExtract(key, subPath), kind);
}

const TEXTISH: ReadonlySet<StorageKind> = new Set(["text", "choice", "ref"]);

function jsonEmpty(key: string, kind: StorageKind, subPath: string | undefined): SQL {
  const base = jsonExtract(key);
  const parts: SQL[] = [sql`${base} IS NULL`, sql`JSON_TYPE(${base}) = 'NULL'`];
  if (TEXTISH.has(kind)) parts.push(sql`${typedJsonExpr(key, kind, subPath)} = ''`);
  if (kind === "multi") parts.push(sql`JSON_LENGTH(${base}) = 0`);
  return sql`(${sql.join(parts, sql` OR `)})`;
}

function columnEmpty(expr: SQL, kind: StorageKind): SQL {
  if (TEXTISH.has(kind)) return sql`(${expr} IS NULL OR ${expr} = '')`;
  if (kind === "multi") return sql`(${expr} IS NULL OR JSON_LENGTH(${expr}) = 0)`;
  return sql`(${expr} IS NULL)`;
}

/**
 * The single resolver for "where does this column's value live in SQL".
 * Order: physical `source.valueField` → `gc_<key>` (indexed, when assumed present) → JSON in `cells`.
 * Formula columns resolve through `scope.formulaPlans` (T15).
 */
export function resolveColumnExpr(column: ColumnDef, scope: SqlScope): ColumnExpr {
  const info = storageKindOf(column, scope.ctx.registry, scope.storageOverrides);
  const kind = info.kind;

  if (column.type === "formula") {
    const plan = scope.formulaPlans?.get(column.id);
    if (!plan || plan.mode === "fallback" || !plan.sql) {
      throw new UnsupportedOperatorError("formula", { columnId: column.id, kind: "formula-fallback" });
    }
    const expr =
      plan.mode === "generated" && scope.generatedColumns === "assumePresent"
        ? ident(generatedColumnName(column.key))
        : plan.sql;
    const source = plan.mode === "generated" && scope.generatedColumns === "assumePresent" ? "generated" : "formula";
    return { column, kind: plan.resultKind, source, raw: expr, typed: expr, empty: columnEmpty(expr, plan.resultKind) };
  }

  if (column.source) {
    const physical = scope.tables.physical[column.source.valueField];
    if (!physical) {
      throw new UnsupportedOperatorError("source", { columnId: column.id, kind: `unknown valueField ${column.source.valueField}` });
    }
    const expr = ident(physical.name);
    return { column, kind, source: "physical", raw: expr, typed: expr, empty: columnEmpty(expr, kind) };
  }

  if (column.indexed && scope.generatedColumns === "assumePresent" && kind !== "multi" && kind !== "json") {
    const expr = ident(generatedColumnName(column.key));
    return { column, kind, source: "generated", raw: expr, typed: expr, empty: columnEmpty(expr, kind) };
  }

  const raw = jsonExtract(column.key, info.subPath);
  return {
    column,
    kind,
    source: "json",
    raw,
    typed: kind === "multi" || kind === "json" ? raw : typedFromRaw(raw, kind),
    empty: jsonEmpty(column.key, kind, info.subPath),
  };
}

/** Predicate TRUE when the column is empty for this row. */
export function isEmptyExpr(column: ColumnDef, scope: SqlScope): SQL {
  return resolveColumnExpr(column, scope).empty;
}
