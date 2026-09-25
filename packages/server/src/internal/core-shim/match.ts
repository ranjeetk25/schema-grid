/**
 * TEMPORARY minimal port of core's `matchesFilter` + row comparator (core plan
 * Tasks 28–29), used only by the server's capped in-memory formula fallback.
 * TODO(core): replace with @masai/schema-grid-core `matchesFilter` / in-memory evaluator.
 */
import { isEmptyValue } from "./empty";
import { isNegativeOperator } from "./operators";
import { getColumnFieldType } from "./registry";
import { resolveRelativeDate } from "./relative-date";
import type { FieldTypeRegistry, FilterNode, GridRow, GridSchema, RelativeDate, SortSpec } from "./types";

export interface FilterMatchContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  now: Date;
  tz: string;
  userId?: string;
}

const lower = (v: unknown) => String(v).toLowerCase();
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "object" && x !== null ? String((x as { id: unknown }).id) : String(x))) : [];
const scalar = (v: unknown): unknown => (typeof v === "object" && v !== null && "id" in v ? (v as { id: unknown }).id : v);
const toTime = (v: unknown): number => new Date(String(v).length === 10 ? `${v}T00:00:00Z` : String(v)).getTime();

export function matchesFilter(node: FilterNode | null, row: GridRow, ctx: FilterMatchContext): boolean {
  if (!node) return true;
  if ("op" in node) {
    return node.op === "and"
      ? node.children.every((c) => matchesFilter(c, row, ctx))
      : node.children.some((c) => matchesFilter(c, row, ctx));
  }
  const column = ctx.schema.columns.find((c) => c.id === node.columnId);
  if (!column) return false;
  const raw = row.cells[column.key];
  const empty = isEmptyValue(raw);
  if (node.operator === "isEmpty") return empty;
  if (node.operator === "isNotEmpty") return !empty;
  if (empty) return isNegativeOperator(node.operator);
  const v = node.value;
  const val = scalar(raw);
  switch (node.operator) {
    case "is":
    case "eq":
      return Array.isArray(raw) ? ids(raw).includes(String(v)) : lower(val) === lower(v);
    case "isNot":
    case "neq":
      return lower(val) !== lower(v);
    case "contains":
      return lower(val).includes(lower(v));
    case "notContains":
      return !lower(val).includes(lower(v));
    case "startsWith":
      return lower(val).startsWith(lower(v));
    case "lt":
      return Number(val) < Number(v);
    case "lte":
      return Number(val) <= Number(v);
    case "gt":
      return Number(val) > Number(v);
    case "gte":
      return Number(val) >= Number(v);
    case "between": {
      const r = v as { from: unknown; to: unknown };
      return Number(val) >= Number(r.from) && Number(val) <= Number(r.to);
    }
    case "isTrue":
      return val === true;
    case "isFalse":
      return val === false;
    case "isAnyOf":
      return Array.isArray(raw) ? ids(raw).some((x) => (v as unknown[]).map(String).includes(x)) : (v as unknown[]).map(String).includes(String(val));
    case "isNoneOf":
      return !(v as unknown[]).map(String).includes(String(val));
    case "hasAnyOf":
      return ids(raw).some((x) => (v as unknown[]).map(String).includes(x));
    case "hasAllOf":
      return (v as unknown[]).map(String).every((x) => ids(raw).includes(x));
    case "hasNoneOf":
      return !ids(raw).some((x) => (v as unknown[]).map(String).includes(x));
    case "isMe":
      return ctx.userId !== undefined && String(val) === ctx.userId;
    case "isNotMe":
      return ctx.userId === undefined || String(val) !== ctx.userId;
    case "isBefore":
      return toTime(val) < toTime(v);
    case "isAfter":
      return toTime(val) > toTime(v);
    case "isBetween": {
      const r = v as { from: unknown; to: unknown };
      return toTime(val) >= toTime(r.from) && toTime(val) <= toTime(r.to);
    }
    case "isWithin": {
      const range = resolveRelativeDate(v as RelativeDate, ctx.now, ctx.tz);
      if ("error" in range) return false;
      const t = toTime(val);
      return t >= new Date(range.from).getTime() && t < new Date(range.to).getTime();
    }
    default:
      return false;
  }
}

/** Multi-key comparator: field-type compare, empties last in both directions, id tie-break. */
export function compareRows(a: GridRow, b: GridRow, sort: SortSpec[], schema: GridSchema, registry: FieldTypeRegistry): number {
  for (const spec of sort) {
    const column = schema.columns.find((c) => c.id === spec.columnId);
    if (!column) continue;
    const av = a.cells[column.key];
    const bv = b.cells[column.key];
    const ae = isEmptyValue(av);
    const be = isEmptyValue(bv);
    if (ae !== be) return ae ? 1 : -1;
    if (ae && be) continue;
    const ft = getColumnFieldType(column, registry);
    const c = ft ? ft.compare(av, bv, column.config) : String(av).localeCompare(String(bv));
    if (c !== 0) return spec.dir === "desc" ? -c : c;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
