import type { FilterOperatorDef } from "../filter/operators";
import { UNIVERSAL_AGGREGATIONS } from "../query/aggregate";
import type { AggregationId } from "../query/types";
import type { ColumnDef } from "../schema/types";
import type { FieldTypeId } from "./ids";
import type { FieldTypeRegistry } from "./registry";
import type { AnyFieldType } from "./types";

/**
 * Looks up the `AnyFieldType` for `column`. For a formula column this is the
 * "formula" field type itself (not the mapped result type) — use
 * `getColumnOperators` when you need the result-type-aware operator list.
 */
export function getColumnFieldType(
  column: ColumnDef,
  registry: FieldTypeRegistry,
): AnyFieldType | undefined {
  return registry.get(column.type);
}

/**
 * Maps a formula's `config.resultType` to the field type id whose operators
 * a formula column should expose. Missing/unrecognized `resultType` falls
 * back to "text".
 */
export function resolveFormulaOperandTypeId(resultType: string | undefined): FieldTypeId {
  switch (resultType) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "datetime";
    case "text":
      return "text";
    default:
      return "text";
  }
}

/**
 * Returns the filter operators available for `column`. For a formula column,
 * resolves the operators of the field type mapped from
 * `column.config.resultType` (see `resolveFormulaOperandTypeId`). Returns an
 * empty array when the column's type (or mapped type) is not registered.
 */
export function getColumnOperators(
  column: ColumnDef,
  registry: FieldTypeRegistry,
): readonly FilterOperatorDef[] {
  if (column.type === "formula") {
    return registry.get(resolveFormulaOperandTypeId(formulaResultType(column)))?.operators ?? [];
  }
  return registry.get(column.type)?.operators ?? [];
}

function formulaResultType(column: ColumnDef): string | undefined {
  const config = column.config;
  if (typeof config !== "object" || config === null) return undefined;
  const rt = (config as { resultType?: unknown }).resultType;
  return typeof rt === "string" ? rt : undefined;
}

/**
 * The field type whose value semantics a column follows: the column's own
 * type, or for a formula column the type mapped from `config.resultType`.
 */
export function getColumnValueFieldType(
  column: ColumnDef,
  registry: FieldTypeRegistry,
): AnyFieldType | undefined {
  if (column.type === "formula") {
    return registry.get(resolveFormulaOperandTypeId(formulaResultType(column)));
  }
  return registry.get(column.type);
}

/**
 * Aggregations allowed on `column`: the universal ones (count, countEmpty,
 * countFilled) plus those its value field type declares. Formula columns
 * resolve through `config.resultType`, so only number-result formulas allow sum/avg.
 */
export function getColumnAggregations(
  column: ColumnDef,
  registry: FieldTypeRegistry,
): readonly AggregationId[] {
  const declared = getColumnValueFieldType(column, registry)?.aggregations ?? [];
  return [...new Set<AggregationId>([...UNIVERSAL_AGGREGATIONS, ...declared])];
}
