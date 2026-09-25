/**
 * Core adapter. The ONLY place ui-shadcn imports `@masai/schema-grid-core`
 * from. Everything is re-exported from the real package; the few local
 * helpers at the bottom are UI-specific (not gaps in core).
 */
import type { FilterValueKind } from "@masai/schema-grid-core";
import { RELATIVE_DATE_PRESETS } from "@masai/schema-grid-core/filter";

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
  RelativeDatePreset,
} from "@masai/schema-grid-core/filter";
export {
  MAX_FILTER_DEPTH,
  NEGATIVE_OPERATOR_IDS,
  RELATIVE_DATE_PRESETS,
  findOperator,
  isFilterCondition,
  isFilterGroup,
  validateFilter,
} from "@masai/schema-grid-core/filter";

// §4.8 formula
export type { FormulaError, FormulaNode, FormulaResultType } from "@masai/schema-grid-core";
export { FORMULA_FUNCTIONS, dependencies, inferResultType, isFormulaError, parseFormula } from "@masai/schema-grid-core";
// Formula evaluation (column-builder live preview).
export type { FormulaEnv, FormulaFunctionDef, FormulaValue } from "@masai/schema-grid-core";
export { DEFAULT_TIME_ZONE, evaluate } from "@masai/schema-grid-core";

// ---------------------------------------------------------------------------
// Local helpers — gaps in core's public API
// ---------------------------------------------------------------------------

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
      const preset = isObject(value) ? RELATIVE_DATE_PRESETS.find((p) => p.kind === value.relative) : undefined;
      if (!preset || !isObject(value)) return false;
      if (preset.needsN) return typeof value.n === "number" && Number.isInteger(value.n) && value.n > 0;
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
