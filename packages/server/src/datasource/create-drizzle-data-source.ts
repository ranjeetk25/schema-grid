import { resolveAccess } from "../access/query-access";
import { applyChanges } from "../changes/apply-changes";
import type { GridDb } from "../changes/db";
import { createRows, deleteRows } from "../changes/rows-crud";
import { type ServerContext, type ServerWarning, createServerContext } from "../context";
import { PermissionError, SchemaGridServerError, type TableDdlHelper, guardMissingTable } from "../errors";
import { getChanges } from "../feed/get-changes";
import { evaluateFormulaCells } from "../formula/evaluate-rows";
import { formulaTranslatability, planFormulaColumns } from "../formula/formula-plan";
import { buildGroupQuery, executeGroupQuery } from "../grouping/translate-grouping";
import {
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
   * projection (hidden cells still present), on fetch, the change feed and
   * `createRows`. Must return one row per input row, in order.
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
  const rowSource = {
    ...gridRowsSource(gridScope),
    hydrate: (dbRow: Record<string, unknown>) => hydrateRow(dbRow as unknown as DbRow, ctx.schema, ctx.registry, hydrateOptions),
    ...(hasMap ? { mapRows } : {}),
  };
  const scope: GridSqlScope = { ...gridScope, rowSource, formulaPlans: planFormulaColumns(baseScope) };
  const deps = { db: options.db, tables, gridId: options.gridId };
  /** `MISSING_TABLE` (naming the DDL helper) instead of a raw driver error when the grid tables were never created. */
  const known: Record<string, TableDdlHelper> = {
    [tables.rowsTableName]: "createRowsTableDDL",
    [tables.changeLogTableName]: "createChangeLogTableDDL",
  };
  const guarded = <T>(fn: () => Promise<T>): Promise<T> => guardMissingTable(known, fn);
  const caps: DataSourceCapabilities = {
    ...DEFAULT_CAPABILITIES,
    lookup: Boolean(options.linkLookup),
    ...(defaultSort.length > 0 ? { defaultSort: defaultSort.map((s) => ({ ...s })) } : {}),
  };

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
        if (query.groupBy && query.groupBy.length > 0) {
          return executeGroupQuery(buildGroupQuery(query, scope, options.db, access), scope);
        }
        return runRowQuery(query, scope, options.db, access);
      }),
    applyChanges: (batch) => guarded(() => applyChanges(batch, ctx, deps)),
    createRows: (partials) =>
      guarded(() =>
        createRows(partials, ctx, deps, {
          transformRows: (rows) => evaluateFormulaCells(rows, access, ctx),
          ...(hasMap ? { mapRows } : {}),
          ...hydrateOptions,
        }),
      ),
    deleteRows: (ids) =>
      guarded(() => deleteRows(ids, ctx, deps, options.canDeleteRows ? { canDeleteRows: options.canDeleteRows } : {})),
    getChanges: (since) => guarded(() => getChanges(since, ctx, deps, { ...(hasMap ? { mapRows } : {}), ...hydrateOptions })),
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
  if (options.linkLookup) {
    const lookup = options.linkLookup;
    ds.lookup = async (columnId, search) => {
      readableColumn(columnId);
      return lookup(columnId, search);
    };
  }
  return ds;
}
