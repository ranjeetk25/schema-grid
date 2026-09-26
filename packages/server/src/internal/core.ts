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
  ChangeMeta,
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
  RoleRule,
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
  optionRuleViolation,
  readableColumnIds,
  resolveColumnAccess,
} from "@ranjeetk25/schema-grid-core";

// ---- data-source capabilities (spec v0.2 §C2) ------------------------------
export type { DataSourceCapabilities } from "@ranjeetk25/schema-grid-core";
export { DEFAULT_CAPABILITIES } from "@ranjeetk25/schema-grid-core";

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
