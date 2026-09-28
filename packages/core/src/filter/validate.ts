import { getColumnOperators } from "../field-types/column-operators";
import type { FieldTypeRegistry } from "../field-types/registry";
import { getColumnById } from "../schema/lookup";
import type { GridSchema } from "../schema/types";
import { isCellColor } from "../colors/types";
import { type FilterValueKind, findOperator, isColorOperator } from "./operators";
import { RELATIVE_DATE_PRESETS } from "./relative-date";
import type { FilterCondition, FilterGroup, FilterNode, RelativeDateKind } from "./types";

/** A root group is depth 1, a group inside it depth 2; deeper groups are rejected. */
export const MAX_FILTER_DEPTH = 2;

export type FilterValidationErrorCode =
  | "unknownColumn"
  | "unreadableColumn"
  | "unfilterableColumn"
  | "unknownOperator"
  | "depthExceeded"
  | "valueKindMismatch"
  /** v0.4: a color operator inside a color rule's own `when` (see `validateColorRules`). */
  | "colorInRule"
  /** v0.4: a structurally invalid color rule (see `validateColorRules`). */
  | "invalidColorRule";

export interface FilterValidationError {
  code: FilterValidationErrorCode;
  /** Child indices from the root to the offending node ([] = root). */
  path: number[];
  columnId?: string;
  operator?: string;
  message: string;
}

const RELATIVE_KINDS: readonly RelativeDateKind[] = RELATIVE_DATE_PRESETS.map((p) => p.kind);
const N_KINDS: ReadonlySet<RelativeDateKind> = new Set(RELATIVE_DATE_PRESETS.filter((p) => p.needsN).map((p) => p.kind));

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPrimitive(v: unknown): boolean {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v))
  );
}

function isGroup(node: FilterNode): node is FilterGroup {
  return isObject(node) && "children" in node;
}

/** Negative list operators accept `[]`: "none of nothing" matches every row (see match.ts). */
const EMPTY_LIST_OK = new Set(["isNoneOf", "hasNoneOf"]);

/** Returns why `value` doesn't fit `kind`, or null when it does. */
function valueKindProblem(kind: FilterValueKind, value: unknown, operator: string): string | null {
  switch (kind) {
    case "none":
      return value === undefined ? null : "This operator takes no value";
    case "single":
      return value !== null && isPrimitive(value) ? null : "Expected a single value";
    case "multi":
      if (Array.isArray(value) && value.length === 0 && EMPTY_LIST_OK.has(operator)) return null;
      return Array.isArray(value) && value.length > 0 && value.every(isPrimitive)
        ? null
        : "Expected a non-empty list of values";
    case "range":
      return isObject(value) && "from" in value && "to" in value && isPrimitive(value.from) && isPrimitive(value.to)
        ? null
        : "Expected a { from, to } range";
    case "relativeDate": {
      if (!isObject(value) || !RELATIVE_KINDS.includes(value.relative as RelativeDateKind)) {
        return "Expected a relative date";
      }
      if (N_KINDS.has(value.relative as RelativeDateKind)) {
        const n = value.n;
        if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
          return "Expected a positive whole number of days";
        }
      }
      return null;
    }
    case "me":
      return isObject(value) && value.me === true ? null : "Expected { me: true }";
    default:
      return "Unsupported value kind";
  }
}

/** Internal walk options. */
interface WalkOptions {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  readable: ReadonlySet<string>;
  /** false inside a color rule's `when` (no recursion through colors). */
  allowColor: boolean;
}

function colorValueProblem(operator: string, value: unknown): string | null {
  if (operator === "colorIsNone") return value === undefined ? null : "This operator takes no value";
  return Array.isArray(value) && value.length > 0 && value.every(isCellColor)
    ? null
    : "Expected a non-empty list of colors";
}

function validateCondition(
  cond: FilterCondition,
  path: number[],
  opts: WalkOptions,
  errors: FilterValidationError[],
): void {
  const { schema, registry, readable } = opts;
  const { columnId, operator } = cond;
  const column = typeof columnId === "string" ? getColumnById(schema, columnId) : undefined;
  if (!column) {
    errors.push({ code: "unknownColumn", path, columnId, operator, message: "Unknown column" });
    return;
  }
  if (!readable.has(column.id)) {
    // Deliberately generic: never leak a hidden column's label.
    errors.push({
      code: "unreadableColumn",
      path,
      columnId,
      operator,
      message: "You do not have access to this column",
    });
    return;
  }
  // Color operators filter the annotation, not the value: any readable column,
  // `filterable: false` included.
  if (isColorOperator(operator)) {
    if (!opts.allowColor) {
      errors.push({
        code: "colorInRule",
        path,
        columnId,
        operator,
        message: "A color rule's condition cannot test colors",
      });
      return;
    }
    const problem = colorValueProblem(operator, cond.value);
    if (problem) errors.push({ code: "valueKindMismatch", path, columnId, operator, message: problem });
    return;
  }
  if (column.filterable === false) {
    errors.push({
      code: "unfilterableColumn",
      path,
      columnId,
      operator,
      message: `Column "${column.label}" cannot be filtered`,
    });
    return;
  }
  const def = findOperator(getColumnOperators(column, registry), operator);
  if (!def) {
    errors.push({
      code: "unknownOperator",
      path,
      columnId,
      operator,
      message: `Operator "${String(operator)}" is not available for this column`,
    });
    return;
  }
  const problem = valueKindProblem(def.valueKind, cond.value, def.id);
  if (problem) {
    errors.push({ code: "valueKindMismatch", path, columnId, operator, message: problem });
  }
}

function walk(
  node: FilterNode,
  path: number[],
  depth: number,
  opts: WalkOptions,
  errors: FilterValidationError[],
): void {
  if (!isObject(node)) {
    errors.push({ code: "unknownColumn", path, message: "Malformed filter node" });
    return;
  }
  if (isGroup(node)) {
    if (depth > MAX_FILTER_DEPTH) {
      errors.push({
        code: "depthExceeded",
        path,
        message: `Filter groups can be nested at most ${MAX_FILTER_DEPTH} levels deep`,
      });
      return;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child, i) => {
      walk(child, [...path, i], depth + 1, opts, errors);
    });
    return;
  }
  validateCondition(node, path, opts, errors);
}

/**
 * Validates a filter against the schema and the caller's readable columns.
 * Returns every problem found (empty array = valid). A null filter is valid.
 * The color operators (`COLOR_OPERATORS`) are accepted on every readable
 * column, including `filterable: false` ones, with palette color values.
 */
export function validateFilter(
  node: FilterNode | null,
  schema: GridSchema,
  registry: FieldTypeRegistry,
  readableColumnIds: ReadonlySet<string>,
): FilterValidationError[] {
  return collectFilterErrors(node, schema, registry, readableColumnIds, true);
}

/** `validateFilter` with color operators allowed or (in a color rule's `when`) rejected as `colorInRule`. */
export function collectFilterErrors(
  node: FilterNode | null,
  schema: GridSchema,
  registry: FieldTypeRegistry,
  readableColumnIds: ReadonlySet<string>,
  allowColor: boolean,
): FilterValidationError[] {
  if (node === null || node === undefined) return [];
  const errors: FilterValidationError[] = [];
  walk(node, [], 1, { schema, registry, readable: readableColumnIds, allowColor }, errors);
  return errors;
}
