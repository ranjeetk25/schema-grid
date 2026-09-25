/** TEMPORARY copy of core's validateFilter (core plan Task 27). TODO(core) */
import { getColumnOperators } from "./registry";
import type { FieldTypeRegistry, FilterNode, FilterValue, GridSchema } from "./types";

export const MAX_FILTER_DEPTH = 2;
export type FilterValidationErrorCode =
  | "unknownColumn"
  | "unreadableColumn"
  | "unknownOperator"
  | "depthExceeded"
  | "valueKindMismatch";
export interface FilterValidationError {
  code: FilterValidationErrorCode;
  path: number[];
  columnId?: string;
  operator?: string;
  message: string;
}

const isPrimitive = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const RELATIVE = new Set([
  "today",
  "yesterday",
  "tomorrow",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "lastNDays",
  "nextNDays",
]);

function kindMatches(kind: string, filterValue: FilterValue | undefined): boolean {
  const value = filterValue as unknown;
  switch (kind) {
    case "none":
      return value === undefined;
    case "single":
      return value !== undefined && isPrimitive(value);
    case "multi":
      return Array.isArray(value) && value.length > 0 && value.every(isPrimitive);
    case "range":
      return isObj(value) && "from" in value && "to" in value;
    case "relativeDate": {
      if (!isObj(value) || typeof value.relative !== "string" || !RELATIVE.has(value.relative)) return false;
      if (value.relative === "lastNDays" || value.relative === "nextNDays") {
        return typeof value.n === "number" && Number.isInteger(value.n) && value.n > 0;
      }
      return true;
    }
    case "me":
      return isObj(value) && value.me === true;
    default:
      return false;
  }
}

export function validateFilter(
  node: FilterNode | null,
  schema: GridSchema,
  registry: FieldTypeRegistry,
  readableColumnIds: ReadonlySet<string>,
): FilterValidationError[] {
  const errors: FilterValidationError[] = [];
  const byId = new Map(schema.columns.map((c) => [c.id, c]));
  const walk = (n: FilterNode, path: number[], depth: number) => {
    if ("op" in n) {
      if (depth > MAX_FILTER_DEPTH) {
        errors.push({ code: "depthExceeded", path, message: `Filter groups may nest at most ${MAX_FILTER_DEPTH} deep` });
        return;
      }
      n.children.forEach((c, i) => walk(c, [...path, i], depth + 1));
      return;
    }
    const column = byId.get(n.columnId);
    if (!column) {
      errors.push({ code: "unknownColumn", path, columnId: n.columnId, message: "Unknown column" });
      return;
    }
    if (!readableColumnIds.has(column.id)) {
      errors.push({ code: "unreadableColumn", path, columnId: n.columnId, message: "Column is not readable" });
      return;
    }
    const def = getColumnOperators(column, registry).find((o) => o.id === n.operator);
    if (!def) {
      errors.push({ code: "unknownOperator", path, columnId: n.columnId, operator: n.operator, message: "Unknown operator" });
      return;
    }
    if (!kindMatches(def.valueKind, n.value)) {
      errors.push({
        code: "valueKindMismatch",
        path,
        columnId: n.columnId,
        operator: n.operator,
        message: `Operator ${n.operator} expects a ${def.valueKind} value`,
      });
    }
  };
  if (node) walk(node, [], 1);
  return errors;
}
