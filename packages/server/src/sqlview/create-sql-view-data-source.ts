import { type AnyColumn, SQL, type SQLWrapper, and, eq, inArray, is, sql } from "drizzle-orm";
import { projectRow } from "../access/project-row";
import { type AccessMap, isReadable, resolveAccess } from "../access/query-access";
import { MAX_BATCH_ID_LENGTH, cellsUpdateExpr, conflictsFor } from "../changes/apply-changes";
import { type GridDb, affectedRowsOf } from "../changes/db";
import { type CurrentRow, type PlannedSet, planChanges, validateCellValue } from "../changes/plan-changes";
import { type ServerContext, type ServerWarning, createServerContext } from "../context";
import {
  PermissionError,
  RowValidationError,
  SchemaGridServerError,
  SchemaValidationError,
  UnsupportedOperatorError,
} from "../errors";
import { evaluateFormulaCells } from "../formula/evaluate-rows";
import { formulaTranslatability, planFormulaColumns } from "../formula/formula-plan";
import { buildGroupQuery, executeGroupQuery } from "../grouping/translate-grouping";
import {
  type CellChange,
  type ChangeConflict,
  type ChangeError,
  type ChangeFeedEntry,
  type ChangeResult,
  type ColumnDef,
  DEFAULT_CAPABILITIES,
  type DataSource,
  type DataSourceCapabilities,
  type FieldTypeRegistry,
  type GridQuery,
  type GridRow,
  type GridSchema,
  type LinkRef,
  type Option,
  type PermissionResolver,
  type PermissionUser,
  type RowPartial,
  type SortSpec,
  createDefaultRegistry,
  getColumnValueFieldType,
  isEmptyValue,
} from "../internal/core";
import { toDatetimeLiteral } from "../pagination/keyset";
import type { GridSqlScope } from "../query/build-query";
import type { RowSource } from "../query/row-source";
import { runRowQuery } from "../query/run-query";
import { assertValidSchema } from "../schema/validate-schema";
import {
  type ColumnExprResolver,
  type MappedColumn,
  createJsonCellsResolver,
  createMappedColumnResolver,
  ident,
} from "../sql/column-expr";
import { fixedUtcOffset } from "../sql/dates";
import type { SqlScope } from "../sql/scope";
import { type StorageKind, type StorageOverrides, storageKindOf } from "../sql/storage-kind";
import { dateOnlyFromDriver, isoToNaiveDatetime, naiveDatetimeToIso, toIso } from "../storage/hydrate";
import { jsonPath } from "../storage/keys";
import type { ExtensionCellStore } from "./extension-store";
import { rebaseColumns } from "./rebase";

/** Alias of the wrapped base query: `(<baseQuery>) AS sg_base`. */
export const SQL_VIEW_BASE_ALIAS = "sg_base";
/** Alias of the LEFT JOINed extension cells table. */
export const SQL_VIEW_EXTENSION_ALIAS = "sg_ext";

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const DEFAULT_FEED_MAX_ROWS = 1000;
const UTC = "UTC";

/** Context handed to `baseQuery`, `mapRows` and the write hooks: the request's server context plus the db (the transaction during writes). */
export interface SqlViewContext extends ServerContext {
  readonly db: GridDb;
  readonly gridId: string;
}

export interface SqlViewUpdateInput {
  rowId: string;
  /** Validated changes to MAPPED columns only; `next` is the client-shape value (`null` = empty). */
  changes: CellChange[];
  /**
   * The base-table part of the row version the client edited: the `version`
   * expression's value, or the row hash when `version` is omitted. Guard the
   * UPDATE with it (`WHERE id = ? AND version = ?`) and return `{ conflict }` on 0 rows.
   */
  baseVersion: number;
  /**
   * Storage-ready value per changed column KEY (`null` = empty): `datetime` →
   * naive `YYYY-MM-DD HH:MM:SS.fff` wall time in `naiveDatetimeZone`, `date` →
   * `YYYY-MM-DD`, everything else the field type's `serialize(next)`. Bind
   * these in your UPDATE so DATETIME columns keep their zone.
   */
  values: Record<string, unknown>;
}

/** A per-cell failure the write hook reports instead of applying the cell. */
export interface SqlViewCellError {
  rowId: string;
  columnId: string;
  message: string;
}

/**
 * What `write.update` reports for one row — any subset of the fields:
 * - `applied`: cells written (bump the row version once; return the new `version`,
 *   or omit it and the source re-reads the row);
 * - `rejected`: cells NOT written and NOT errors (declined quietly — the client
 *   reverts them silently, `ChangeResult.rejected`);
 * - `errors`: cells refused with a message (`ChangeResult.errors`);
 * - `conflict`: the version guard matched no row — nothing else is read.
 * Changed cells the hook mentions nowhere count as `rejected`.
 * The v0.2 shapes `{ applied, version }` and `{ conflict }` still fit.
 */
export interface SqlViewUpdateOutcome {
  applied?: CellChange[];
  rejected?: CellChange[];
  errors?: SqlViewCellError[];
  conflict?: ChangeConflict;
  version?: number;
}

export type SqlViewUpdateResult = SqlViewUpdateOutcome;

/** A row `write.create` refused; `index` is the position in `partials`. Becomes `RowValidationError` (wire `ROW_INVALID` 400); the transaction rolls back. */
export interface SqlViewCreateError {
  index: number;
  columnId?: string;
  message: string;
}

/** `write.create` answer: the created ids in input order, or `{ rows, errors }` (any `errors` fail the whole call). */
export type SqlViewCreateResult = Pick<GridRow, "id">[] | { rows?: Pick<GridRow, "id">[]; errors?: SqlViewCreateError[] };

export interface SqlViewWriteHooks {
  /** Writes mapped cells of one row. Runs inside the batch transaction (`ctx.db`). */
  update?: (ctx: SqlViewContext, input: SqlViewUpdateInput) => Promise<SqlViewUpdateResult>;
  /**
   * Inserts rows (mapped cells only, validated); returns them (at least `id`), in input order.
   * `storage[i]` holds the storage-ready values of `partials[i]` (see `SqlViewUpdateInput.values`).
   */
  create?: (ctx: SqlViewContext, partials: RowPartial[], storage: Record<string, unknown>[]) => Promise<SqlViewCreateResult>;
  /** Deletes rows (hard or soft — the base query decides what is visible). */
  delete?: (ctx: SqlViewContext, ids: string[]) => Promise<void>;
}

/**
 * A schema column with NO SQL expression: its value is produced in JS after the
 * read (`compute`, then `mapRows`). Never sortable, filterable, searchable or
 * writable; the capabilities and the served schema say so.
 */
export interface ComputedColumn {
  expr?: undefined;
  /** Fills the cell from the hydrated row (hidden cells included). Empty results leave the cell absent. */
  compute?: (row: GridRow) => unknown;
  /** Storage kind hint (unused in SQL). */
  kind?: StorageKind;
}

/** A mapped column (an SQL expression) or a computed one. */
export type SqlViewColumn = MappedColumn | ComputedColumn;

/** Post-read hook over a page of rows (see `RowSource.mapRows`). */
export type SqlViewRowsMapper = (rows: GridRow[], ctx: SqlViewContext) => Promise<GridRow[]> | GridRow[];
/** Per-row sugar for `mapRows`. */
export type SqlViewRowMapper = (row: GridRow, ctx: SqlViewContext) => Promise<GridRow> | GridRow;

export interface SqlViewDataSourceOptions {
  db: GridDb;
  schema: GridSchema;
  /** Default: `createDefaultRegistry()`. */
  registry?: FieldTypeRegistry;
  resolver: PermissionResolver;
  user: PermissionUser;
  /** Default `Asia/Kolkata`. */
  tz?: string;
  now?: () => Date;
  /** Extension-store key. Default: `schema.id`. */
  gridId?: string;
  /**
   * The rows of the view: any SELECT (raw `sql` or a drizzle select) WITHOUT
   * ORDER BY / LIMIT. It is wrapped as a derived table (`(<base>) AS sg_base`),
   * which MySQL merges into the outer query, so indexes on the base tables apply.
   * Every column referenced by `columns` / `rowId` / `version` / `updatedAt`
   * must be selected under its own name (no duplicate output names).
   */
  baseQuery: (ctx: SqlViewContext) => SQL | SQLWrapper;
  /**
   * Schema column KEY → expression over the base tables (drizzle columns are
   * re-pointed at `sg_base`), or a `ComputedColumn` (`{ compute }`, no `expr`).
   * Stored schema columns without an entry are served from `extension` (required then).
   */
  columns: Readonly<Record<string, SqlViewColumn>>;
  /**
   * Schema column KEYs whose values come ONLY from `mapRows` (no SQL, no
   * `compute`): declared here so the schema validates; they are unsortable,
   * unfilterable and read-only like every computed column.
   */
  computed?: Readonly<Record<string, { kind?: StorageKind }>>;
  rowId: SQL | AnyColumn;
  /**
   * Monotonically increasing row version (e.g. an `INT version` column bumped
   * on every write). Omitted → CRC32 of the settable mapped cells: conflicts are
   * detected before writing, but only a `version` guard in `write.update` closes the race.
   */
  version?: SQL | AnyColumn;
  /** Last-modified timestamp (UTC); enables the `updated_at` change feed (`changeFeed: "updates-only"`). */
  updatedAt?: SQL | AnyColumn;
  /** Absent → read-only (`capabilities.write` all false). */
  write?: SqlViewWriteHooks;
  /** Stores cells of schema columns that are not in `columns` (spec §C7). */
  extension?: ExtensionCellStore;
  /**
   * Post-read hook, batched: runs after hydration, `compute` and formula
   * evaluation and BEFORE projection (hidden cells are still there) on every
   * row-returning path — fetch, the change feed, `createRows`. Typical use:
   * signing file URLs. Must return one row per input row, in order.
   */
  mapRows?: SqlViewRowsMapper;
  /** Per-row form of `mapRows` (applied after it when both are given). */
  mapRow?: SqlViewRowMapper;
  /**
   * Order applied when a query has no `sort` (also the keyset paging
   * tie-break order), reported as `capabilities.defaultSort`. Columns the user
   * cannot read are dropped; `sortable: false` columns are rejected at construction.
   */
  defaultSort?: SortSpec[];
  /**
   * IANA zone the wall times of mapped `datetime` columns (MySQL `DATETIME`, no
   * zone) are in. Reads convert them to UTC ISO; `values` for the write hooks go
   * back to wall time; filter/sort compare in UTC via `CONVERT_TZ`. Default: `tz`.
   * Set `"UTC"` for columns that store UTC. Zones with DST need MySQL's time
   * zone tables (`mysql_tzinfo_to_sql`) for `CONVERT_TZ(col, 'Zone', 'UTC')`;
   * fixed-offset zones (Asia/Kolkata, UTC, …) use numeric offsets and need nothing.
   */
  naiveDatetimeZone?: string;
  defaultCapabilities?: Partial<DataSourceCapabilities>;
  storageOverrides?: StorageOverrides;
  onWarning?: (w: ServerWarning) => void;
  formulaFallbackRowCap?: number;
  canDeleteRows?: (user: PermissionUser) => boolean;
  /** Max rows per `getChanges` call. Default 1000. */
  feedMaxRows?: number;
  linkLookup?: (columnId: string, search: string) => Promise<LinkRef[]>;
  userDirectory?: (search: string | undefined) => Promise<Option[]>;
}

export interface SqlViewDataSource extends DataSource<GridRow> {
  capabilities(): DataSourceCapabilities;
}

interface LoadedRow {
  row: CurrentRow;
  baseVersion: number;
  ext: { exists: boolean; version: number };
}

const settable = (c: ColumnDef) => c.settable !== false;

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** Driver value of a mapped column → the stored form the field type deserializes. */
function normalizeMapped(v: unknown, column: ColumnDef, kind: StorageKind, naiveZone: string): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case "boolean":
      if (typeof v === "boolean") return v;
      if (typeof v === "number" || typeof v === "bigint") return Number(v) !== 0;
      if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
      if (v instanceof Uint8Array) return v.some((b) => b !== 0);
      return Boolean(v);
    case "number":
      return typeof v === "number" ? v : Number(v);
    case "date":
      // Selected as DATE_FORMAT(…, '%Y-%m-%d'): the column's own day, never a zone-shifted Date.
      return dateOnlyFromDriver(v);
    case "datetime":
      // Selected as DATE_FORMAT(…, '%Y-%m-%d %H:%i:%s.%f'): a naive wall time in `naiveZone`.
      return naiveDatetimeToIso(v, naiveZone);
    case "multi":
    case "json":
      if (typeof v === "string") {
        try {
          return JSON.parse(v) as unknown;
        } catch {
          return v;
        }
      }
      return v;
    case "ref":
      return typeof v === "object" ? v : column.type === "user" ? { id: String(v) } : String(v);
    default:
      return typeof v === "string" ? v : String(v);
  }
}

/** Storage-ready value of a planned cell for the write hooks (see `SqlViewUpdateInput.values`). */
function storageValue(s: Pick<PlannedSet, "next" | "serialized" | "remove">, kind: StorageKind, naiveZone: string): unknown {
  if (s.remove || s.next === null || s.next === undefined) return null;
  if (kind === "datetime" && typeof s.next === "string") return isoToNaiveDatetime(s.next, naiveZone);
  if (kind === "date" && typeof s.next === "string") return s.next.slice(0, 10);
  return s.serialized;
}

/** `expr` compared in UTC: `CONVERT_TZ` from the naive zone (numeric offset when the zone has no DST). */
function toUtcExpr(expr: SQL, naiveZone: string): SQL {
  if (naiveZone === UTC) return expr;
  const offset = fixedUtcOffset(naiveZone);
  return offset ? sql`CONVERT_TZ(${expr}, ${offset}, '+00:00')` : sql`CONVERT_TZ(${expr}, ${naiveZone}, 'UTC')`;
}

function isComputed(c: SqlViewColumn): c is ComputedColumn {
  return c.expr === undefined;
}

function unsupported(op: string): SchemaGridServerError {
  return new SchemaGridServerError("UNSUPPORTED_OPERATION", `This SQL view does not support "${op}"`);
}

/**
 * A core `DataSource<GridRow>` over an EXISTING table / query (spec §C4): the
 * same permission-checked filter / search / sort / keyset / grouping SQL as
 * `createDrizzleDataSource`, resolved through `createMappedColumnResolver`
 * over `(<baseQuery>) AS sg_base` — plus optional extension columns (§C7,
 * LEFT JOIN on the row id, JSON resolver over the joined `cells`), write
 * hooks with optimistic versions and per-cell outcomes, computed columns and a
 * post-read `mapRows` hook, a default sort, zone-aware DATE / DATETIME
 * handling, and an `updated_at` change feed (§C8).
 */
export function createSqlViewDataSource(options: SqlViewDataSourceOptions): SqlViewDataSource {
  const registry = options.registry ?? createDefaultRegistry();
  const gridId = options.gridId ?? options.schema.id;
  const extension = options.extension;
  const write = options.write;
  const mappedEntries = Object.entries(options.columns).filter((e): e is [string, MappedColumn] => !isComputed(e[1]));
  const mappedKeys = new Set(mappedEntries.map(([k]) => k));
  const computeFns = new Map<string, (row: GridRow) => unknown>();
  const computedKeys = new Set<string>(Object.keys(options.computed ?? {}));
  for (const [key, c] of Object.entries(options.columns)) {
    if (!isComputed(c)) continue;
    computedKeys.add(key);
    if (c.compute) computeFns.set(key, c.compute);
  }

  // Computed columns are unsortable / unfilterable / read-only whatever the stored schema says.
  const schema: GridSchema = computedKeys.size
    ? {
        ...options.schema,
        columns: options.schema.columns.map((c) =>
          computedKeys.has(c.key) && c.type !== "formula" ? { ...c, sortable: false, filterable: false, settable: false } : c,
        ),
      }
    : options.schema;

  assertValidSchema(schema, registry, { physicalColumns: [], isFormulaTranslatable: formulaTranslatability() });
  const unmapped = schema.columns.filter((c) => c.type !== "formula" && !mappedKeys.has(c.key) && !computedKeys.has(c.key));
  if (unmapped.length > 0 && !extension) {
    throw new SchemaValidationError(
      unmapped.map((c) => ({
        code: "unmappedColumn",
        columnId: c.id,
        path: ["columns", c.key],
        message: `Column "${c.id}" has no mapped expression and no extension store is configured`,
      })),
    );
  }

  const ctx = createServerContext({
    schema,
    registry,
    resolver: options.resolver,
    user: options.user,
    ...(options.tz ? { tz: options.tz } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    ...(options.formulaFallbackRowCap ? { formulaFallbackRowCap: options.formulaFallbackRowCap } : {}),
  });
  const naiveZone = options.naiveDatetimeZone ?? ctx.tz;
  const viewCtx = (db: GridDb): SqlViewContext => Object.freeze({ ...ctx, db, gridId });
  const access = resolveAccess(ctx);
  const byId = new Map(ctx.schema.columns.map((c) => [c.id, c]));
  const kindOf = (c: ColumnDef): StorageKind =>
    options.columns[c.key]?.kind ?? options.computed?.[c.key]?.kind ?? storageKindOf(c, registry, options.storageOverrides).kind;
  const computedIds = ctx.schema.columns.filter((c) => c.type !== "formula" && computedKeys.has(c.key)).map((c) => c.id);
  const computedIdSet = new Set(computedIds);

  // ---- default sort --------------------------------------------------------------
  const defaultSort: SortSpec[] = [];
  for (const s of options.defaultSort ?? []) {
    const column = byId.get(s.columnId);
    if (!column) throw new SchemaGridServerError("INVALID_DEFAULT_SORT", `defaultSort names an unknown column "${s.columnId}"`);
    if (column.sortable === false) {
      throw new SchemaGridServerError("INVALID_DEFAULT_SORT", `defaultSort column "${s.columnId}" is not sortable`);
    }
    if (!isReadable(access, column.id)) continue; // hidden for this user: the tie-break falls back to the row id
    defaultSort.push({ columnId: s.columnId, dir: s.dir });
  }
  const withDefaultSort = (query: GridQuery): GridQuery =>
    defaultSort.length > 0 && (query.sort ?? []).length === 0 ? { ...query, sort: defaultSort.map((s) => ({ ...s })) } : query;

  // ---- SQL building blocks (all over sg_base / sg_ext) ------------------------
  const B = SQL_VIEW_BASE_ALIAS;
  const E = SQL_VIEW_EXTENSION_ALIAS;
  const rebase = (e: SQL | AnyColumn) => rebaseColumns(e, B);
  const rowIdSql = rebase(options.rowId);
  const mappedSql = new Map<string, SQL>(mappedEntries.map(([k, m]) => [k, rebase(m.expr)]));
  const extCells = sql`${ident(E)}.${ident("cells")}`;
  const extVersion = sql`COALESCE(${ident(E)}.${ident("version")}, 0)`;
  const extUpdatedAt = sql`${ident(E)}.${ident("updated_at")}`;
  const userUpdatedAt = options.updatedAt ? rebase(options.updatedAt) : undefined;
  const columnByKey = new Map(ctx.schema.columns.map((c) => [c.key, c]));
  const mappedKind = (key: string): StorageKind => {
    const column = columnByKey.get(key);
    return column ? kindOf(column) : (options.columns[key]?.kind ?? "text");
  };

  const hashed = ctx.schema.columns.filter((c) => c.type !== "formula" && mappedKeys.has(c.key) && settable(c));
  const baseVersionSql = options.version
    ? rebase(options.version)
    : hashed.length > 0
      ? sql`CRC32(JSON_ARRAY(${sql.join(
          hashed.map((c) => mappedSql.get(c.key) as SQL),
          sql`, `,
        )}))`
      : sql`0`;
  const effectiveUpdatedAt: SQL | undefined =
    userUpdatedAt && extension
      ? sql`GREATEST(${userUpdatedAt}, COALESCE(${extUpdatedAt}, ${userUpdatedAt}))`
      : (userUpdatedAt ?? (extension ? extUpdatedAt : undefined));

  // Filter / sort / keyset compare datetimes in UTC; the projection reads the raw wall time.
  const comparable = (key: string, expr: SQL): SQL => (mappedKind(key) === "datetime" ? toUtcExpr(expr, naiveZone) : expr);
  const extensionResolver = extension
    ? createJsonCellsResolver({ cells: extCells, rowId: rowIdSql, physical: {}, generatedColumns: "ignore" })
    : undefined;
  const restResolver: ColumnExprResolver = {
    rowId: rowIdSql,
    resolve(column, scope) {
      if (computedIdSet.has(column.id)) {
        throw new UnsupportedOperatorError("source", { columnId: column.id, kind: "computed column" });
      }
      if (extensionResolver) return extensionResolver.resolve(column, scope);
      throw new UnsupportedOperatorError("source", { columnId: column.id, kind: "unmapped column" });
    },
    searchable: (column) => (computedIdSet.has(column.id) ? false : extensionResolver?.searchable?.(column)),
  };
  const columnExprs = createMappedColumnResolver({
    columns: Object.fromEntries(mappedEntries.map(([k, m]) => [k, { ...m, expr: comparable(k, mappedSql.get(k) as SQL) }])),
    rowId: rowIdSql,
    fallback: restResolver,
  });

  const base = options.baseQuery(viewCtx(options.db));
  const baseSql = is(base, SQL) ? sql`(${base})` : sql`${base}`;
  const from = extension
    ? sql`${baseSql} AS ${ident(B)} LEFT JOIN ${ident(extension.tableName)} AS ${ident(E)} ON ${ident(E)}.${ident("grid_id")} = ${gridId} AND ${ident(E)}.${ident("row_id")} = CONVERT(${rowIdSql} USING utf8mb4) COLLATE utf8mb4_bin`
    : sql`${baseSql} AS ${ident(B)}`;

  const mappedField = (key: string) => `m_${key}`;
  const projection = (acc: AccessMap): Record<string, SQL> => {
    const fields: Record<string, SQL> = { id: rowIdSql, sg_bv: baseVersionSql };
    if (extension) fields.sg_ev = extVersion;
    if (effectiveUpdatedAt) fields.sg_ua = effectiveUpdatedAt;
    const extPairs: SQL[] = [];
    for (const column of ctx.schema.columns) {
      if (column.type === "formula" || computedKeys.has(column.key) || !isReadable(acc, column.id)) continue;
      const expr = mappedSql.get(column.key);
      if (expr) {
        // The driver never converts: DATE / DATETIME come back as their own text.
        const kind = kindOf(column);
        fields[mappedField(column.key)] =
          kind === "date"
            ? sql`DATE_FORMAT(${expr}, '%Y-%m-%d')`
            : kind === "datetime"
              ? sql`DATE_FORMAT(${expr}, '%Y-%m-%d %H:%i:%s.%f')`
              : expr;
      } else {
        extPairs.push(sql`${sql.raw(`'${column.key}'`)}, JSON_EXTRACT(${extCells}, ${sql.raw(`'${jsonPath(column.key)}'`)})`);
      }
    }
    if (extPairs.length > 0) fields.sg_cells = sql`JSON_OBJECT(${sql.join(extPairs, sql`, `)})`;
    return fields;
  };

  const hydrate = (dbRow: Record<string, unknown>): GridRow => {
    const stored = parseJsonObject(dbRow.sg_cells);
    const cells: Record<string, unknown> = {};
    for (const column of ctx.schema.columns) {
      if (column.type === "formula" || computedKeys.has(column.key)) continue;
      let raw: unknown;
      if (mappedSql.has(column.key)) {
        const field = mappedField(column.key);
        if (!(field in dbRow)) continue;
        raw = normalizeMapped(dbRow[field], column, kindOf(column), naiveZone);
      } else {
        if (!(column.key in stored)) continue;
        raw = stored[column.key];
      }
      if (raw === null || raw === undefined) continue;
      const ft = getColumnValueFieldType(column, registry);
      cells[column.key] = ft ? ft.deserialize(raw) : raw;
    }
    const updatedAt = dbRow.sg_ua;
    return {
      id: String(dbRow.id),
      version: toNumber(dbRow.sg_bv) + toNumber(dbRow.sg_ev),
      updatedAt: updatedAt === null || updatedAt === undefined ? EPOCH_ISO : toIso(updatedAt as Date | string),
      cells,
    };
  };

  // ---- post-read: compute → mapRows → mapRow ---------------------------------------
  const applyComputed = (row: GridRow): GridRow => {
    if (computeFns.size === 0) return row;
    const cells = { ...row.cells };
    for (const [key, fn] of computeFns) {
      const column = columnByKey.get(key);
      if (column && !isReadable(access, column.id)) continue;
      const value = fn(row);
      if (isEmptyValue(value)) delete cells[key];
      else cells[key] = value;
    }
    return { ...row, cells };
  };
  const postRead = async (rows: GridRow[], db: GridDb = options.db): Promise<GridRow[]> => {
    let out = rows.map(applyComputed);
    if (options.mapRows || options.mapRow) {
      const vctx = viewCtx(db);
      if (options.mapRows) {
        out = await options.mapRows(out, vctx);
        if (out.length !== rows.length) {
          throw new SchemaGridServerError("INTERNAL", `mapRows returned ${out.length} rows for ${rows.length} input rows`);
        }
      }
      if (options.mapRow) {
        const mapRow = options.mapRow;
        out = await Promise.all(out.map((r) => mapRow(r, vctx)));
      }
    }
    return out;
  };

  // Hooks see the WHOLE row (hidden cells included) — projectRow strips them afterwards — so
  // with compute / mapRows every mapped and extension column is selected regardless of access.
  const hooksNeedAllColumns = computeFns.size > 0 || Boolean(options.mapRows || options.mapRow);
  const allReadable: AccessMap = new Map(ctx.schema.columns.map((c) => [c.id, "read" as const]));
  const rowSource: RowSource = {
    from,
    where: [],
    projection: (acc) => projection(hooksNeedAllColumns ? allReadable : acc),
    hydrate,
    mapRows: (rows) => postRead(rows),
  };
  const baseScope: SqlScope = {
    ctx,
    generatedColumns: "ignore",
    columnExprs,
    rowSource,
    ...(options.storageOverrides ? { storageOverrides: options.storageOverrides } : {}),
  };
  const scope: GridSqlScope = { ...baseScope, formulaPlans: planFormulaColumns(baseScope), gridId };

  const sqlColumnIds = ctx.schema.columns.filter((c) => !computedIdSet.has(c.id)).map((c) => c.id);
  const caps: DataSourceCapabilities = {
    ...DEFAULT_CAPABILITIES,
    ...(computedIds.length > 0 ? { sort: { columnIds: sqlColumnIds }, filter: { columnIds: sqlColumnIds } } : {}),
    changeFeed: effectiveUpdatedAt && userUpdatedAt ? "updates-only" : false,
    write: { cells: Boolean(write?.update), createRows: Boolean(write?.create), deleteRows: Boolean(write?.delete) },
    lookup: Boolean(options.linkLookup),
    ...(defaultSort.length > 0 ? { defaultSort: defaultSort.map((s) => ({ ...s })) } : {}),
    ...options.defaultCapabilities,
  };

  // ---- reads -------------------------------------------------------------------
  const idsIn = (ids: string[]) => sql`${rowIdSql} IN (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;

  /** Loads rows by id with EVERY column (write path: planning needs prev values + row-aware permissions). */
  async function loadRows(db: GridDb, ids: string[]): Promise<Map<string, LoadedRow>> {
    const out = new Map<string, LoadedRow>();
    if (ids.length === 0) return out;
    const fields = { ...projection(allReadable), sg_ex: extension ? sql`${ident(E)}.${ident("row_id")}` : sql`NULL` };
    const found = (await db.select(fields).from(from).where(idsIn(ids))) as Record<string, unknown>[];
    for (const r of found) {
      const row = hydrate(r);
      out.set(row.id, {
        row,
        baseVersion: toNumber(r.sg_bv),
        ext: { exists: r.sg_ex !== null && r.sg_ex !== undefined, version: toNumber(r.sg_ev) },
      });
    }
    return out;
  }

  const finish = async (rows: GridRow[], db: GridDb = options.db) =>
    (await postRead(evaluateFormulaCells(rows, access, ctx), db)).map((r) => projectRow(r, ctx.schema, access));

  // ---- writes ------------------------------------------------------------------
  const changeOf = (rowId: string, s: PlannedSet): CellChange => ({ rowId, columnId: s.column.id, prev: s.prev, next: s.next });

  async function writeExtension(db: GridDb, rowId: string, sets: PlannedSet[], ext: LoadedRow["ext"], now: Date): Promise<boolean> {
    if (!extension) return false;
    const t = extension.table;
    if (ext.exists) {
      const cells = cellsUpdateExpr(sets);
      const result = await db
        .update(t)
        .set({ ...(cells ? { cells } : {}), version: sql`${ident("version")} + 1`, updatedAt: now, updatedBy: ctx.user.id } as never)
        .where(and(eq(t.gridId, gridId), eq(t.rowId, rowId), eq(t.version, ext.version)));
      return affectedRowsOf(result) === 1;
    }
    const cells = Object.fromEntries(sets.filter((s) => !s.remove).map((s) => [s.column.key, s.serialized]));
    const result = await db
      .insert(t)
      .ignore()
      .values({ gridId, rowId, cells, version: 1, updatedAt: now, updatedBy: ctx.user.id });
    return affectedRowsOf(result) === 1;
  }

  async function applyChanges(batch: Parameters<DataSource<GridRow>["applyChanges"]>[0]): Promise<ChangeResult> {
    if (typeof batch.id !== "string" || batch.id.length === 0 || batch.id.length > MAX_BATCH_ID_LENGTH) {
      throw new SchemaGridServerError("INVALID_BATCH", `ChangeBatch.id must be 1..${MAX_BATCH_ID_LENGTH} characters`);
    }
    const rowIds = [...new Set(batch.changes.map((c) => c.rowId))].sort();
    return options.db.transaction(async (tx) => {
      const db = tx as unknown as GridDb;
      const vctx = viewCtx(db);
      const now = ctx.now();
      const loaded = await loadRows(db, rowIds);
      const current = new Map<string, CurrentRow>([...loaded].map(([id, l]) => [id, l.row]));
      const plan = planChanges(batch, current, ctx);
      const applied: CellChange[] = [];
      const rejected: CellChange[] = [];
      const conflicts: ChangeConflict[] = [];
      const errors: ChangeError[] = [...plan.errors];
      const versions: Record<string, number> = {};
      const reload: string[] = [];

      const reportConflicts = async (rowId: string, baseVersion: number, sets: PlannedSet[], fallback?: ChangeConflict) => {
        const fresh = (await loadRows(db, [rowId])).get(rowId);
        const c = conflictsFor({ rowId, baseVersion, sets }, fresh?.row, ctx, access);
        conflicts.push(...(c.conflicts.length > 0 || c.errors.length > 0 ? c.conflicts : fallback ? [fallback] : []));
        errors.push(...c.errors);
      };

      const rowPlans = [...plan.rowPlans].sort((a, b) => (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0));
      for (const rowPlan of rowPlans) {
        const l = loaded.get(rowPlan.rowId);
        const sets: PlannedSet[] = [];
        for (const s of rowPlan.sets) {
          if (!write?.update || !settable(s.column)) errors.push({ rowId: rowPlan.rowId, columnId: s.column.id, message: "Read-only" });
          else sets.push(s);
        }
        if (sets.length === 0 || !l) continue;
        if (l.row.version !== rowPlan.baseVersion) {
          const c = conflictsFor({ ...rowPlan, sets }, l.row, ctx, access);
          conflicts.push(...c.conflicts);
          errors.push(...c.errors);
          continue;
        }
        const baseSets = sets.filter((s) => mappedKeys.has(s.column.key));
        const extSets = sets.filter((s) => !mappedKeys.has(s.column.key));
        let baseVersion = l.baseVersion;
        let wrote = false;
        let versionKnown = true;
        if (baseSets.length > 0 && write?.update) {
          const res = await write.update(vctx, {
            rowId: rowPlan.rowId,
            changes: baseSets.map((s) => changeOf(rowPlan.rowId, s)),
            baseVersion: l.baseVersion,
            values: Object.fromEntries(baseSets.map((s) => [s.column.key, storageValue(s, kindOf(s.column), naiveZone)])),
          });
          if (res.conflict) {
            await reportConflicts(rowPlan.rowId, rowPlan.baseVersion, sets, res.conflict);
            continue;
          }
          const mentioned = new Set<string>();
          for (const c of res.applied ?? []) {
            applied.push(c);
            mentioned.add(c.columnId);
          }
          for (const c of res.rejected ?? []) {
            rejected.push(c);
            mentioned.add(c.columnId);
          }
          for (const e of res.errors ?? []) {
            errors.push({ rowId: e.rowId, columnId: e.columnId, message: e.message });
            mentioned.add(e.columnId);
          }
          // Cells the hook said nothing about were not written: report them as quietly rejected.
          for (const s of baseSets) if (!mentioned.has(s.column.id)) rejected.push(changeOf(rowPlan.rowId, s));
          if ((res.applied ?? []).length > 0) {
            wrote = true;
            if (typeof res.version === "number") baseVersion = res.version;
            else versionKnown = false;
          }
        }
        let extVersion = l.ext.version;
        if (extSets.length > 0) {
          const skip = !l.ext.exists && extSets.every((s) => s.remove);
          if (!skip) {
            if (!(await writeExtension(db, rowPlan.rowId, extSets, l.ext, now))) {
              await reportConflicts(rowPlan.rowId, rowPlan.baseVersion, extSets);
              continue;
            }
            extVersion = l.ext.exists ? l.ext.version + 1 : 1;
          }
          wrote = true;
          for (const s of extSets) applied.push(changeOf(rowPlan.rowId, s));
        }
        if (!wrote) continue;
        if (options.version && versionKnown) versions[rowPlan.rowId] = toNumber(baseVersion) + extVersion;
        else reload.push(rowPlan.rowId);
      }
      if (reload.length > 0) {
        const fresh = await loadRows(db, reload);
        for (const id of reload) {
          const f = fresh.get(id);
          if (f) versions[id] = f.row.version;
        }
      }
      const result: ChangeResult = { applied, conflicts, errors, versions };
      if (rejected.length > 0) result.rejected = rejected;
      return result;
    });
  }

  async function createRows(partials: RowPartial[]): Promise<GridRow[]> {
    const create = write?.create;
    if (!create) throw unsupported("createRows");
    if (partials.length === 0) return [];
    const byKey = new Map(ctx.schema.columns.map((c) => [c.key, c]));
    const mappedPartials: RowPartial[] = [];
    const storageRows: Record<string, unknown>[] = [];
    const extCellsByRow: Record<string, unknown>[] = [];
    partials.forEach((partial, rowIndex) => {
      const given = (partial.cells ?? {}) as Record<string, unknown>;
      const mapped: Record<string, unknown> = {};
      const storage: Record<string, unknown> = {};
      const ext: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(given)) {
        const column = byKey.get(key);
        if (!column) throw new RowValidationError(rowIndex, key, "Unknown column");
        if (column.type === "formula") throw new RowValidationError(rowIndex, column.id, "Column is read-only (formula)");
        if (ctx.resolver({ user: ctx.user, column }) !== "edit" || !settable(column)) {
          throw new RowValidationError(rowIndex, column.id, "Column is read-only");
        }
        const v = validateCellValue(column, value, ctx);
        if (!v.ok) throw new RowValidationError(rowIndex, column.id, v.message);
        if (mappedKeys.has(key)) {
          mapped[key] = v.next;
          storage[key] = storageValue(v, kindOf(column), naiveZone);
        } else if (!v.remove) ext[key] = v.serialized;
      }
      mappedPartials.push({ ...(partial.id !== undefined ? { id: partial.id } : {}), cells: mapped });
      storageRows.push(storage);
      extCellsByRow.push(ext);
    });
    return options.db.transaction(async (tx) => {
      const db = tx as unknown as GridDb;
      const answer = await create(viewCtx(db), mappedPartials, storageRows);
      const outcome = Array.isArray(answer) ? { rows: answer } : answer;
      const failure = outcome.errors?.[0];
      // Throwing inside the transaction rolls every insert back (wire: ROW_INVALID 400 with the row index).
      if (failure) throw new RowValidationError(failure.index, failure.columnId ?? "", failure.message);
      const ids = (outcome.rows ?? []).map((r) => String(r.id));
      const now = ctx.now();
      if (extension) {
        const inserts = ids
          .map((rowId, i) => ({ rowId, cells: extCellsByRow[i] ?? {} }))
          .filter((x) => Object.keys(x.cells).length > 0)
          .map((x) => ({ gridId, rowId: x.rowId, cells: x.cells, version: 1, updatedAt: now, updatedBy: ctx.user.id }));
        if (inserts.length > 0) await db.insert(extension.table).values(inserts);
      }
      const loaded = await loadRows(db, ids);
      return finish(
        ids.map((id) => loaded.get(id)?.row).filter((r): r is CurrentRow => r !== undefined),
        db,
      );
    });
  }

  async function deleteRows(ids: string[]): Promise<void> {
    const del = write?.delete;
    if (!del) throw unsupported("deleteRows");
    if (options.canDeleteRows && !options.canDeleteRows(ctx.user)) throw new PermissionError([], "edit", "Row deletion denied");
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    await options.db.transaction(async (tx) => {
      const db = tx as unknown as GridDb;
      await del(viewCtx(db), unique);
      if (extension) {
        const t = extension.table;
        await db.delete(t).where(and(eq(t.gridId, gridId), inArray(t.rowId, unique)));
      }
    });
  }

  // ---- updated_at change feed (§C8) -------------------------------------------
  const feedCursor = {
    encode: (t: string, id: string) => Buffer.from(JSON.stringify({ v: 1, t, id }), "utf8").toString("base64url"),
    decode(since: string): { t: string; id: string } {
      try {
        const p = JSON.parse(Buffer.from(since, "base64url").toString("utf8")) as { v?: unknown; t?: unknown; id?: unknown };
        if (p.v === 1 && typeof p.t === "string" && typeof p.id === "string") return { t: p.t, id: p.id };
      } catch {
        // fall through
      }
      throw new SchemaGridServerError("INVALID_CURSOR", `Invalid change feed cursor "${since}"`, { since });
    },
  };

  async function getChanges(since: string): Promise<ChangeFeedEntry<GridRow>> {
    const eff = effectiveUpdatedAt as SQL;
    const tSql = sql`DATE_FORMAT(${eff}, '%Y-%m-%d %H:%i:%s.%f')`;
    const schemaVersion = ctx.schema.schemaVersion;
    if (!since) {
      const top = (await options.db
        .select({ t: tSql, id: rowIdSql })
        .from(from)
        .where(sql`${eff} IS NOT NULL`)
        .orderBy(sql`${eff} DESC`, sql`${rowIdSql} DESC`)
        .limit(1)) as { t: string | null; id: unknown }[];
      const first = top[0];
      const cursor = first?.t ? feedCursor.encode(first.t, String(first.id)) : feedCursor.encode("0000-00-00 00:00:00.000000", "");
      return { cursor, rows: [], deletedRowIds: [], schemaVersion };
    }
    const c = feedCursor.decode(since);
    const t = toDatetimeLiteral(c.t);
    const after = sql`(${eff} > ${t} OR (${eff} = ${t} AND ${rowIdSql} > ${c.id}))`;
    const limit = Math.min(10_000, Math.max(1, Math.trunc(options.feedMaxRows ?? DEFAULT_FEED_MAX_ROWS)));
    const found = (await options.db
      .select({ ...projection(hooksNeedAllColumns ? allReadable : access), sg_ft: tSql })
      .from(from)
      .where(after)
      .orderBy(sql`${eff} ASC`, sql`${rowIdSql} ASC`)
      .limit(limit)) as Record<string, unknown>[];
    const last = found.at(-1);
    const cursor = last ? feedCursor.encode(String(last.sg_ft), String(last.id)) : since;
    return { cursor, rows: await finish(found.map(hydrate)), deletedRowIds: [], schemaVersion };
  }

  const readableColumn = (columnId: string) => {
    const column = byId.get(columnId);
    if (!column || !isReadable(access, column.id)) throw new PermissionError([columnId], "filter", "Unknown column");
    return column;
  };

  const clampPage = (query: GridQuery): GridQuery =>
    query.page.limit > caps.maxPageSize ? { ...query, page: { ...query.page, limit: caps.maxPageSize } } : query;

  const ds: SqlViewDataSource = {
    capabilities: () => caps,
    async fetch(input) {
      const query = withDefaultSort(clampPage(input));
      if (query.groupBy && query.groupBy.length > 0) {
        return executeGroupQuery(buildGroupQuery(query, scope, options.db, access), scope);
      }
      return runRowQuery(query, scope, options.db, access);
    },
    applyChanges,
    createRows,
    deleteRows,
    async getOptions(columnId, search) {
      const column = readableColumn(columnId);
      if (column.type === "user") return options.userDirectory ? options.userDirectory(search) : [];
      const all = (column.config as { options?: Option[] } | null)?.options ?? [];
      const term = search?.trim().toLowerCase();
      return term ? all.filter((o) => o.label.toLowerCase().includes(term)) : [...all];
    },
  };
  if (caps.changeFeed !== false && effectiveUpdatedAt) ds.getChanges = getChanges;
  if (options.linkLookup) {
    const lookup = options.linkLookup;
    ds.lookup = async (columnId, search) => {
      readableColumn(columnId);
      return lookup(columnId, search);
    };
  }
  return ds;
}
