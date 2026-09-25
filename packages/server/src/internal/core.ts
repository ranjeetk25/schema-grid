/**
 * The ONLY place this package imports @ranjeetk25/schema-grid-core.
 * Everything the server uses from core is re-exported here, so a core API
 * change is absorbed in one file.
 */

// ---- §4 contract types ------------------------------------------------------
export type {
  Access,
  ActorRef,
  AggregationId,
  CellChange,
  ChangeBatch,
  ChangeConflict,
  ChangeError,
  ChangeFeedEntry,
  ChangeResult,
  ChangeSource,
  ColumnDef,
  ColumnPermissions,
  ColumnState,
  ColumnValidation,
  DataSource,
  FieldTypeId,
  GridQuery,
  GridRow,
  GridSchema,
  GroupAggregateValue,
  GroupResult,
  GroupSpec,
  LinkRef,
  Option,
  PageRequest,
  PermissionContext,
  PermissionResolver,
  PermissionUser,
  QueryResult,
  RowPartial,
  SchemaStore,
  SortSpec,
  UserRef,
  ViewDef,
} from "@ranjeetk25/schema-grid-core";
export {
  DEFAULT_TIME_ZONE,
  createRolePermissionResolver,
  isAggregationAllowed,
  readableColumnIds,
  resolveColumnAccess,
} from "@ranjeetk25/schema-grid-core";

// ---- data-source capabilities (spec v0.2 §C2) ------------------------------
// TODO(lane-a): core does not export these yet (Lane A owns C1/C2). Replace this
// block with `export type { DataSourceCapabilities } from "@ranjeetk25/schema-grid-core"`
// and `export { DEFAULT_CAPABILITIES } from "@ranjeetk25/schema-grid-core"` once it lands.

/** What a data source can do; the grid derives its feature matrix from it. */
export interface DataSourceCapabilities {
  maxPageSize: number;
  sort: "all" | { columnIds: string[] };
  filter: "all" | { columnIds: string[] };
  operators?: Record<string, string[]>;
  groupBy: boolean;
  search: boolean;
  /** `"updates-only"`: the feed reports changed rows but cannot detect deletes (spec §C8). */
  changeFeed: boolean | "updates-only";
  write: { cells: boolean; createRows: boolean; deleteRows: boolean };
  options: boolean;
  lookup: boolean;
  export: { maxRows?: number };
}

/** Everything on, `maxPageSize` 500 (spec §C2). */
export const DEFAULT_CAPABILITIES: Readonly<DataSourceCapabilities> = Object.freeze({
  maxPageSize: 500,
  sort: "all",
  filter: "all",
  groupBy: true,
  search: true,
  changeFeed: true,
  write: { cells: true, createRows: true, deleteRows: true },
  options: true,
  lookup: true,
  export: {},
});

// ---- field types / registry -------------------------------------------------
export type { AnyFieldType, FieldType, FieldTypeRegistry, ParseResult } from "@ranjeetk25/schema-grid-core/field-types";
export {
  createDefaultRegistry,
  createFieldTypeRegistry,
  getColumnAggregations,
  getColumnOperators,
  getColumnValueFieldType,
  isEmptyValue,
} from "@ranjeetk25/schema-grid-core/field-types";

// ---- filter -----------------------------------------------------------------
export type {
  DateRange,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOperatorDef,
  FilterPrimitive,
  FilterValue,
  FilterValueKind,
  RelativeDate,
  FilterValidationError as CoreFilterValidationError,
} from "@ranjeetk25/schema-grid-core/filter";
export {
  MAX_FILTER_DEPTH,
  NEGATIVE_OPERATOR_IDS,
  isNegativeOperator,
  matchesFilter,
  resolveRelativeDate,
  validateFilter,
} from "@ranjeetk25/schema-grid-core/filter";

// ---- formula ----------------------------------------------------------------
export type {
  FormulaEnv,
  FormulaError,
  FormulaNode,
  FormulaResultType,
  FormulaValue,
} from "@ranjeetk25/schema-grid-core/formula";
export {
  dependencies,
  detectFormulaCycles,
  evaluate,
  inferResultType,
  isFormulaError,
  parseFormula,
} from "@ranjeetk25/schema-grid-core/formula";

// ---- wire (transport-neutral op contract) -----------------------------------
export type {
  DataSourceHandler,
  DataSourceHandlerOptions,
  GridOperation,
  GridSchemaOperation,
  WireError,
  WireOutputOf,
  WireResult,
} from "@ranjeetk25/schema-grid-core/wire";
export {
  createDataSourceHandler,
  httpStatusFor,
  isGridOperation,
  isGridSchemaOperation,
  toWireError,
  wireSchemas,
} from "@ranjeetk25/schema-grid-core/wire";
