/**
 * Core adapter. The ONLY place ui-mantine imports `@masai/schema-grid-core`
 * from. Everything is re-exported from the real package; the few local
 * helpers at the bottom cover gaps core does not (yet) export.
 */
import type {
  FilterGroup,
  FilterNode,
  FilterValueKind,
  RelativeDateKind,
} from "@masai/schema-grid-core";

// §4.1 schema, §4.4 query, §4.5 rows, §4.6 data source, common refs
export type {
  ActorRef,
  AggregationId,
  CellChange,
  ChangeBatch,
  ChangeConflict,
  ChangeResult,
  ColumnDef,
  ColumnPermissions,
  ColumnState,
  DataSource,
  FieldTypeId,
  GridQuery,
  GridRow,
  GridSchema,
  GroupSpec,
  LinkRef,
  Option,
  QueryResult,
  RoleRule,
  SortSpec,
  UserRef,
  ViewDef,
} from "@masai/schema-grid-core";
export { BUILTIN_FIELD_TYPE_IDS } from "@masai/schema-grid-core";

// §4.7 permissions
export type { Access, PermissionContext, PermissionResolver, PermissionUser } from "@masai/schema-grid-core";
export { createRolePermissionResolver, resolveColumnAccess } from "@masai/schema-grid-core";

// §4.2 field types
export type { AnyFieldType, FieldType, FieldTypeRegistry, ParseResult } from "@masai/schema-grid-core";
export {
  createDefaultRegistry,
  createFieldTypeRegistry,
  getColumnAggregations,
  getColumnOperators,
  getColumnValueFieldType,
  isEmptyValue,
  resolveFormulaOperandTypeId,
} from "@masai/schema-grid-core/field-types";

// §4.3 filter AST + validation
export type {
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOperatorDef,
  FilterPrimitive,
  FilterValidationError,
  FilterValidationErrorCode,
  FilterValue,
  FilterValueKind,
  RelativeDate,
  RelativeDateKind,
} from "@masai/schema-grid-core";
export { MAX_FILTER_DEPTH, NEGATIVE_OPERATOR_IDS, findOperator, validateFilter } from "@masai/schema-grid-core";

// §4.8 formula
export type { FormulaError, FormulaNode, FormulaResultType } from "@masai/schema-grid-core";
export { FORMULA_FUNCTIONS, dependencies, inferResultType, isFormulaError, parseFormula } from "@masai/schema-grid-core";

// ---------------------------------------------------------------------------
// Local helpers — gaps in core's public API
// ---------------------------------------------------------------------------

/**
 * Relative-date presets in display order. Core validates against the same
 * list but only exports the `RelativeDateKind` type.
 * TODO(core): replace with a core export if one is added.
 */
export const RELATIVE_DATE_PRESETS: readonly RelativeDateKind[] = [
  "today",
  "yesterday",
  "tomorrow",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "lastNDays",
  "nextNDays",
];

/** Core's validator uses a private `isGroup`; this is the public equivalent. */
export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return typeof node === "object" && node !== null && Array.isArray((node as FilterGroup).children);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFilledPrimitive = (v: unknown) =>
  typeof v === "string" ? v !== "" : typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/**
 * Whether a draft value is complete for its operator's value kind. Stricter
 * than core's `validateFilter` (which accepts `""`): UI drafts treat blank
 * strings as "not filled in yet".
 */
export function valueMatchesKind(kind: FilterValueKind, value: unknown): boolean {
  switch (kind) {
    case "none":
      return value === undefined;
    case "single":
      return isFilledPrimitive(value);
    case "multi":
      return Array.isArray(value) && value.length > 0 && value.every(isFilledPrimitive);
    case "range":
      return isObject(value) && isFilledPrimitive(value.from) && isFilledPrimitive(value.to);
    case "relativeDate": {
      if (!isObject(value) || !(RELATIVE_DATE_PRESETS as readonly unknown[]).includes(value.relative)) return false;
      if (value.relative === "lastNDays" || value.relative === "nextNDays")
        return typeof value.n === "number" && Number.isInteger(value.n) && value.n > 0;
      return true;
    }
    case "me":
      return isObject(value) && value.me === true;
    default:
      return false;
  }
}

/** Currency symbol for an ISO code in a locale, e.g. INR → ₹. */
export function currencySymbol(currency: string, locale = "en-US"): string {
  try {
    const part = new Intl.NumberFormat(locale, { style: "currency", currency })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

/** A user option as returned by `DataSource.getOptions` for user columns; `avatarUrl` is a UI extension. */
export interface UserOption {
  id: string;
  label: string;
  color?: string;
  avatarUrl?: string;
}
