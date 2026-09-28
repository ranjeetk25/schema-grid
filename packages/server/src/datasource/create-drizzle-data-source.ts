import { type SQL, sql } from "drizzle-orm";
import { type AccessMap, resolveAccess } from "../access/query-access";
import { type AfterCommitHook, type CommitOutcome, runAfterCommit } from "../changes/after-commit";
import { applyChanges, loadRowsForUpdate } from "../changes/apply-changes";
import { insertChangeLog } from "../changes/change-log";
import type { GridDb, WriteDeps } from "../changes/db";
import type { CellColorStore } from "../colors/color-store";
import { colorQueryScope } from "../colors/query-rules";
import { withCellColors } from "../colors/rows";
import {
  assertCellColorBatch,
  cellColorRowIds,
  deleteCellColors,
  planCellColors,
  writeCellColors,
} from "../colors/set-cell-colors";
import { ident } from "../sql/column-expr";
import { readRowsById } from "../changes/read-rows";
import { createRows, deleteRows } from "../changes/rows-crud";
import { type ServerContext, type ServerWarning, createServerContext } from "../context";
import { PermissionError, SchemaGridServerError, type TableDdlHelper, guardMissingTable } from "../errors";
import { getChanges } from "../feed/get-changes";
import { evaluateFormulaCells } from "../formula/evaluate-rows";
import { formulaTranslatability, planFormulaColumns } from "../formula/formula-plan";
import { buildGroupQuery, executeGroupQuery } from "../grouping/translate-grouping";
import {
  type CellColorBatch,
  type CellColorResult,
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
  type SortSpec,
} from "../internal/core";
import type { GridSqlScope } from "../query/build-query";
import { gridRowsSource } from "../query/row-source";
import { runRowQuery } from "../query/run-query";
import { type DbRow, hydrateRow } from "../storage/hydrate";
import { assertValidSchema } from "../schema/validate-schema";
import type { StorageOverrides } from "../sql/storage-kind";
import { type GridTables, defineGridTables } from "../storage/tables";

export interface DrizzleDataSourceOptions {
  db: GridDb;
  gridId: string;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  resolver: PermissionResolver;
  user: PermissionUser;
  /** Default `Asia/Kolkata`. */
  tz?: string;
  now?: () => Date;
  /** Default: `defineGridTables({ rowsTable: "grid_rows", changeLogTable: "grid_change_log" })`. */
  tables?: GridTables;
  onWarning?: (w: ServerWarning) => void;
  /** Max candidates for in-memory formula filtering/sorting. Default 5000. */
  formulaFallbackRowCap?: number;
  /** Physical column names allowed as `source.valueField`. Default: the physical columns of `tables`. */
  physicalColumns?: string[];
  /** Whether `gc_<key>` generated columns exist (apply `diffIndexedColumns` DDL first). Default "assumePresent". */
  generatedColumns?: "assumePresent" | "ignore";
  storageOverrides?: StorageOverrides;
  canDeleteRows?: (user: PermissionUser) => boolean;
  /** Persists a new option in the consumer's schema store (schema persistence belongs to the consumer). */
  onCreateOption?: (columnId: string, label: string) => Promise<Option>;
  linkLookup?: (columnId: string, search: string) => Promise<LinkRef[]>;
  userDirectory?: (search: string | undefined) => Promise<Option[]>;
  /**
   * Post-read hook, batched: after hydration and formula evaluation, BEFORE
   * projection (hidden cells still present), on fetch, the change feed,
   * `createRows`, `getRows` and the rows `applyChanges` returns (v0.3.1). Must
   * return one row per input row, in order.
   */
  mapRows?: (rows: GridRow[], ctx: ServerContext) => Promise<GridRow[]> | GridRow[];
  /** Per-row form of `mapRows` (applied after it when both are given). */
  mapRow?: (row: GridRow, ctx: ServerContext) => Promise<GridRow> | GridRow;
  /** Order applied when a query has no `sort` (also the keyset tie-break); reported as `capabilities.defaultSort`. */
  defaultSort?: SortSpec[];
  /**
   * Zone of the naive wall times in physical `datetime` columns. Default `"UTC"`
   * (what the server writes); reads only — physical writes stay UTC.
   */
  naiveDatetimeZone?: string;
  /**
   * Post-commit hook (v0.3.1): runs strictly AFTER the write's transaction
   * committed (`applyChanges`, `createRows`, `deleteRows`), with the request's
   * `ServerContext`, and is awaited. Never runs on a rollback; can never change
   * or fail the answer — a throw / rejection becomes `onWarning({ code:
   * "AFTER_COMMIT_FAILED", op, error })` (or `console.error` without a sink).
   */
  afterCommit?: AfterCommitHook<ServerContext>;
  /**
   * v0.4: manual cell colors (`createCellColorStore`, same database). Rows
   * carry `colors` (unreadable columns dropped), `setCellColors` is available,
   * color writes reach the change feed (change_log kind `color`) and deleted
   * rows lose their colors. Without it only rule colors exist (`colorIs` still
   * filters on them).
   */
  colors?: CellColorStore;
}

/**
 * A core `DataSource<GridRow>` bound to one user and request: validates the
 * schema once, resolves column access and the formula plan once, and routes
 * every call through the permission-checked query/write paths.
 */
export function createDrizzleDataSource(options: DrizzleDataSourceOptions): DataSource<GridRow> {
  const tables = options.tables ?? defineGridTables({ rowsTable: "grid_rows", changeLogTable: "grid_change_log" });
  assertValidSchema(options.schema, options.registry, {
    physicalColumns: options.physicalColumns ?? Object.keys(tables.physical),
    isFormulaTranslatable: formulaTranslatability(),
  });
  const ctx = createServerContext({
    schema: options.schema,
    registry: options.registry,
    resolver: options.resolver,
    user: options.user,
    ...(options.tz ? { tz: options.tz } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    ...(options.formulaFallbackRowCap ? { formulaFallbackRowCap: options.formulaFallbackRowCap } : {}),
  });
  const access = resolveAccess(ctx);
  const byId = new Map(ctx.schema.columns.map((c) => [c.id, c]));
  const hydrateOptions = options.naiveDatetimeZone ? { naiveDatetimeZone: options.naiveDatetimeZone } : {};

  const defaultSort: SortSpec[] = [];
  for (const s of options.defaultSort ?? []) {
    const column = byId.get(s.columnId);
    if (!column) throw new SchemaGridServerError("INVALID_DEFAULT_SORT", `defaultSort names an unknown column "${s.columnId}"`);
    if (column.sortable === false) {
      throw new SchemaGridServerError("INVALID_DEFAULT_SORT", `defaultSort column "${s.columnId}" is not sortable`);
    }
    const a = access.get(column.id);
    if (a === "read" || a === "edit") defaultSort.push({ columnId: s.columnId, dir: s.dir });
  }
  const withDefaultSort = (query: GridQuery): GridQuery =>
    defaultSort.length > 0 && (query.sort ?? []).length === 0 ? { ...query, sort: defaultSort.map((s) => ({ ...s })) } : query;

  const mapRows = async (rows: GridRow[]): Promise<GridRow[]> => {
    let out = rows;
    if (options.mapRows) {
      out = await options.mapRows(out, ctx);
      if (out.length !== rows.length) {
        throw new SchemaGridServerError("INTERNAL", `mapRows returned ${out.length} rows for ${rows.length} input rows`);
      }
    }
    if (options.mapRow) {
      const mapRow = options.mapRow;
      out = await Promise.all(out.map((r) => mapRow(r, ctx)));
    }
    return out;
  };
  const hasMap = Boolean(options.mapRows || options.mapRow);

  const baseScope = {
    ctx,
    tables,
    generatedColumns: options.generatedColumns ?? ("assumePresent" as const),
    ...(options.storageOverrides ? { storageOverrides: options.storageOverrides } : {}),
  };
  const gridScope: GridSqlScope = { ...baseScope, gridId: options.gridId };
  const colorStore = options.colors;
  // v0.4: the row's manual colors document, as a keyed lookup correlated with the outer rows table
  // (a JOIN would make the unqualified `updated_at` / `updated_by` of the projection ambiguous).
  const colorsDoc: SQL | undefined = colorStore
    ? sql`(select ${ident("sg_colors")}.${ident("colors")} from ${ident(colorStore.tableName)} as ${ident("sg_colors")} where ${ident("sg_colors")}.${ident("grid_id")} = ${options.gridId} and ${ident("sg_colors")}.${ident("row_id")} = CONVERT(${ident(tables.rowsTableName)}.${ident("id")} USING utf8mb4) COLLATE utf8mb4_bin)`
    : undefined;
  const baseRowSource = gridRowsSource(gridScope);
  const rowSource = {
    ...baseRowSource,
    ...(colorsDoc ? { projection: (acc: AccessMap) => ({ ...baseRowSource.projection(acc), sg_colors: colorsDoc }) } : {}),
    hydrate: (dbRow: Record<string, unknown>) => {
      const row = hydrateRow(dbRow as unknown as DbRow, ctx.schema, ctx.registry, hydrateOptions);
      return colorsDoc ? withCellColors(row, dbRow.sg_colors) : row;
    },
    ...(hasMap ? { mapRows } : {}),
  };
  const scope: GridSqlScope = {
    ...gridScope,
    rowSource,
    formulaPlans: planFormulaColumns(baseScope),
    ...(colorsDoc ? { colors: { manual: colorsDoc } } : {}),
  };
  const deps = { db: options.db, tables, gridId: options.gridId };
  /** `MISSING_TABLE` (naming the DDL helper) instead of a raw driver error when the grid tables were never created. */
  const known: Record<string, TableDdlHelper> = {
    [tables.rowsTableName]: "createRowsTableDDL",
    [tables.changeLogTableName]: "createChangeLogTableDDL",
    ...(colorStore ? { [colorStore.tableName]: "createCellColorsTableDDL" as const } : {}),
  };
  const guarded = <T>(fn: () => Promise<T>): Promise<T> => guardMissingTable(known, fn);
  const caps: DataSourceCapabilities = {
    ...DEFAULT_CAPABILITIES,
    lookup: Boolean(options.linkLookup),
    ...(defaultSort.length > 0 ? { defaultSort: defaultSort.map((s) => ({ ...s })) } : {}),
  };
  // Rule colors filter without a store; manual colors need one (and cell writes for painting).
  caps.cellColors = { read: Boolean(colorStore), write: Boolean(colorStore) && caps.write.cells, filter: true };

  /** `mapRows` + hydrate options + colors shared by every rows-by-id read (change feed, `ChangeResult.rows`, `getRows`). */
  const readOptions = { ...(hasMap ? { mapRows } : {}), ...hydrateOptions, ...(colorStore ? { colors: colorStore } : {}) };
  /** v0.3.1: `afterCommit`, strictly after the transaction resolved; failures only warn. */
  const afterCommit = (outcome: CommitOutcome) => runAfterCommit(options.afterCommit, ctx, outcome, options.onWarning);

  const readableColumn = (columnId: string) => {
    const column = byId.get(columnId);
    const a = column ? access.get(column.id) : undefined;
    if (!column || (a !== "read" && a !== "edit")) throw new PermissionError([columnId], "filter", "Unknown column");
    return column;
  };

  const ds: DataSource<GridRow> = {
    capabilities: () => caps,
    fetch: (input) =>
      guarded(async () => {
        const query = withDefaultSort(input);
        const qScope = colorQueryScope(query, scope, access, caps);
        if (query.groupBy && query.groupBy.length > 0) {
          return executeGroupQuery(buildGroupQuery(query, qScope, options.db, access), qScope);
        }
        return runRowQuery(query, qScope, options.db, access);
      }),
    applyChanges: async (batch) => {
      const result = await guarded(() => applyChanges(batch, ctx, deps, readOptions));
      await afterCommit({
        kind: "applyChanges",
        applied: result.applied,
        rejected: result.rejected ?? [],
        errors: result.errors,
        conflicts: result.conflicts,
        ...(batch.meta ? { meta: batch.meta } : {}),
        rows: result.rows ?? [],
      });
      return result;
    },
    createRows: async (partials) => {
      if (partials.length === 0) return [];
      const created = await guarded(() =>
        createRows(partials, ctx, deps, {
          transformRows: (rows) => evaluateFormulaCells(rows, access, ctx),
          ...(hasMap ? { mapRows } : {}),
          ...hydrateOptions,
        }),
      );
      await afterCommit({ kind: "createRows", created });
      return created;
    },
    deleteRows: async (ids) => {
      if (new Set(ids).size === 0) return;
      const deletedIds = await guarded(() =>
        deleteRows(ids, ctx, deps, {
          ...(options.canDeleteRows ? { canDeleteRows: options.canDeleteRows } : {}),
          ...(colorStore ? { onDeleted: (tx: GridDb, liveIds: string[]) => deleteCellColors(tx, colorStore, options.gridId, liveIds) } : {}),
        }),
      );
      await afterCommit({ kind: "deleteRows", deletedIds });
    },
    getChanges: (since) => guarded(() => getChanges(since, ctx, deps, readOptions)),
    getRows: (ids) => guarded(() => readRowsById(options.db, deps, ctx, ids, readOptions)),
    async getOptions(columnId, search) {
      const column = readableColumn(columnId);
      if (column.type === "user") return options.userDirectory ? options.userDirectory(search) : [];
      const all = (column.config as { options?: Option[] } | null)?.options ?? [];
      const term = search?.trim().toLowerCase();
      return term ? all.filter((o) => o.label.toLowerCase().includes(term)) : [...all];
    },
  };
  if (options.onCreateOption) {
    const onCreate = options.onCreateOption;
    ds.createOption = async (columnId, label) => {
      const column = readableColumn(columnId);
      if (access.get(column.id) !== "edit") throw new PermissionError([columnId], "edit");
      return onCreate(columnId, label);
    };
  }
  if (colorStore && caps.cellColors?.write) {
    /**
     * v0.4 manual colors: in ONE transaction, lock the batch's rows like `applyChanges`
     * (row-aware permissions), upsert each row's colors document, log one change_log
     * entry (kind `color`) per written cell so the change feed picks the rows up, and
     * re-read the written rows. Rows' `version` / `updatedAt` are untouched.
     */
    ds.setCellColors = async (batch: CellColorBatch) => {
      assertCellColorBatch(batch);
      return guarded(() =>
        options.db.transaction(async (tx): Promise<CellColorResult> => {
          const txDeps: WriteDeps = { ...deps, db: tx as unknown as GridDb };
          const locked = await loadRowsForUpdate(txDeps.db, txDeps, cellColorRowIds(batch), ctx);
          const live = new Map([...locked].filter(([, row]) => !row.deletedAt));
          const plan = planCellColors(batch, live, ctx, access);
          if (plan.writes.size === 0) return { applied: plan.applied, rejected: plan.rejected, rows: [] };
          const now = ctx.now();
          await writeCellColors(txDeps.db, colorStore, options.gridId, plan.writes, ctx.user.id, now);
          const log = [...plan.writes].flatMap(([rowId, cells]) =>
            [...cells].map(([columnId, color]) => ({ rowId, columnId, kind: "color" as const, prev: null, next: color })),
          );
          await insertChangeLog(txDeps.db, tables, { gridId: options.gridId, actor: ctx.user.id, at: now, batchId: batch.id }, log);
          const rows = await readRowsById(txDeps.db, txDeps, ctx, [...plan.writes.keys()], readOptions);
          return { applied: plan.applied, rejected: plan.rejected, rows };
        }),
      );
    };
  }
  if (options.linkLookup) {
    const lookup = options.linkLookup;
    ds.lookup = async (columnId, search) => {
      readableColumn(columnId);
      return lookup(columnId, search);
    };
  }
  return ds;
}
