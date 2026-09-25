import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { UnsupportedOperatorError } from "../errors";
import type { ColumnDef } from "../internal/core";
import { generatedColumnName, jsonPath } from "../storage/keys";
import type { SqlScope } from "./scope";
import { type StorageKind, storageKindOf } from "./storage-kind";

/**
 * Collation of every text-ish typed expression (and of text `gc_<key>` columns /
 * the rows-table default). Case-INsensitive but accent-SENSITIVE, matching core's
 * `toLowerCase()` text matching: "jose" matches "JOSE" but not "José".
 * (`utf8mb4_0900_ai_ci` would also fold accents — a parity bug caught by the
 * MySQL integration suite.) Row ids use `utf8mb4_bin` (see tables-ddl).
 */
export const TEXT_COLLATION = "utf8mb4_0900_as_ci";

export interface ColumnExpr {
  column: ColumnDef;
  kind: StorageKind;
  /** `mapped`: an expression supplied by `createMappedColumnResolver` (e.g. a column of an existing table). */
  source: "physical" | "generated" | "json" | "formula" | "mapped";
  /** Untyped value: `JSON_EXTRACT(cells, '$.key[sub]')` for JSON, else the column. */
  raw: SQL;
  /** Typed comparable expression (see `typedJsonExpr`). For `multi` it is the JSON id array. */
  typed: SQL;
  /**
   * Predicate that is TRUE when the cell is empty — core `isEmptyValue`: absent,
   * JSON null, whitespace-only for text-like, [] for multi. Always two-valued.
   */
  empty: SQL;
}

const CELLS: SQL = sql`${sql.identifier("cells")}`;

/** Unqualified backtick-quoted identifier as an SQL fragment. */
export function ident(name: string): SQL {
  return sql`${sql.identifier(name)}`;
}

/**
 * `JSON_EXTRACT(`cells`, '<path>')`. The path is built from a validated key, so inlining is safe.
 * `cells` defaults to the unqualified `cells` column of the grid rows table.
 */
export function jsonExtract(key: string, subPath?: string, cells: SQL = CELLS): SQL {
  return sql`JSON_EXTRACT(${cells}, ${sql.raw(`'${jsonPath(key, subPath)}'`)})`;
}

/** The datetime cast shared by filter expressions and generated-column DDL. */
export function datetimeCast(inner: SQL): SQL {
  return sql`CAST(REPLACE(REPLACE(${inner}, 'T', ' '), 'Z', '') AS DATETIME(3))`;
}

/**
 * Typed form of a JSON value extracted from `raw`. Exactly what `gc_<key>` columns are generated from.
 * Every form maps absent keys, legacy JSON null and wrongly-typed JSON to SQL NULL (never to 0 / 'null'),
 * so positive operators cannot match them and `empty` stays two-valued.
 */
export function typedFromRaw(raw: SQL, kind: StorageKind): SQL {
  switch (kind) {
    case "text":
    case "choice":
    case "ref":
      return sql`IF(JSON_TYPE(${raw}) = 'NULL', NULL, JSON_UNQUOTE(${raw})) COLLATE ${sql.raw(TEXT_COLLATION)}`;
    case "number":
      return sql`(CASE WHEN JSON_TYPE(${raw}) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(${raw} AS DECIMAL(38,10)) END)`;
    case "date":
      return sql`CAST(IF(JSON_TYPE(${raw}) = 'STRING', JSON_UNQUOTE(${raw}), NULL) AS DATE)`;
    case "datetime":
      return datetimeCast(sql`IF(JSON_TYPE(${raw}) = 'STRING', JSON_UNQUOTE(${raw}), NULL)`);
    case "boolean":
      // 1 / 0 for JSON booleans, NULL for anything else (absent, null, legacy 1/"true").
      return sql`(CASE WHEN JSON_TYPE(${raw}) = 'BOOLEAN' THEN JSON_UNQUOTE(${raw}) = 'true' END)`;
    default:
      return raw;
  }
}

export function typedJsonExpr(key: string, kind: StorageKind, subPath?: string, cells?: SQL): SQL {
  return typedFromRaw(jsonExtract(key, subPath, cells), kind);
}

const TEXTISH: ReadonlySet<StorageKind> = new Set(["text", "choice", "ref"]);

/**
 * TRUE when a (non-NULL) string is empty or whitespace-only — core
 * `isEmptyValue` uses JS `trim()`. ICU `[[:space:]]` covers spaces, tabs,
 * newlines and the Unicode white-space set (`TRIM` would strip spaces only).
 */
export function blankText(expr: SQL): SQL {
  return sql`REGEXP_LIKE(${expr}, '^[[:space:]]*$')`;
}

/** `(x IS NULL OR <blank x>)` — the `IS NULL` guard keeps it two-valued. */
function textEmpty(expr: SQL): SQL {
  return sql`(${expr} IS NULL OR ${blankText(expr)})`;
}

function jsonEmpty(key: string, kind: StorageKind, subPath: string | undefined, cells: SQL): SQL {
  const base = jsonExtract(key, undefined, cells);
  if (kind === "multi" || kind === "json") {
    const parts: SQL[] = [sql`${base} IS NULL`, sql`JSON_TYPE(${base}) = 'NULL'`];
    if (kind === "multi") parts.push(sql`JSON_LENGTH(${base}) = 0`);
    if (kind === "json") {
      // Custom types: core treats whitespace-only strings and [] as empty too.
      parts.push(sql`(JSON_TYPE(${base}) = 'STRING' AND ${blankText(sql`JSON_UNQUOTE(${base})`)})`);
      parts.push(sql`(JSON_TYPE(${base}) = 'ARRAY' AND JSON_LENGTH(${base}) = 0)`);
    }
    return sql`(${sql.join(parts, sql` OR `)})`;
  }
  // Scalars: `typed` is NULL for absent / JSON null / wrong type / missing sub-path leaf.
  const typed = typedJsonExpr(key, kind, subPath, cells);
  return TEXTISH.has(kind) ? textEmpty(typed) : sql`(${typed} IS NULL)`;
}

function columnEmpty(expr: SQL, kind: StorageKind): SQL {
  if (TEXTISH.has(kind)) return textEmpty(expr);
  if (kind === "multi") return sql`(${expr} IS NULL OR JSON_LENGTH(${expr}) = 0)`;
  return sql`(${expr} IS NULL)`;
}

/**
 * The seam between the SQL translators (filter, search, sort, keyset paging,
 * grouping, formulas, `buildQuery`) and WHERE a column's value lives. Every
 * translator resolves columns through `resolveColumnExpr(column, scope)`, which
 * delegates stored (non-formula) columns to `scope.columnExprs` — so one set of
 * operator semantics serves the JSON-cells grid table and existing tables alike.
 *
 * Implementations: `jsonCellsResolver` / `createJsonCellsResolver` (the default:
 * physical `source.valueField` → `gc_<key>` → JSON in `cells`) and
 * `createMappedColumnResolver` (explicit per-key expressions, e.g. the columns
 * of an existing table, with an optional fallback resolver for the rest).
 */
export interface ColumnExprResolver {
  /** Row-id expression: the final ORDER BY tie-breaker and the keyset cursor's `id > ?`. */
  readonly rowId: SQL;
  /** Resolves a stored (non-formula) column. Throws `UnsupportedOperatorError` when it has no SQL form. */
  resolve(column: ColumnDef, scope: SqlScope): ColumnExpr;
  /**
   * Free-text search participation. `undefined` = decided by storage kind
   * (text, choice, ref). Only consulted for readable, non-formula columns.
   */
  searchable?(column: ColumnDef): boolean | undefined;
}

export interface JsonCellsResolverOptions {
  /** The JSON cells document. Default: the unqualified `cells` column. */
  cells?: SQL;
  /** Row id. Default: the unqualified `id` column. */
  rowId?: SQL;
  /** Physical `source.valueField` columns. Default: `scope.tables.physical`. */
  physical?: Readonly<Record<string, AnyMySqlColumn>>;
  /** Whether `gc_<key>` columns exist. Default: `scope.generatedColumns`. */
  generatedColumns?: SqlScope["generatedColumns"];
}

/** A JSON-cells resolver over any `cells` expression (e.g. a LEFT JOINed extension table). */
export function createJsonCellsResolver(options: JsonCellsResolverOptions = {}): ColumnExprResolver {
  const cells = options.cells ?? CELLS;
  const rowId = options.rowId ?? ident("id");
  return {
    rowId,
    resolve(column, scope) {
      const info = storageKindOf(column, scope.ctx.registry, scope.storageOverrides);
      const kind = info.kind;
      if (column.source) {
        const physicalColumns = options.physical ?? scope.tables?.physical ?? {};
        const physical = physicalColumns[column.source.valueField];
        if (!physical) {
          throw new UnsupportedOperatorError("source", { columnId: column.id, kind: `unknown valueField ${column.source.valueField}` });
        }
        const expr = ident(physical.name);
        return { column, kind, source: "physical", raw: expr, typed: expr, empty: columnEmpty(expr, kind) };
      }
      const generated = options.generatedColumns ?? scope.generatedColumns;
      if (column.indexed && generated === "assumePresent" && kind !== "multi" && kind !== "json") {
        const expr = ident(generatedColumnName(column.key));
        return { column, kind, source: "generated", raw: expr, typed: expr, empty: columnEmpty(expr, kind) };
      }
      const raw = jsonExtract(column.key, info.subPath, cells);
      return {
        column,
        kind,
        source: "json",
        raw,
        typed: kind === "multi" || kind === "json" ? raw : typedFromRaw(raw, kind),
        empty: jsonEmpty(column.key, kind, info.subPath, cells),
      };
    },
  };
}

/** The grid rows table resolver: physical `source.valueField` → `gc_<key>` (when assumed present) → JSON in `cells`. */
export const jsonCellsResolver: ColumnExprResolver = createJsonCellsResolver();

/** One explicitly mapped column (see `createMappedColumnResolver`). */
export interface MappedColumn {
  /** Comparable SQL value of the column (a drizzle column or any expression). */
  expr: SQL | AnyColumn;
  /** Storage kind override. Default: derived from the column's field type (`storageKindOf`). */
  kind?: StorageKind;
  /** Include in free-text search. Default: by kind (text, choice, ref). */
  searchable?: boolean;
}

export interface MappedColumnResolverOptions {
  /** Keyed by `ColumnDef.key`. */
  columns: Readonly<Record<string, MappedColumn>>;
  rowId: SQL | AnyColumn;
  /** Resolver for schema columns without a mapping (e.g. extension columns). Default: none → `UnsupportedOperatorError`. */
  fallback?: ColumnExprResolver;
}

/** `SQL | AnyColumn` → `SQL`. */
export function toSql(expr: SQL | AnyColumn): SQL {
  return sql`${expr}`;
}

/**
 * Resolver over explicit expressions: the mapped expression IS the typed value
 * (like a physical column), emptiness is `IS NULL` (+ blank text for text-like
 * kinds, `JSON_LENGTH = 0` for multi). Text comparisons use the expression's own
 * collation — use a case-insensitive, accent-sensitive one (`TEXT_COLLATION`)
 * for exact parity with core's in-memory matching.
 */
export function createMappedColumnResolver(options: MappedColumnResolverOptions): ColumnExprResolver {
  const mapped = new Map<string, { expr: SQL; kind?: StorageKind; searchable?: boolean }>();
  for (const [key, m] of Object.entries(options.columns)) {
    mapped.set(key, { ...m, expr: toSql(m.expr) });
  }
  const fallback = options.fallback;
  return {
    rowId: toSql(options.rowId),
    resolve(column, scope) {
      const m = mapped.get(column.key);
      if (!m) {
        if (fallback) return fallback.resolve(column, scope);
        throw new UnsupportedOperatorError("source", { columnId: column.id, kind: "unmapped column" });
      }
      const kind = m.kind ?? storageKindOf(column, scope.ctx.registry, scope.storageOverrides).kind;
      return { column, kind, source: "mapped", raw: m.expr, typed: m.expr, empty: columnEmpty(m.expr, kind) };
    },
    searchable(column) {
      const m = mapped.get(column.key);
      if (m) return m.searchable;
      return fallback?.searchable?.(column);
    },
  };
}

/** The scope's resolver (default `jsonCellsResolver`). */
export function columnExprResolverOf(scope: Pick<SqlScope, "columnExprs">): ColumnExprResolver {
  return scope.columnExprs ?? jsonCellsResolver;
}

/** The scope's row-id expression (default: the unqualified `id` column). */
export function rowIdExpr(scope: Pick<SqlScope, "columnExprs">): SQL {
  return columnExprResolverOf(scope).rowId;
}

/**
 * The single entry point for "where does this column's value live in SQL".
 * Formula columns resolve through `scope.formulaPlans` (T15) — `gc_<key>` when
 * generated and assumed present, else the inlined plan SQL. Every other column
 * is delegated to `scope.columnExprs` (default `jsonCellsResolver`).
 */
export function resolveColumnExpr(column: ColumnDef, scope: SqlScope): ColumnExpr {
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
  return columnExprResolverOf(scope).resolve(column, scope);
}

/** Predicate TRUE when the column is empty for this row. */
export function isEmptyExpr(column: ColumnDef, scope: SqlScope): SQL {
  return resolveColumnExpr(column, scope).empty;
}
