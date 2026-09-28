import { isFilterGroup } from "./guards";
import type { FilterNode } from "./types";

export type FilterValueKind = "none" | "single" | "multi" | "range" | "relativeDate" | "me";

export interface FilterOperatorDef {
  id: string;
  label: string;
  valueKind: FilterValueKind;
  negative?: boolean;
}

export const NEGATIVE_OPERATOR_IDS: ReadonlySet<string> = new Set([
  "isNot",
  "isNoneOf",
  "notContains",
  "neq",
  "hasNoneOf",
  "isNotMe",
]);

export function isNegativeOperator(id: string): boolean {
  return NEGATIVE_OPERATOR_IDS.has(id);
}

function op(id: string, label: string, valueKind: FilterValueKind): FilterOperatorDef {
  return Object.freeze(isNegativeOperator(id) ? { id, label, valueKind, negative: true } : { id, label, valueKind });
}

export const TEXT_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("contains", "contains", "single"),
  op("notContains", "does not contain", "single"),
  op("startsWith", "starts with", "single"),
  op("is", "is", "single"),
  op("isNot", "is not", "single"),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);

export const NUMBER_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("eq", "=", "single"),
  op("neq", "≠", "single"),
  op("lt", "<", "single"),
  op("lte", "≤", "single"),
  op("gt", ">", "single"),
  op("gte", "≥", "single"),
  op("between", "is between", "range"),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);

export const DATE_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("is", "is", "single"),
  op("isBefore", "is before", "single"),
  op("isAfter", "is after", "single"),
  op("isBetween", "is between", "range"),
  op("isWithin", "is within", "relativeDate"),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);

export const SELECT_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("is", "is", "single"),
  op("isNot", "is not", "single"),
  op("isAnyOf", "is any of", "multi"),
  op("isNoneOf", "is none of", "multi"),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);

export const USER_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  ...SELECT_OPERATORS,
  op("isMe", "is me", "me"),
  op("isNotMe", "is not me", "me"),
]);

export const MULTI_SELECT_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("hasAnyOf", "has any of", "multi"),
  op("hasAllOf", "has all of", "multi"),
  op("hasNoneOf", "has none of", "multi"),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);

export const BOOLEAN_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("isTrue", "is true", "none"),
  op("isFalse", "is false", "none"),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);

export const LINK_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("is", "is", "single"),
  op("isAnyOf", "is any of", "multi"),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);

/**
 * v0.4: filter by the color a cell SHOWS (manual color > cells rule > row
 * rule, see `resolveCellColor`). Available on every readable column, including
 * `filterable: false` ones (they filter the annotation, not the value), so they
 * are not part of any field type's operator list.
 */
export const COLOR_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("colorIs", "color is", "multi"),
  op("colorIsNone", "has no color", "none"),
]);

const COLOR_OPERATOR_IDS: ReadonlySet<string> = new Set(COLOR_OPERATORS.map((def) => def.id));

/** True for `colorIs` / `colorIsNone`. */
export function isColorOperator(id: unknown): boolean {
  return typeof id === "string" && COLOR_OPERATOR_IDS.has(id);
}

/**
 * True when any condition of `node` uses a color operator (the only case in
 * which `GridQuery.colorRules` matter to a data source). Safe on untrusted input.
 */
export function hasColorCondition(node: FilterNode | null | undefined): boolean {
  if (typeof node !== "object" || node === null) return false;
  if (isFilterGroup(node)) return node.children.some((child) => hasColorCondition(child));
  return isColorOperator((node as { operator?: unknown }).operator);
}

export function findOperator(
  operators: readonly FilterOperatorDef[],
  id: string,
): FilterOperatorDef | undefined {
  return operators.find((def) => def.id === id);
}
