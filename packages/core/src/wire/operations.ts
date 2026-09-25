import type { LinkRef, Option } from "../common/types";
import type { DataSourceCapabilities } from "../datasource/capabilities";
import type { RowPartial } from "../datasource/types";
import type { GridQuery, QueryResult } from "../query/types";
import type { ChangeBatch, ChangeFeedEntry, ChangeResult, GridRow } from "../rows/types";

/**
 * The `DataSource` operations, in contract order (spec §4.6; `capabilities`
 * is v0.2 op #9). Code must refer to operations by name, never by index.
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
  "capabilities",
] as const;

export type GridOperation = (typeof GRID_OPERATIONS)[number];

/**
 * Operations a `DataSource` may omit (the handler answers 501 for them).
 * `capabilities` is optional on a `DataSource` too, but the handler answers
 * it with `inferCapabilities` instead.
 */
export const OPTIONAL_GRID_OPERATIONS = ["getChanges", "getOptions", "createOption", "lookup"] as const;

export type OptionalGridOperation = (typeof OPTIONAL_GRID_OPERATIONS)[number];

const OPERATION_SET: ReadonlySet<string> = new Set(GRID_OPERATIONS);

export function isGridOperation(value: unknown): value is GridOperation {
  return typeof value === "string" && OPERATION_SET.has(value);
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
  capabilities: { input: null; output: DataSourceCapabilities };
}

export type WireInput<Op extends GridOperation> = GridWireContract[Op]["input"];
export type WireOutput<Op extends GridOperation> = GridWireContract[Op]["output"];
