import { getColumnOperators, getColumnValueFieldType } from "../field-types/column-operators";
import { isEmptyValue } from "../field-types/empty";
import type { FieldTypeRegistry } from "../field-types/registry";
import type { GridRow } from "../rows/types";
import { getColumnById } from "../schema/lookup";
import type { ColumnDef, GridSchema } from "../schema/types";
import { addCalendarDays, getZonedParts, zonedToInstant } from "../time/zoned";
import { isNegativeOperator } from "./operators";
import { resolveRelativeDate } from "./relative-date";
import type { FilterCondition, FilterGroup, FilterNode, RelativeDate } from "./types";

export interface FilterMatchContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  now: Date;
  tz: string;
  userId?: string;
}

/** Negative operator → its positive counterpart (negative = !positive on non-empty cells). */
const POSITIVE_OF: Record<string, string> = {
  isNot: "is",
  isNoneOf: "isAnyOf",
  notContains: "contains",
  neq: "eq",
  hasNoneOf: "hasAnyOf",
  isNotMe: "isMe",
};

const TEXT_TYPES = new Set(["text", "longText", "url", "email", "phone"]);
const NUMBER_TYPES = new Set(["number", "currency"]);
const SELECT_TYPES = new Set(["select", "creatableSelect"]);
const DATE_TYPES = new Set(["date", "datetime"]);

/**
 * Reference filter semantics. A null node matches every row. Never throws:
 * unknown columns/operators and evaluation errors do not match.
 */
export function matchesFilter(node: FilterNode | null, row: GridRow, ctx: FilterMatchContext): boolean {
  if (node === null || node === undefined) return true;
  try {
    return matchNode(node, row, ctx);
  } catch {
    return false;
  }
}

function isGroup(node: FilterNode): node is FilterGroup {
  return typeof node === "object" && node !== null && Array.isArray((node as FilterGroup).children);
}

function matchNode(node: FilterNode, row: GridRow, ctx: FilterMatchContext): boolean {
  if (isGroup(node)) {
    if (node.op === "and") return node.children.every((child) => matchNode(child, row, ctx));
    if (node.op === "or") return node.children.some((child) => matchNode(child, row, ctx));
    return false;
  }
  try {
    return matchCondition(node, row, ctx);
  } catch {
    return false;
  }
}

function matchCondition(cond: FilterCondition, row: GridRow, ctx: FilterMatchContext): boolean {
  if (typeof cond !== "object" || cond === null) return false;
  const column = getColumnById(ctx.schema, cond.columnId);
  if (!column) return false;
  const op = cond.operator;
  if (!getColumnOperators(column, ctx.registry).some((def) => def.id === op)) return false;

  const cells = row?.cells ?? {};
  const cell = Object.prototype.hasOwnProperty.call(cells, column.key) ? cells[column.key] : undefined;

  if (op === "isEmpty") return isEmptyValue(cell);
  if (op === "isNotEmpty") return !isEmptyValue(cell);
  const negative = isNegativeOperator(op);
  if (isEmptyValue(cell)) return negative;

  const typeId = valueTypeId(column, ctx);
  if (typeId === undefined) return false;
  if (negative) {
    const positive = POSITIVE_OF[op];
    if (positive === undefined) return false;
    return !matchPositive(typeId, positive, cell, cond.value, ctx);
  }
  return matchPositive(typeId, op, cell, cond.value, ctx);
}

function valueTypeId(column: ColumnDef, ctx: FilterMatchContext): string | undefined {
  return getColumnValueFieldType(column, ctx.registry)?.id;
}

function matchPositive(typeId: string, op: string, cell: unknown, value: unknown, ctx: FilterMatchContext): boolean {
  if (TEXT_TYPES.has(typeId)) return matchText(op, cell, value);
  if (NUMBER_TYPES.has(typeId)) return matchNumber(op, cell, value);
  if (DATE_TYPES.has(typeId)) return matchDate(op, cell, value, ctx);
  if (SELECT_TYPES.has(typeId)) return matchIds(op, [cell], value);
  if (typeId === "multiSelect") return matchMulti(op, cell, value);
  if (typeId === "user") return matchUser(op, cell, value, ctx);
  if (typeId === "link") return matchLink(op, cell, value);
  if (typeId === "boolean") {
    if (op === "isTrue") return cell === true;
    if (op === "isFalse") return cell === false;
    return false;
  }
  return matchCustom(op, cell, value);
}

// ---------------------------------------------------------------- text

function norm(v: unknown): string {
  return String(v).trim().toLowerCase();
}

function matchText(op: string, cell: unknown, value: unknown): boolean {
  if (value === undefined || (typeof value === "object" && value !== null)) return false;
  const c = String(cell).toLowerCase();
  const v = String(value).toLowerCase();
  switch (op) {
    case "contains":
      return c.includes(v);
    case "startsWith":
      return c.startsWith(v);
    case "is":
      return norm(cell) === norm(value);
    default:
      return false;
  }
}

// ---------------------------------------------------------------- number

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return Number.NaN;
}

function matchNumber(op: string, cell: unknown, value: unknown): boolean {
  const c = toNumber(cell);
  if (Number.isNaN(c)) return false;
  if (op === "between") {
    if (!isRange(value)) return false;
    const lo = isEmptyValue(value.from) ? undefined : toNumber(value.from);
    const hi = isEmptyValue(value.to) ? undefined : toNumber(value.to);
    if (lo !== undefined && (Number.isNaN(lo) || c < lo)) return false;
    if (hi !== undefined && (Number.isNaN(hi) || c > hi)) return false;
    return true;
  }
  const v = toNumber(value);
  if (Number.isNaN(v)) return false;
  switch (op) {
    case "eq":
      return c === v;
    case "lt":
      return c < v;
    case "lte":
      return c <= v;
    case "gt":
      return c > v;
    case "gte":
      return c >= v;
    default:
      return false;
  }
}

function isRange(v: unknown): v is { from: unknown; to: unknown } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && ("from" in v || "to" in v);
}

// ---------------------------------------------------------------- id-based (select, user, link)

function asIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined).map((v) => String(v));
  return [];
}

function idOf(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const id = (v as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/** `is`: any of `cellIds` equals the single value; `isAnyOf`: any cell id in values. */
function matchIds(op: string, cellItems: unknown[], value: unknown): boolean {
  const ids = cellItems.map(idOf).filter((id): id is string => id !== undefined);
  if (op === "is") {
    const v = idOf(value);
    return v !== undefined && ids.includes(v);
  }
  if (op === "isAnyOf") {
    const set = new Set(asIdList(value));
    return ids.some((id) => set.has(id));
  }
  return false;
}

function matchMulti(op: string, cell: unknown, value: unknown): boolean {
  if (!Array.isArray(cell)) return false;
  const have = new Set(cell.map(idOf).filter((id): id is string => id !== undefined));
  const want = asIdList(value);
  if (op === "hasAnyOf") return want.some((id) => have.has(id));
  if (op === "hasAllOf") return want.length > 0 && want.every((id) => have.has(id));
  return false;
}

function matchUser(op: string, cell: unknown, value: unknown, ctx: FilterMatchContext): boolean {
  if (op === "isMe") {
    const id = idOf(cell);
    return typeof ctx.userId === "string" && id !== undefined && id === ctx.userId;
  }
  return matchIds(op, [cell], value);
}

function matchLink(op: string, cell: unknown, value: unknown): boolean {
  const refs = Array.isArray(cell) ? cell : [cell];
  return matchIds(op, refs, value);
}

// ---------------------------------------------------------------- custom

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const primitive = (x: unknown) => typeof x === "string" || typeof x === "number" || typeof x === "boolean";
  return primitive(a) && primitive(b) && String(a) === String(b);
}

function matchCustom(op: string, cell: unknown, value: unknown): boolean {
  switch (op) {
    case "is":
    case "eq":
      return looseEq(cell, value);
    case "isAnyOf":
      return Array.isArray(value) && value.some((v) => looseEq(cell, v));
    default:
      return false;
  }
}

// ---------------------------------------------------------------- date / datetime

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface ParsedInstant {
  t: number;
  /** For date-only inputs: the calendar day, so day-granular bounds can be computed. */
  day?: { year: number; month: number; day: number };
}

function parseInstant(v: unknown, tz: string): ParsedInstant | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  const m = DATE_ONLY.exec(s);
  if (m) {
    const day = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    if (day.month < 1 || day.month > 12 || day.day < 1 || day.day > 31) return undefined;
    const t = zonedToInstant(day, tz).getTime();
    return Number.isNaN(t) ? undefined : { t, day };
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : { t };
}

/** First instant strictly after the value's calendar day (date-only) or the instant itself. */
function endOfDayExclusive(p: ParsedInstant, tz: string): number | undefined {
  if (!p.day) return undefined;
  return zonedToInstant(addCalendarDays(p.day, 1), tz).getTime();
}

function sameZonedDay(a: number, b: number, tz: string): boolean {
  const x = getZonedParts(new Date(a), tz);
  const y = getZonedParts(new Date(b), tz);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

function isRelativeDate(v: unknown): v is RelativeDate {
  return typeof v === "object" && v !== null && typeof (v as { relative?: unknown }).relative === "string";
}

function matchDate(op: string, cell: unknown, value: unknown, ctx: FilterMatchContext): boolean {
  const tz = ctx.tz;
  const c = parseInstant(cell, tz);
  if (!c) return false;
  const t = c.t;

  if (op === "isWithin") {
    if (!isRelativeDate(value)) return false;
    const r = resolveRelativeDate(value, ctx.now, tz);
    if ("error" in r) return false;
    const from = Date.parse(r.from);
    const to = Date.parse(r.to);
    return from <= t && t < to;
  }

  if (op === "isBetween") {
    if (!isRange(value)) return false;
    if (!isEmptyValue(value.from)) {
      const lo = parseInstant(value.from, tz);
      if (!lo || t < lo.t) return false;
    }
    if (!isEmptyValue(value.to)) {
      const hi = parseInstant(value.to, tz);
      if (!hi) return false;
      const end = endOfDayExclusive(hi, tz);
      if (end !== undefined ? t >= end : t > hi.t) return false;
    }
    return true;
  }

  const v = parseInstant(value, tz);
  if (!v) return false;
  switch (op) {
    case "is":
      return sameZonedDay(t, v.t, tz);
    case "isBefore":
      return t < v.t;
    case "isAfter": {
      const end = endOfDayExclusive(v, tz);
      return end !== undefined ? t >= end : t > v.t;
    }
    default:
      return false;
  }
}
