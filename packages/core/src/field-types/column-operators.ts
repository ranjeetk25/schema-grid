import type { FilterOperatorDef } from "../filter/operators";
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
    const config = column.config as { resultType?: string } | null | undefined;
    const mappedId = resolveFormulaOperandTypeId(config?.resultType);
    return registry.get(mappedId)?.operators ?? [];
  }
  return registry.get(column.type)?.operators ?? [];
}
