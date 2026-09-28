/**
 * v0.4 filter by color from a column's header menu: one top-level color
 * condition per column, AND-ed with the rest of the filter. Pure.
 */
import {
  type CellColor,
  type FilterCondition,
  type FilterNode,
  isCellColor,
  isColorOperatorId,
  isFilterGroup,
} from "../internal/core-contracts";

/** What a column is filtered to: some colors, "none" (has no color), or null (no color condition). */
export type ColumnColorFilter = CellColor[] | "none" | null;

const isColumnColorCondition = (
  node: FilterNode,
  columnId: string,
): node is FilterCondition =>
  !isFilterGroup(node) &&
  node.columnId === columnId &&
  isColorOperatorId(node.operator);

/** The top-level conditions of an AND filter (a bare condition counts as one); null for an OR root. */
function andChildren(filter: FilterNode | null): FilterNode[] | null {
  if (!filter) return [];
  if (!isFilterGroup(filter)) return [filter];
  return filter.op === "and" ? filter.children : null;
}

/**
 * Sets (or with `null` / `[]`, clears) the color condition of `columnId`:
 * a top-level `colorIs` (`colors`) or `colorIsNone` (`"none"`) replacing any
 * the column already has. An OR root is wrapped (`and(or, color)`) so its
 * meaning is kept. An emptied filter becomes `null`.
 */
export function setColumnColorFilter(
  filter: FilterNode | null,
  columnId: string,
  colors: ColumnColorFilter,
): FilterNode | null {
  const clear =
    colors === null || (Array.isArray(colors) && colors.length === 0);
  const condition: FilterCondition | null = clear
    ? null
    : colors === "none"
      ? { columnId, operator: "colorIsNone" }
      : { columnId, operator: "colorIs", value: [...colors] };
  const children = andChildren(filter);
  if (children === null) {
    // OR root: nothing of ours can sit at its top level.
    return condition && filter
      ? { op: "and", children: [filter, condition] }
      : filter;
  }
  const kept = children.filter((c) => !isColumnColorCondition(c, columnId));
  const next = condition ? [...kept, condition] : kept;
  return next.length === 0 ? null : { op: "and", children: next };
}

/** The column's top-level color condition in an AND filter (unknown colors dropped); null when it has none. */
export function columnColorFilter(
  filter: FilterNode | null,
  columnId: string,
): ColumnColorFilter {
  const found = (andChildren(filter) ?? []).find((c) =>
    isColumnColorCondition(c, columnId),
  ) as FilterCondition | undefined;
  if (!found) return null;
  if (found.operator === "colorIsNone") return "none";
  return Array.isArray(found.value) ? found.value.filter(isCellColor) : [];
}
