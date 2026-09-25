export const SCHEMA_GRID_CORE_VERSION = "0.0.1";

/** Placeholder kept so sibling packages' scaffolds still compile. */
export function ping(): string {
  return "core";
}

export type {
  ActorRef,
  ISODateString,
  ISODateTimeString,
  LinkRef,
  Option,
  UserRef,
} from "./common/types";
export {
  BUILTIN_FIELD_TYPE_IDS,
  type BuiltinFieldTypeId,
  type FieldTypeId,
} from "./field-types/ids";
export type {
  ColumnDef,
  ColumnPermissions,
  ColumnState,
  ColumnValidation,
  GridSchema,
  RoleRule,
  ViewDef,
} from "./schema/types";
export type {
  DateRange,
  FilterCondition,
  FilterGroup,
  FilterMeValue,
  FilterNode,
  FilterPrimitive,
  FilterRangeValue,
  FilterValue,
  RelativeDate,
  RelativeDateKind,
} from "./filter/types";
export type {
  AggregationId,
  GridQuery,
  GroupAggregateValue,
  GroupResult,
  GroupSpec,
  PageRequest,
  QueryResult,
  SortSpec,
} from "./query/types";
export type {
  CellChange,
  ChangeBatch,
  ChangeConflict,
  ChangeError,
  ChangeFeedEntry,
  ChangeResult,
  ChangeSource,
  GridRow,
} from "./rows/types";
export {
  migrateSchema,
  SchemaMigrationError,
  type SchemaMigration,
  type SchemaMigrationErrorCode,
} from "./schema/migrate";
export {
  getColumnById,
  getColumnByKey,
  indexColumns,
  type ColumnIndex,
} from "./schema/lookup";
export type { DataSource, RowPartial } from "./datasource/types";
export type { GridEventName, GridEvents } from "./events/types";
export type {
  Access,
  PermissionContext,
  PermissionResolver,
  PermissionUser,
} from "./permissions/types";
export {
  createRolePermissionResolver,
  type RolePermissionResolverOptions,
} from "./permissions/role-resolver";
export {
  editableColumnIds,
  readableColumnIds,
  resolveColumnAccess,
} from "./permissions/column-access";
