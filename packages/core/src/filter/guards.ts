import type { FilterCondition, FilterGroup } from "./types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A filter group: an object whose `children` is an array. Safe on untrusted input. */
export function isFilterGroup(node: unknown): node is FilterGroup {
  return isPlainObject(node) && Array.isArray(node.children);
}

/** A filter condition: string `columnId` and `operator`, and not a group. Safe on untrusted input. */
export function isFilterCondition(node: unknown): node is FilterCondition {
  return (
    isPlainObject(node) &&
    !Array.isArray(node.children) &&
    typeof node.columnId === "string" &&
    typeof node.operator === "string"
  );
}
