/**
 * Converts a group bucket (column + key) into a `FilterCondition`, e.g. for
 * "filter to this group" actions in the UI.
 */
import type { ColumnDef, FieldTypeRegistry, FilterCondition } from "../internal/core";
import { effectiveFieldType, isEmptyValue } from "../internal/core";

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
    case "link": {
      const linkKey = key as { id?: unknown } | null;
      const id = linkKey && typeof linkKey === "object" ? String(linkKey.id) : String(key);
      return { columnId: column.id, operator: "is", value: id };
    }
    default:
      // select, creatableSelect, user, text-like, date, and formula result types
      // that fall back to text/number/boolean/date all use "is" over the raw key.
      return { columnId: column.id, operator: "is", value: key as string | number | boolean | null };
  }
}
