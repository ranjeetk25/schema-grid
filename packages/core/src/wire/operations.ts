import type { LinkRef, Option } from "../common/types";
import type { DataSourceCapabilities } from "../datasource/capabilities";
import type { RowPartial } from "../datasource/types";
import type { GridSchema } from "../schema/types";
import type { GridQuery, QueryResult } from "../query/types";
import type { ChangeBatch, ChangeFeedEntry, ChangeResult, GridRow } from "../rows/types";

/**
 * Every wire operation: the `DataSource` operations (spec §4.6, plus the v0.2
 * `capabilities` op) followed by the grid-level schema operations (`getSchema`,
 * `updateSchema`) that a grid registry (`defineGrid` / `createGridRegistry`) serves.
 * Treat the list as a set and refer to operations by name, never by index.
 */
export const GRID_OPERATIONS = [
  "fetch",
  "applyChanges",
  "createRows",
  "deleteRows",
  "getChanges",
  "getOptions",
  "createOption",
  "lookup",
  "getRows",
  "capabilities",
  "getSchema",
  "updateSchema",
] as const;

export type GridOperation = (typeof GRID_OPERATIONS)[number];

/**
 * Operations a `DataSource` may omit (the handler answers 501 for them).
 * `capabilities` is optional on a `DataSource` too, but the handler answers
 * it with `inferCapabilities` instead.
 */
export const OPTIONAL_GRID_OPERATIONS = ["getChanges", "getOptions", "createOption", "lookup", "getRows"] as const;

export type OptionalGridOperation = (typeof OPTIONAL_GRID_OPERATIONS)[number];

/**
 * Operations served by the grid (its schema), not by a `DataSource`. A bare
 * `createDataSourceHandler` answers them with `UNSUPPORTED_OPERATION`.
 */
export const GRID_SCHEMA_OPERATIONS = ["getSchema", "updateSchema"] as const;

export type GridSchemaOperation = (typeof GRID_SCHEMA_OPERATIONS)[number];

const OPERATION_SET: ReadonlySet<string> = new Set(GRID_OPERATIONS);
const SCHEMA_OPERATION_SET: ReadonlySet<string> = new Set(GRID_SCHEMA_OPERATIONS);

export function isGridOperation(value: unknown): value is GridOperation {
  return typeof value === "string" && OPERATION_SET.has(value);
}

export function isGridSchemaOperation(value: unknown): value is GridSchemaOperation {
  return typeof value === "string" && SCHEMA_OPERATION_SET.has(value);
}

/**
 * JSON wire shape of every operation. Single-argument operations send the
 * argument itself; multi-argument ones send a named object. `deleteRows`
 * answers `null` (JSON has no `undefined`); `capabilities` takes `null`.
 */
export interface GridWireContract {
  fetch: { input: GridQuery; output: QueryResult<GridRow> };
  applyChanges: { input: ChangeBatch; output: ChangeResult };
  createRows: { input: { partials: RowPartial<GridRow>[] }; output: GridRow[] };
  deleteRows: { input: { ids: string[] }; output: null };
  getChanges: { input: { since: string }; output: ChangeFeedEntry<GridRow> };
  getOptions: { input: { columnId: string; search?: string }; output: Option[] };
  createOption: { input: { columnId: string; label: string }; output: Option };
  lookup: { input: { columnId: string; search: string }; output: LinkRef[] };
  /** v0.3.1: rows by id (projected, formulas evaluated); unknown ids are skipped. */
  getRows: { input: { ids: string[] }; output: GridRow[] };
  capabilities: { input: null; output: DataSourceCapabilities };
  /** Grid-level: the grid's current schema. Input `null`. */
  getSchema: { input: null; output: GridSchema };
  /** Grid-level: replace the schema (`schemaVersion` must be current); answers the stored schema (version bumped). */
  updateSchema: { input: GridSchema; output: GridSchema };
}

export type WireInput<Op extends GridOperation> = GridWireContract[Op]["input"];
export type WireOutput<Op extends GridOperation> = GridWireContract[Op]["output"];
