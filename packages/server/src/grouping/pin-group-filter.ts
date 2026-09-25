import { GroupingError } from "../errors";
import {
  type FieldTypeRegistry,
  type FilterCondition,
  type FilterNode,
  type FilterPrimitive,
  type GridQuery,
  type GridSchema,
  getColumnOperators,
  isEmptyValue,
} from "../internal/core";
import { storageKindOf } from "../sql/storage-kind";

export interface GroupPin {
  columnId: string;
  /** The group's `value` from `GroupResult` (null for the empty group). */
  value: unknown;
}

function pinCondition(pin: GroupPin, schema: GridSchema, registry: FieldTypeRegistry): FilterCondition {
  const column = schema.columns.find((c) => c.id === pin.columnId);
  if (!column) throw new GroupingError(`Unknown pinned column "${pin.columnId}"`, { columnId: pin.columnId });
  const kind = storageKindOf(column, registry).kind;

  let cond: FilterCondition;
  if (isEmptyValue(pin.value)) cond = { columnId: column.id, operator: "isEmpty" };
  else if (kind === "boolean") cond = { columnId: column.id, operator: pin.value === true ? "isTrue" : "isFalse" };
  else if (kind === "number") cond = { columnId: column.id, operator: "eq", value: pin.value as FilterPrimitive };
  else cond = { columnId: column.id, operator: "is", value: pin.value as FilterPrimitive };

  if (!getColumnOperators(column, registry).some((o) => o.id === cond.operator)) {
    throw new GroupingError(`Cannot pin column "${column.id}": operator "${cond.operator}" is not available for ${column.type}`, {
      columnId: column.id,
      operator: cond.operator,
    });
  }
  return cond;
}

/**
 * Builds the GridQuery for the next (child) grouping level: the first
 * `pins.length` groupBy levels are dropped and one condition per pin is added
 * to the filter (`isEmpty` for the null group, `isTrue`/`isFalse` for booleans,
 * `eq` for numbers, `is` otherwise).
 *
 * Filter shape: an AND root gets the pins appended; a null root becomes
 * AND[pins]; any other root becomes AND[...pins, root] — the only shape
 * `assertQueryAccess` lets reach depth 3.
 *
 * Paging restarts at offset 0 (a parent cursor never matches the child's
 * fingerprint). When `groupBy` is empty afterwards, this is the last level:
 * the caller fetches ROWS (`runRowQuery`) instead of groups.
 *
 * Throws `GroupingError` when pins do not line up with the leading groupBy
 * levels, or a pin has no valid operator (e.g. the empty group of a custom
 * field type that offers no `isEmpty` operator).
 */
export function pinGroupFilter(
  query: GridQuery,
  pins: readonly GroupPin[],
  schema: GridSchema,
  registry: FieldTypeRegistry,
): GridQuery {
  const groupBy = query.groupBy ?? [];
  if (pins.length > groupBy.length) {
    throw new GroupingError(`Cannot pin ${pins.length} level(s) of a ${groupBy.length}-level grouping`);
  }
  pins.forEach((pin, i) => {
    if (groupBy[i]?.columnId !== pin.columnId) {
      throw new GroupingError(`Pin ${i} (${pin.columnId}) does not match groupBy level ${i} (${groupBy[i]?.columnId})`, {
        columnId: pin.columnId,
        level: i,
      });
    }
  });

  const conditions: FilterNode[] = pins.map((p) => pinCondition(p, schema, registry));
  const root = query.filter;
  let filter: FilterNode | null;
  if (conditions.length === 0) filter = root;
  else if (!root) filter = { op: "and", children: conditions };
  else if ("op" in root && root.op === "and") filter = { op: "and", children: [...root.children, ...conditions] };
  else filter = { op: "and", children: [...conditions, root] };

  return {
    ...query,
    filter,
    groupBy: groupBy.slice(pins.length),
    page: { offset: 0, limit: query.page.limit },
  };
}
