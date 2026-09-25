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
