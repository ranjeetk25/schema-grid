/**
 * Converts a group bucket (column + key) into a `FilterCondition`, e.g. for
 * "filter to this group" actions in the UI.
 */
import type { ColumnDef, FieldTypeRegistry, FilterCondition } from "../internal/core";
import { effectiveFieldType, isEmptyValue } from "../internal/core";

function refId(v: unknown): string {
  if (v && typeof v === "object" && "id" in v) return String((v as { id: unknown }).id);
  return String(v);
}

export function groupKeyToCondition(column: ColumnDef, key: unknown, registry: FieldTypeRegistry): FilterCondition {
  if (isEmptyValue(key)) {
    return { columnId: column.id, operator: "isEmpty" };
  }

  const fieldType = effectiveFieldType(registry, column);
  const typeId = fieldType?.id ?? column.type;

  switch (typeId) {
    case "boolean":
      return { columnId: column.id, operator: key ? "isTrue" : "isFalse" };
    case "number":
    case "currency":
      return { columnId: column.id, operator: "eq", value: key as number };
    case "multiSelect":
      return { columnId: column.id, operator: "hasAllOf", value: key as string[] };
    case "user":
      // core user values are `UserRef {id, name?}`; `is` compares ids.
      return { columnId: column.id, operator: "is", value: refId(key) };
    case "link": {
      // core link values are `LinkRef[]`. LINK_OPERATORS only offer is/isAnyOf,
      // both "any ref id matches": one link → `is`, several → `isAnyOf` (the
      // closest expressible match; it also admits rows sharing only some links).
      const ids = (Array.isArray(key) ? key : [key]).map(refId);
      if (ids.length === 1) return { columnId: column.id, operator: "is", value: ids[0] as string };
      return { columnId: column.id, operator: "isAnyOf", value: ids };
    }
    default:
      // select, creatableSelect, text-like, date, and formula result types
      // that fall back to text/number/boolean/date all use "is" over the raw key.
      return { columnId: column.id, operator: "is", value: key as string | number | boolean | null };
  }
}
