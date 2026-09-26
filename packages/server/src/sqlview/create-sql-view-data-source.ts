import { type AnyColumn, SQL, type SQLWrapper, and, eq, inArray, is, sql } from "drizzle-orm";
import { projectRow } from "../access/project-row";
import { type AccessMap, isReadable, resolveAccess } from "../access/query-access";
import { MAX_BATCH_ID_LENGTH, appliedChange, cellsUpdateExpr, conflictsFor } from "../changes/apply-changes";
import { type GridDb, affectedRowsOf } from "../changes/db";
import { type CurrentRow, type PlannedSet, planChanges, validateCellValue } from "../changes/plan-changes";
import { type ServerContext, type ServerWarning, createServerContext } from "../context";
import {
  PermissionError,
  RowValidationError,
  SchemaGridServerError,
  SchemaValidationError,
  type TableDdlHelper,
  UnsupportedOperatorError,
  guardMissingTable,
} from "../errors";
import { evaluateFormulaCells } from "../formula/evaluate-rows";
import { formulaTranslatability, planFormulaColumns } from "../formula/formula-plan";
import { buildGroupQuery, executeGroupQuery } from "../grouping/translate-grouping";
import {
  type CellChange,
  type ChangeConflict,
  type ChangeError,
  type ChangeFeedEntry,
  type ChangeMeta,
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
  createDefaultRegistry,
  getColumnValueFieldType,
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
import type { SqlScope } from "../sql/scope";
import { type StorageKind, type StorageOverrides, storageKindOf } from "../sql/storage-kind";
import { toIso } from "../storage/hydrate";
import { jsonPath } from "../storage/keys";
import type { ExtensionCellStore } from "./extension-store";
import { rebaseColumns } from "./rebase";

/** Alias of the wrapped base query: `(<baseQuery>) AS sg_base`. */
export const SQL_VIEW_BASE_ALIAS = "sg_base";
/** Alias of the LEFT JOINed extension cells table. */
export const SQL_VIEW_EXTENSION_ALIAS = "sg_ext";

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const DEFAULT_FEED_MAX_ROWS = 1000;

/** Context handed to `baseQuery` and the write hooks: the request's server context plus the db (the transaction during writes). */
export interface SqlViewContext extends ServerContext {
  readonly db: GridDb;
  readonly gridId: string;
}

export interface SqlViewUpdateInput {
  rowId: string;
  /** Validated changes to MAPPED columns only; `next` is the client-shape value (`null` = empty). Each keeps its `meta` (v0.3). */
  changes: CellChange[];
  /**
   * The base-table part of the row version the client edited: the `version`
   * expression's value, or the row hash when `version` is omitted. Guard the
   * UPDATE with it (`WHERE id = ? AND version = ?`) and return `{ conflict }` on 0 rows.
   */
  baseVersion: number;
  /** The batch's input-only `meta` (v0.3), when the client sent one. */
  meta?: ChangeMeta;
}

/**
 * What `write.update` answers: the applied changes and the row's new base
 * version — optionally `rejected` changes the hook declined quietly (v0.3: not
 * applied, not an error; the grid reverts them without an error state) — or a
 * conflict.
 */
export type SqlViewUpdateResult =
  | { applied: CellChange[]; version: number; rejected?: CellChange[] }
  | { conflict: ChangeConflict };

export interface SqlViewWriteHooks {
  /** Writes mapped cells of one row. Runs inside the batch transaction (`ctx.db`). */
  update?: (ctx: SqlViewContext, input: SqlViewUpdateInput) => Promise<SqlViewUpdateResult>;
  /** Inserts rows (mapped cells only, validated); returns them (at least `id`), in input order. */
  create?: (ctx: SqlViewContext, partials: RowPartial[]) => Promise<Pick<GridRow, "id">[]>;
  /** Deletes rows (hard or soft — the base query decides what is visible). */
  delete?: (ctx: SqlViewContext, ids: string[]) => Promise<void>;
}

/**
 * A column derived in JavaScript from the fetched row (v0.3): no SQL
 * expression, so it is read-only, excluded from search and reported as
 * neither sortable nor filterable in `capabilities` (the grid turns those
 * affordances off; the server rejects them anyway).
 */
export interface ComputedColumn {
  expr?: never;
  /** Derives the cell from the row's other cells (after hydration, before formulas). Return null/undefined for empty. */
  compute: (row: { id: string; cells: Record<string, unknown> }) => unknown;
}

/** A mapped SQL expression or a JS-computed column (v0.3). */
export type SqlViewColumn = MappedColumn | ComputedColumn;

export function isComputedColumn(column: SqlViewColumn): column is ComputedColumn {
  return typeof (column as ComputedColumn).compute === "function";
}

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
   * re-pointed at `sg_base`), or `{ compute }` for a JS-derived column (v0.3).
   * Stored schema columns without an entry are served from `extension`
   * (required then).
   */
  columns: Readonly<Record<string, SqlViewColumn>>;
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
function normalizeMapped(v: unknown, column: ColumnDef, kind: StorageKind): unknown {
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
      return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    case "datetime":
      return v instanceof Date ? v.toISOString() : toIso(String(v));
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

function unsupported(op: string): SchemaGridServerError {
  return new SchemaGridServerError("UNSUPPORTED_OPERATION", `This SQL view does not support "${op}"`);
}

/**
 * A core `DataSource<GridRow>` over an EXISTING table / query (spec §C4): the
 * same permission-checked filter / search / sort / keyset / grouping SQL as
 * `createDrizzleDataSource`, resolved through `createMappedColumnResolver`
 * over `(<baseQuery>) AS sg_base` — plus optional extension columns (§C7,
 * LEFT JOIN on the row id, JSON resolver over the joined `cells`), write
 * hooks with optimistic versions, and an `updated_at` change feed (§C8).
 * v0.3: `{ compute }` columns derived in JS after fetch, `meta` handed to
 * `write.update`, `rejected` passed through, and a `MISSING_TABLE` error when
 * the extension table was never created.
 */
export function createSqlViewDataSource(options: SqlViewDataSourceOptions): SqlViewDataSource {
  const registry = options.registry ?? createDefaultRegistry();
  const gridId = options.gridId ?? options.schema.id;
  const extension = options.extension;
  const write = options.write;
  const mappedColumns: Record<string, MappedColumn> = {};
  const computed = new Map<string, ComputedColumn["compute"]>();
  for (const [key, column] of Object.entries(options.columns)) {
    if (isComputedColumn(column)) computed.set(key, column.compute);
    else mappedColumns[key] = column;
  }
  const mappedKeys = new Set(Object.keys(mappedColumns));

  assertValidSchema(options.schema, registry, { physicalColumns: [], isFormulaTranslatable: formulaTranslatability() });
  // Computed columns (v0.3) are read-only and can neither be sorted, filtered nor searched: write that onto
  // the schema this source works with, so the shared access / query checks enforce it.
  const schema: GridSchema = computed.size === 0
    ? options.schema
    : {
        ...options.schema,
        columns: options.schema.columns.map((c) =>
          computed.has(c.key) && c.type !== "formula" ? { ...c, sortable: false, filterable: false, settable: false } : c,
        ),
      };
  const unmapped = schema.columns.filter((c) => c.type !== "formula" && !mappedKeys.has(c.key) && !computed.has(c.key));
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
  const viewCtx = (db: GridDb): SqlViewContext => Object.freeze({ ...ctx, db, gridId });
  const access = resolveAccess(ctx);
  const byId = new Map(ctx.schema.columns.map((c) => [c.id, c]));
  const kindOf = (c: ColumnDef) =>
    mappedColumns[c.key]?.kind ?? storageKindOf(c, registry, options.storageOverrides).kind;

  // ---- SQL building blocks (all over sg_base / sg_ext) ------------------------
  const B = SQL_VIEW_BASE_ALIAS;
  const E = SQL_VIEW_EXTENSION_ALIAS;
  const rebase = (e: SQL | AnyColumn) => rebaseColumns(e, B);
  const rowIdSql = rebase(options.rowId);
  const mappedSql = new Map<string, SQL>(Object.entries(mappedColumns).map(([k, m]) => [k, rebase(m.expr)]));
  const extCells = sql`${ident(E)}.${ident("cells")}`;
  const extVersion = sql`COALESCE(${ident(E)}.${ident("version")}, 0)`;
  const extUpdatedAt = sql`${ident(E)}.${ident("updated_at")}`;
  const userUpdatedAt = options.updatedAt ? rebase(options.updatedAt) : undefined;

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

  const mappedResolver = createMappedColumnResolver({
    columns: Object.fromEntries(Object.entries(mappedColumns).map(([k, m]) => [k, { ...m, expr: mappedSql.get(k) as SQL }])),
    rowId: rowIdSql,
    ...(extension
      ? { fallback: createJsonCellsResolver({ cells: extCells, rowId: rowIdSql, physical: {}, generatedColumns: "ignore" }) }
      : {}),
  });
  // Computed columns have no SQL: never searched, and any attempt to resolve one (group by) is a typed 400.
  const columnExprs: ColumnExprResolver =
    computed.size === 0
      ? mappedResolver
      : {
          rowId: mappedResolver.rowId,
          resolve(column, scope) {
            if (computed.has(column.key)) {
              throw new UnsupportedOperatorError("source", { columnId: column.id, kind: "computed column" });
            }
            return mappedResolver.resolve(column, scope);
          },
          searchable: (column) => (computed.has(column.key) ? false : mappedResolver.searchable?.(column)),
        };

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
      if (column.type === "formula" || computed.has(column.key) || !isReadable(acc, column.id)) continue;
      const expr = mappedSql.get(column.key);
      if (expr) {
        fields[mappedField(column.key)] =
          kindOf(column) === "date" ? sql`DATE_FORMAT(${expr}, '%Y-%m-%d')` : expr;
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
      if (column.type === "formula" || computed.has(column.key)) continue;
      let raw: unknown;
      if (mappedSql.has(column.key)) {
        const field = mappedField(column.key);
        if (!(field in dbRow)) continue;
        raw = normalizeMapped(dbRow[field], column, kindOf(column));
      } else {
        if (!(column.key in stored)) continue;
        raw = stored[column.key];
      }
      if (raw === null || raw === undefined) continue;
      const ft = getColumnValueFieldType(column, registry);
      cells[column.key] = ft ? ft.deserialize(raw) : raw;
    }
    const id = String(dbRow.id);
    for (const [key, compute] of computed) {
      const value = compute({ id, cells });
      if (value !== null && value !== undefined) cells[key] = value;
    }
    const updatedAt = dbRow.sg_ua;
    return {
      id,
      version: toNumber(dbRow.sg_bv) + toNumber(dbRow.sg_ev),
      updatedAt: updatedAt === null || updatedAt === undefined ? EPOCH_ISO : toIso(updatedAt as Date | string),
      cells,
    };
  };

  const rowSource: RowSource = { from, where: [], projection, hydrate };
  const baseScope: SqlScope = {
    ctx,
    generatedColumns: "ignore",
    columnExprs,
    rowSource,
    ...(options.storageOverrides ? { storageOverrides: options.storageOverrides } : {}),
  };
  const scope: GridSqlScope = { ...baseScope, formulaPlans: planFormulaColumns(baseScope), gridId };

  const caps: DataSourceCapabilities = {
    ...DEFAULT_CAPABILITIES,
    changeFeed: effectiveUpdatedAt && userUpdatedAt ? "updates-only" : false,
    write: { cells: Boolean(write?.update), createRows: Boolean(write?.create), deleteRows: Boolean(write?.delete) },
    lookup: Boolean(options.linkLookup),
    ...options.defaultCapabilities,
  };
  if (computed.size > 0) {
    // Computed columns drop out of the sort / filter scopes whatever the caller declared.
    const computedIds = new Set(ctx.schema.columns.filter((c) => computed.has(c.key)).map((c) => c.id));
    const without = (scope: DataSourceCapabilities["sort"]): DataSourceCapabilities["sort"] => ({
      columnIds: (scope === "all" ? ctx.schema.columns.map((c) => c.id) : scope.columnIds).filter((id) => !computedIds.has(id)),
    });
    caps.sort = without(caps.sort);
    caps.filter = without(caps.filter);
  }
  /** Tables this source reads that the app must have created (for `MISSING_TABLE` errors). */
  const knownTables: Record<string, TableDdlHelper> = extension ? { [extension.tableName]: "createExtensionCellsTableDDL" } : {};
  const guarded = <T>(fn: () => Promise<T>): Promise<T> => (extension ? guardMissingTable(knownTables, fn) : fn());

  // ---- reads -------------------------------------------------------------------
  const allReadable: AccessMap = new Map(ctx.schema.columns.map((c) => [c.id, "read" as const]));
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

  const finish = (rows: GridRow[]) =>
    evaluateFormulaCells(rows, access, ctx).map((r) => projectRow(r, ctx.schema, access));

  // ---- writes ------------------------------------------------------------------
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
    return guarded(() => options.db.transaction(async (tx) => {
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
        if (baseSets.length > 0 && write?.update) {
          const res = await write.update(vctx, {
            rowId: rowPlan.rowId,
            changes: baseSets.map((s) => appliedChange(rowPlan.rowId, s)),
            baseVersion: l.baseVersion,
            ...(batch.meta ? { meta: batch.meta } : {}),
          });
          if ("conflict" in res) {
            await reportConflicts(rowPlan.rowId, rowPlan.baseVersion, sets, res.conflict);
            continue;
          }
          applied.push(...res.applied);
          if (res.rejected && res.rejected.length > 0) rejected.push(...res.rejected);
          baseVersion = res.version;
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
          for (const s of extSets) applied.push(appliedChange(rowPlan.rowId, s));
        }
        if (options.version) versions[rowPlan.rowId] = toNumber(baseVersion) + extVersion;
        else reload.push(rowPlan.rowId);
      }
      if (reload.length > 0) {
        const fresh = await loadRows(db, reload);
        for (const id of reload) {
          const f = fresh.get(id);
          if (f) versions[id] = f.row.version;
        }
      }
      return { applied, conflicts, errors, versions, ...(rejected.length > 0 ? { rejected } : {}) };
    }));
  }

  async function createRows(partials: RowPartial[]): Promise<GridRow[]> {
    const create = write?.create;
    if (!create) throw unsupported("createRows");
    if (partials.length === 0) return [];
    const byKey = new Map(ctx.schema.columns.map((c) => [c.key, c]));
    const mappedPartials: RowPartial[] = [];
    const extCellsByRow: Record<string, unknown>[] = [];
    partials.forEach((partial, rowIndex) => {
      const given = (partial.cells ?? {}) as Record<string, unknown>;
      const mapped: Record<string, unknown> = {};
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
        if (mappedKeys.has(key)) mapped[key] = v.next;
        else if (!v.remove) ext[key] = v.serialized;
      }
      mappedPartials.push({ ...(partial.id !== undefined ? { id: partial.id } : {}), cells: mapped });
      extCellsByRow.push(ext);
    });
    return guarded(() => options.db.transaction(async (tx) => {
      const db = tx as unknown as GridDb;
      const created = await create(viewCtx(db), mappedPartials);
      const ids = created.map((r) => String(r.id));
      const now = ctx.now();
      if (extension) {
        const inserts = ids
          .map((rowId, i) => ({ rowId, cells: extCellsByRow[i] ?? {} }))
          .filter((x) => Object.keys(x.cells).length > 0)
          .map((x) => ({ gridId, rowId: x.rowId, cells: x.cells, version: 1, updatedAt: now, updatedBy: ctx.user.id }));
        if (inserts.length > 0) await db.insert(extension.table).values(inserts);
      }
      const loaded = await loadRows(db, ids);
      return finish(ids.map((id) => loaded.get(id)?.row).filter((r): r is CurrentRow => r !== undefined));
    }));
  }

  async function deleteRows(ids: string[]): Promise<void> {
    const del = write?.delete;
    if (!del) throw unsupported("deleteRows");
    if (options.canDeleteRows && !options.canDeleteRows(ctx.user)) throw new PermissionError([], "edit", "Row deletion denied");
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    await guarded(() => options.db.transaction(async (tx) => {
      const db = tx as unknown as GridDb;
      await del(viewCtx(db), unique);
      if (extension) {
        const t = extension.table;
        await db.delete(t).where(and(eq(t.gridId, gridId), inArray(t.rowId, unique)));
      }
    }));
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
      .select({ ...projection(access), sg_ft: tSql })
      .from(from)
      .where(after)
      .orderBy(sql`${eff} ASC`, sql`${rowIdSql} ASC`)
      .limit(limit)) as Record<string, unknown>[];
    const last = found.at(-1);
    const cursor = last ? feedCursor.encode(String(last.sg_ft), String(last.id)) : since;
    return { cursor, rows: finish(found.map(hydrate)), deletedRowIds: [], schemaVersion };
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
    fetch: (input) =>
      guarded(async () => {
        const query = clampPage(input);
        if (query.groupBy && query.groupBy.length > 0) {
          return executeGroupQuery(buildGroupQuery(query, scope, options.db, access), scope);
        }
        return runRowQuery(query, scope, options.db, access);
      }),
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
  if (caps.changeFeed !== false && effectiveUpdatedAt) ds.getChanges = (since) => guarded(() => getChanges(since));
  if (options.linkLookup) {
    const lookup = options.linkLookup;
    ds.lookup = async (columnId, search) => {
      readableColumn(columnId);
      return lookup(columnId, search);
    };
  }
  return ds;
}
