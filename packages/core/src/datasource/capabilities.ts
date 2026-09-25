import type { GridRow } from "../rows/types";
import type { ColumnDef, GridSchema } from "../schema/types";
import type { DataSource } from "./types";

/** `"all"` or an explicit allow-list of column ids. */
export type ColumnScope = "all" | { columnIds: string[] };

/**
 * What a data source can do. The grid reads it once (and again after a schema
 * change) and turns affordances off accordingly; servers enforce the same
 * limits. `changeFeed: "updates-only"` = `getChanges` reports updated rows but
 * never deletions (e.g. an `updated_at` feed).
 */
export interface DataSourceCapabilities {
  /** Largest `page.limit` the source honours; bigger requests are clamped. */
  maxPageSize: number;
  sort: ColumnScope;
  filter: ColumnScope;
  /** Allowed filter operator ids per column id (absent = every operator of the column's type). */
  operators?: Record<string, string[]>;
  groupBy: boolean;
  search: boolean;
  changeFeed: boolean | "updates-only";
  write: { cells: boolean; createRows: boolean; deleteRows: boolean };
  options: boolean;
  lookup: boolean;
  export: { maxRows?: number };
}

/** Everything allowed; `maxPageSize` 500. */
export const DEFAULT_CAPABILITIES: Readonly<DataSourceCapabilities> = Object.freeze({
  maxPageSize: 500,
  sort: "all",
  filter: "all",
  groupBy: true,
  search: true,
  changeFeed: true,
  write: Object.freeze({ cells: true, createRows: true, deleteRows: true }),
  options: true,
  lookup: true,
  export: Object.freeze({}),
}) as Readonly<DataSourceCapabilities>;

/** A partial capabilities object filled from `DEFAULT_CAPABILITIES` (`write`/`export` merged field by field). */
export function normalizeCapabilities(partial: Partial<DataSourceCapabilities> = {}): DataSourceCapabilities {
  const out: DataSourceCapabilities = {
    maxPageSize: partial.maxPageSize ?? DEFAULT_CAPABILITIES.maxPageSize,
    sort: partial.sort ?? DEFAULT_CAPABILITIES.sort,
    filter: partial.filter ?? DEFAULT_CAPABILITIES.filter,
    groupBy: partial.groupBy ?? DEFAULT_CAPABILITIES.groupBy,
    search: partial.search ?? DEFAULT_CAPABILITIES.search,
    changeFeed: partial.changeFeed ?? DEFAULT_CAPABILITIES.changeFeed,
    write: { ...DEFAULT_CAPABILITIES.write, ...(partial.write ?? {}) },
    options: partial.options ?? DEFAULT_CAPABILITIES.options,
    lookup: partial.lookup ?? DEFAULT_CAPABILITIES.lookup,
    export: { ...DEFAULT_CAPABILITIES.export, ...(partial.export ?? {}) },
  };
  if (partial.operators) out.operators = partial.operators;
  return out;
}

/**
 * The capabilities of a source that does not implement `capabilities()`:
 * everything the defaults allow, with `changeFeed`/`options`/`lookup` off
 * when the matching optional operation is missing.
 */
export function inferCapabilities<Row extends GridRow>(dataSource: DataSource<Row>): DataSourceCapabilities {
  return normalizeCapabilities({
    changeFeed: typeof dataSource.getChanges === "function",
    options: typeof dataSource.getOptions === "function",
    lookup: typeof dataSource.lookup === "function",
  });
}

/** `dataSource.capabilities()` (normalised) or `inferCapabilities(dataSource)`. */
export async function getDataSourceCapabilities<Row extends GridRow>(
  dataSource: DataSource<Row>,
): Promise<DataSourceCapabilities> {
  if (typeof dataSource.capabilities !== "function") return inferCapabilities(dataSource);
  return normalizeCapabilities(await dataSource.capabilities());
}

/** One column's effective options: column options ∩ source capabilities. */
export interface EffectiveColumnCapabilities {
  sortable: boolean;
  filterable: boolean;
  /** The source can write the column (never true for formulas). Permissions still apply on top. */
  settable: boolean;
  /** Allowed operator ids, when the source restricts them. */
  operators?: string[];
}

/** The grid's effective capability matrix (`mergeCapabilities`). */
export interface EffectiveCapabilities
  extends Omit<DataSourceCapabilities, "sort" | "filter" | "operators"> {
  columns: Record<string, EffectiveColumnCapabilities>;
}

const inScope = (scope: ColumnScope, id: string): boolean => scope === "all" || scope.columnIds.includes(id);

/** Intersects every column's `sortable`/`filterable`/`settable` with the source's capabilities. */
export function mergeCapabilities(schema: GridSchema, caps: DataSourceCapabilities): EffectiveCapabilities {
  const columns: Record<string, EffectiveColumnCapabilities> = {};
  for (const column of schema.columns) {
    const entry: EffectiveColumnCapabilities = {
      sortable: column.sortable !== false && inScope(caps.sort, column.id),
      filterable: column.filterable !== false && inScope(caps.filter, column.id),
      settable: column.settable !== false && column.type !== "formula" && caps.write.cells,
    };
    const ops = caps.operators?.[column.id];
    if (ops) entry.operators = [...ops];
    columns[column.id] = entry;
  }
  return {
    maxPageSize: caps.maxPageSize,
    groupBy: caps.groupBy,
    search: caps.search,
    changeFeed: caps.changeFeed,
    write: { ...caps.write },
    options: caps.options,
    lookup: caps.lookup,
    export: { ...caps.export },
    columns,
  };
}

/**
 * Writes the effective restrictions back onto the schema's column options
 * (`sortable`/`filterable`/`settable: false`), so everything that reads column
 * options (filter validation, pickers, access) honours the source too. Returns
 * the same schema object when nothing changes.
 */
export function applyEffectiveCapabilities(schema: GridSchema, effective: EffectiveCapabilities): GridSchema {
  let changed = false;
  const columns = schema.columns.map((column): ColumnDef => {
    const eff = effective.columns[column.id];
    if (!eff) return column;
    const patch: Partial<ColumnDef> = {};
    if (!eff.sortable && column.sortable !== false) patch.sortable = false;
    if (!eff.filterable && column.filterable !== false) patch.filterable = false;
    if (!eff.settable && column.settable !== false && column.type !== "formula") patch.settable = false;
    if (Object.keys(patch).length === 0) return column;
    changed = true;
    return { ...column, ...patch };
  });
  return changed ? { ...schema, columns } : schema;
}
