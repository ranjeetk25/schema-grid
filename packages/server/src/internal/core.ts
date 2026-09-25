/**
 * The ONLY place this package imports @masai/schema-grid-core.
 *
 * Core is being built concurrently and currently exports only a placeholder,
 * so every name below comes from `./core-shim/*` — minimal local copies that
 * follow spec §4 and the core plan exactly. Each line is marked
 * `TODO(core)`. Swap-in procedure: delete `./core-shim/`, then replace each
 * section's `from "./core-shim/…"` with `from "@masai/schema-grid-core"` (or
 * its `/filter`, `/formula`, `/field-types` subpaths).
 */

// ---- §4 contract types ------------------------------------------------------
export type {
  Access, // TODO(core): replace with @masai/schema-grid-core export
  ActorRef, // TODO(core): replace with @masai/schema-grid-core export
  AggregationId, // TODO(core): replace with @masai/schema-grid-core export
  AnyFieldType, // TODO(core): replace with @masai/schema-grid-core export
  CellChange, // TODO(core): replace with @masai/schema-grid-core export
  ChangeBatch, // TODO(core): replace with @masai/schema-grid-core export
  ChangeConflict, // TODO(core): replace with @masai/schema-grid-core export
  ChangeError, // TODO(core): replace with @masai/schema-grid-core export
  ChangeFeedEntry, // TODO(core): replace with @masai/schema-grid-core export
  ChangeResult, // TODO(core): replace with @masai/schema-grid-core export
  ChangeSource, // TODO(core): replace with @masai/schema-grid-core export
  ColumnDef, // TODO(core): replace with @masai/schema-grid-core export
  ColumnPermissions, // TODO(core): replace with @masai/schema-grid-core export
  ColumnState, // TODO(core): replace with @masai/schema-grid-core export
  DataSource, // TODO(core): replace with @masai/schema-grid-core export
  DateRange, // TODO(core): replace with @masai/schema-grid-core export
  FieldType, // TODO(core): replace with @masai/schema-grid-core export
  FieldTypeId, // TODO(core): replace with @masai/schema-grid-core export
  FieldTypeRegistry, // TODO(core): replace with @masai/schema-grid-core export
  FilterCondition, // TODO(core): replace with @masai/schema-grid-core export
  FilterGroup, // TODO(core): replace with @masai/schema-grid-core export
  FilterNode, // TODO(core): replace with @masai/schema-grid-core export
  FilterOperatorDef, // TODO(core): replace with @masai/schema-grid-core export
  FilterPrimitive, // TODO(core): replace with @masai/schema-grid-core export
  FilterValue, // TODO(core): replace with @masai/schema-grid-core export
  FilterValueKind, // TODO(core): replace with @masai/schema-grid-core export
  GridQuery, // TODO(core): replace with @masai/schema-grid-core export
  GridRow, // TODO(core): replace with @masai/schema-grid-core export
  GridSchema, // TODO(core): replace with @masai/schema-grid-core export
  GroupAggregateValue, // TODO(core): replace with @masai/schema-grid-core export
  GroupResult, // TODO(core): replace with @masai/schema-grid-core export
  GroupSpec, // TODO(core): replace with @masai/schema-grid-core export
  LinkRef, // TODO(core): replace with @masai/schema-grid-core export
  Option, // TODO(core): replace with @masai/schema-grid-core export
  PageRequest, // TODO(core): replace with @masai/schema-grid-core export
  ParseResult, // TODO(core): replace with @masai/schema-grid-core export
  PermissionContext, // TODO(core): replace with @masai/schema-grid-core export
  PermissionResolver, // TODO(core): replace with @masai/schema-grid-core export
  PermissionUser, // TODO(core): replace with @masai/schema-grid-core export
  QueryResult, // TODO(core): replace with @masai/schema-grid-core export
  RelativeDate, // TODO(core): replace with @masai/schema-grid-core export
  RowPartial, // TODO(core): replace with @masai/schema-grid-core export
  SortSpec, // TODO(core): replace with @masai/schema-grid-core export
  UserRef, // TODO(core): replace with @masai/schema-grid-core export
  ViewDef, // TODO(core): replace with @masai/schema-grid-core export
} from "./core-shim/types";

// ---- formula types ----------------------------------------------------------
export type {
  FormulaEnv, // TODO(core): replace with @masai/schema-grid-core export
  FormulaError, // TODO(core): replace with @masai/schema-grid-core export
  FormulaNode, // TODO(core): replace with @masai/schema-grid-core export
  FormulaResultType, // TODO(core): replace with @masai/schema-grid-core export
  FormulaValue, // TODO(core): replace with @masai/schema-grid-core export
} from "./core-shim/types";

// ---- field types / registry -------------------------------------------------
export {
  createDefaultRegistry, // TODO(core): replace with @masai/schema-grid-core export
  createFieldTypeRegistry, // TODO(core): replace with @masai/schema-grid-core export
  getColumnFieldType, // TODO(core): replace with @masai/schema-grid-core export
  getColumnOperators, // TODO(core): replace with @masai/schema-grid-core export
  isAggregationAllowed, // TODO(core): replace with @masai/schema-grid-core export
} from "./core-shim/registry";
export { isEmptyValue } from "./core-shim/empty"; // TODO(core): replace with @masai/schema-grid-core export

// ---- filter -----------------------------------------------------------------
export {
  NEGATIVE_OPERATOR_IDS, // TODO(core): replace with @masai/schema-grid-core export
  isNegativeOperator, // TODO(core): replace with @masai/schema-grid-core export
} from "./core-shim/operators";
export {
  DEFAULT_TIME_ZONE, // TODO(core): replace with @masai/schema-grid-core export
  resolveRelativeDate, // TODO(core): replace with @masai/schema-grid-core export
} from "./core-shim/relative-date";
export {
  MAX_FILTER_DEPTH, // TODO(core): replace with @masai/schema-grid-core export
  validateFilter, // TODO(core): replace with @masai/schema-grid-core export
} from "./core-shim/validate-filter";
export type { FilterValidationError as CoreFilterValidationError } from "./core-shim/validate-filter"; // TODO(core): replace with @masai/schema-grid-core `FilterValidationError`

export {
  compareRows, // TODO(core): replace with @masai/schema-grid-core in-memory sort comparator
  matchesFilter, // TODO(core): replace with @masai/schema-grid-core export
} from "./core-shim/match";

// ---- permissions ------------------------------------------------------------
export {
  createRolePermissionResolver, // TODO(core): replace with @masai/schema-grid-core export
  readableColumnIds, // TODO(core): replace with @masai/schema-grid-core export
  resolveColumnAccess, // TODO(core): replace with @masai/schema-grid-core export
} from "./core-shim/permissions";

// ---- formula ----------------------------------------------------------------
export {
  dependencies, // TODO(core): replace with @masai/schema-grid-core export
  detectFormulaCycles, // TODO(core): replace with @masai/schema-grid-core export
  evaluate, // TODO(core): replace with @masai/schema-grid-core export (shim evaluates only the SQL-translatable subset)
  inferResultType, // TODO(core): replace with @masai/schema-grid-core export
  isFormulaError, // TODO(core): replace with @masai/schema-grid-core export
  parseFormula, // TODO(core): replace with @masai/schema-grid-core export
} from "./core-shim/formula";
