/** TEMPORARY copy of core's operator catalog (core plan Task 4). TODO(core) */
import type { FilterOperatorDef } from "./types";

const op = (
  id: string,
  label: string,
  valueKind: FilterOperatorDef["valueKind"],
  negative?: true,
): FilterOperatorDef => (negative ? { id, label, valueKind, negative } : { id, label, valueKind });

export const TEXT_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("contains", "contains", "single"),
  op("notContains", "does not contain", "single", true),
  op("startsWith", "starts with", "single"),
  op("is", "is", "single"),
  op("isNot", "is not", "single", true),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);
export const NUMBER_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("eq", "=", "single"),
  op("neq", "≠", "single", true),
  op("lt", "<", "single"),
  op("lte", "≤", "single"),
  op("gt", ">", "single"),
  op("gte", "≥", "single"),
  op("between", "between", "range"),
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
  op("isNot", "is not", "single", true),
  op("isAnyOf", "is any of", "multi"),
  op("isNoneOf", "is none of", "multi", true),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);
export const USER_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  ...SELECT_OPERATORS,
  op("isMe", "is me", "me"),
  op("isNotMe", "is not me", "me", true),
]);
export const MULTI_SELECT_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("hasAnyOf", "has any of", "multi"),
  op("hasAllOf", "has all of", "multi"),
  op("hasNoneOf", "has none of", "multi", true),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);
export const BOOLEAN_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("isTrue", "is true", "none"),
  op("isFalse", "is false", "none"),
]);
export const LINK_OPERATORS: readonly FilterOperatorDef[] = Object.freeze([
  op("is", "is", "single"),
  op("isAnyOf", "is any of", "multi"),
  op("isEmpty", "is empty", "none"),
  op("isNotEmpty", "is not empty", "none"),
]);

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
export function findOperator(
  operators: readonly FilterOperatorDef[],
  id: string,
): FilterOperatorDef | undefined {
  return operators.find((o) => o.id === id);
}
