/**
 * The ONLY place this package imports @masai/schema-grid-core.
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
  SortSpec,
  UserRef,
  ViewDef,
} from "@masai/schema-grid-core";
export {
  DEFAULT_TIME_ZONE,
  createRolePermissionResolver,
  isAggregationAllowed,
  readableColumnIds,
  resolveColumnAccess,
} from "@masai/schema-grid-core";

// ---- field types / registry -------------------------------------------------
export type { AnyFieldType, FieldType, FieldTypeRegistry, ParseResult } from "@masai/schema-grid-core/field-types";
export {
  createDefaultRegistry,
  createFieldTypeRegistry,
  getColumnAggregations,
  getColumnOperators,
  getColumnValueFieldType,
  isEmptyValue,
} from "@masai/schema-grid-core/field-types";

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
} from "@masai/schema-grid-core/filter";
export {
  MAX_FILTER_DEPTH,
  NEGATIVE_OPERATOR_IDS,
  isNegativeOperator,
  matchesFilter,
  resolveRelativeDate,
  validateFilter,
} from "@masai/schema-grid-core/filter";

// ---- formula ----------------------------------------------------------------
export type {
  FormulaEnv,
  FormulaError,
  FormulaNode,
  FormulaResultType,
  FormulaValue,
} from "@masai/schema-grid-core/formula";
export {
  dependencies,
  detectFormulaCycles,
  evaluate,
  inferResultType,
  isFormulaError,
  parseFormula,
} from "@masai/schema-grid-core/formula";
