import { resolveAccess } from "../access/query-access";
import { applyChanges } from "../changes/apply-changes";
import type { GridDb } from "../changes/db";
import { createRows, deleteRows } from "../changes/rows-crud";
import { type ServerWarning, createServerContext } from "../context";
import { PermissionError } from "../errors";
import { getChanges } from "../feed/get-changes";
import { evaluateFormulaCells } from "../formula/evaluate-rows";
import { planFormulaColumns } from "../formula/formula-plan";
import { buildGroupQuery, executeGroupQuery } from "../grouping/translate-grouping";
import type {
  DataSource,
  FieldTypeRegistry,
  GridRow,
  GridSchema,
  LinkRef,
  Option,
  PermissionResolver,
  PermissionUser,
} from "../internal/core";
import type { GridSqlScope } from "../query/build-query";
import { runRowQuery } from "../query/run-query";
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
  const baseScope = {
    ctx,
    tables,
    generatedColumns: options.generatedColumns ?? ("assumePresent" as const),
    ...(options.storageOverrides ? { storageOverrides: options.storageOverrides } : {}),
  };
  const scope: GridSqlScope = { ...baseScope, formulaPlans: planFormulaColumns(baseScope), gridId: options.gridId };
  const deps = { db: options.db, tables, gridId: options.gridId };
  const byId = new Map(ctx.schema.columns.map((c) => [c.id, c]));

  const readableColumn = (columnId: string) => {
    const column = byId.get(columnId);
    const a = column ? access.get(column.id) : undefined;
    if (!column || (a !== "read" && a !== "edit")) throw new PermissionError([columnId], "filter", "Unknown column");
    return column;
  };

  const ds: DataSource<GridRow> = {
    async fetch(query) {
      if (query.groupBy && query.groupBy.length > 0) {
        return executeGroupQuery(buildGroupQuery(query, scope, options.db, access), scope);
      }
      return runRowQuery(query, scope, options.db, access);
    },
    applyChanges: (batch) => applyChanges(batch, ctx, deps),
    createRows: (partials) =>
      createRows(partials, ctx, deps, { transformRows: (rows) => evaluateFormulaCells(rows, access, ctx) }),
    deleteRows: (ids) => deleteRows(ids, ctx, deps, options.canDeleteRows ? { canDeleteRows: options.canDeleteRows } : {}),
    getChanges: (since) => getChanges(since, ctx, deps),
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
