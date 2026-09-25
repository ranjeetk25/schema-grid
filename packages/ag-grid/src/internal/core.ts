/**
 * The ONLY place `@masai/schema-grid-core` is consumed from.
 *
 * Core is being built concurrently and currently exports only a placeholder,
 * so every spec §4 name this package needs is defined locally below. Each
 * section is marked `TODO(core)`: when core ships the export, delete the
 * section and re-export from `@masai/schema-grid-core` instead.
 *
 * Sections:
 *   1. Schema, rows, changes, query, data source types (§4.1, §4.4–§4.6)
 *   2. Field types + registry (§4.2)
 *   3. Filter AST, validation, relative dates, in-memory matching (§4.3)
 *   4. Sort / search / aggregate (in-memory semantics)
 *   5. Permissions (§4.7)
 *   6. Formula engine (§4.8, minimal)
 *   7. Events (§4.9)
 *   8. IO bridge (import-export package)
 */

export { SCHEMA_GRID_CORE_VERSION } from "@masai/schema-grid-core";

// ============================================================================
// 1. Types — TODO(core): replace with @masai/schema-grid-core export (§4.1, §4.4–§4.6)
// ============================================================================

export type BuiltInFieldTypeId =
  | "text"
  | "longText"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "multiSelect"
  | "creatableSelect"
  | "user"
  | "url"
  | "email"
  | "phone"
  | "link"
  | "formula";

export type FieldTypeId = BuiltInFieldTypeId | (string & {});

export const BUILT_IN_FIELD_TYPE_IDS: readonly BuiltInFieldTypeId[] = [
  "text",
  "longText",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "select",
  "multiSelect",
  "creatableSelect",
  "user",
  "url",
  "email",
  "phone",
  "link",
  "formula",
];

export type RoleRule = "all" | { roles: string[] };

export interface ColumnPermissions {
  read: RoleRule;
  edit: RoleRule;
}

export type Pinned = "left" | "right" | null;

export interface ColumnDef {
  id: string;
  key: string;
  label: string;
  type: FieldTypeId;
  config: unknown;
  required?: boolean;
  defaultValue?: unknown;
  validation?: unknown;
  permissions?: ColumnPermissions;
  width?: number;
  pinned?: Pinned;
  hidden?: boolean;
  order: number;
  indexed?: boolean;
  formula?: string;
  source?: { valueField: string };
  createdAt: string;
  updatedAt: string;
}

export interface ViewColumnState {
  id: string;
  hidden: boolean;
  width?: number;
  pinned: Pinned;
  order: number;
}

export interface SortSpec {
  columnId: string;
  dir: "asc" | "desc";
}

export type AggregationId = "count" | "sum" | "avg" | "min" | "max" | "countEmpty" | "countFilled";

export interface GroupSpec {
  columnId: string;
  aggregations?: { columnId: string; agg: AggregationId }[];
}

export interface ViewDef {
  id: string;
  name: string;
  filter: FilterNode | null;
  sort: SortSpec[];
  search?: string;
  columnState: ViewColumnState[];
  groupBy: GroupSpec[];
  pageSize: number;
}

export interface GridSchema {
  id: string;
  schemaVersion: number;
  columns: ColumnDef[];
  views?: ViewDef[];
}

export interface ActorRef {
  id: string;
  name?: string;
}

export interface GridRow {
  id: string;
  version: number;
  updatedAt: string;
  updatedBy?: ActorRef;
  cells: Record<string, unknown>;
}

export type ChangeSource = "edit" | "paste" | "fill" | "undo" | "redo" | "import";

export interface CellChange {
  rowId: string;
  columnId: string;
  prev: unknown;
  next: unknown;
}

export interface ChangeBatch {
  id: string;
  changes: CellChange[];
  baseVersions: Record<string, number>;
  source: ChangeSource;
}

export interface CellConflict {
  rowId: string;
  columnId: string;
  serverValue: unknown;
  serverVersion: number;
  updatedBy?: ActorRef;
  updatedAt: string;
}

export interface CellError {
  rowId: string;
  columnId: string;
  message: string;
}

export interface ChangeResult {
  applied: CellChange[];
  conflicts: CellConflict[];
  errors: CellError[];
  /**
   * New server version per row that had applied changes.
   * TODO(core): not in spec §4.5 — proposed addition. When absent, the client
   * assumes `baseVersion + 1` per applyChanges call.
   */
  versions?: Record<string, number>;
}

export interface ChangeFeedEntry<Row extends GridRow = GridRow> {
  cursor: string;
  rows: Row[];
  deletedRowIds: string[];
  schemaVersion: number;
}

export type PageRequest = { offset: number; limit: number } | { cursor: string | null; limit: number };

export interface GridQuery {
  filter: FilterNode | null;
  sort: SortSpec[];
  search?: string;
  groupBy?: GroupSpec[];
  page: PageRequest;
  includeTotal?: boolean;
}

/** TODO(core): GroupResult is not named in §4 — assumed shape. */
export interface GroupResult {
  columnId: string;
  key: unknown;
  count: number;
  aggregates: Record<string, unknown>;
}

export interface QueryResult<Row extends GridRow = GridRow> {
  rows: Row[];
  total?: number;
  nextCursor?: string;
  groups?: GroupResult[];
}

export interface Option {
  value: string;
  label: string;
  color?: string;
}

export interface LinkRef {
  id: string;
  label: string;
}

export interface DataSource<Row extends GridRow = GridRow> {
  fetch(query: GridQuery): Promise<QueryResult<Row>>;
  applyChanges(batch: ChangeBatch): Promise<ChangeResult>;
  createRows(partials: Partial<Row>[]): Promise<Row[]>;
  deleteRows(ids: string[]): Promise<void>;
  getChanges?(since: string | null): Promise<ChangeFeedEntry<Row>>;
  getOptions?(columnId: string, search?: string): Promise<Option[]>;
  createOption?(columnId: string, label: string): Promise<Option>;
  lookup?(columnId: string, search: string): Promise<LinkRef[]>;
}

// ============================================================================
// 2. Field types — TODO(core): replace with @masai/schema-grid-core export (§4.2)
// ============================================================================

/** Structural stand-in for a Zod schema so this package needs no zod dependency. */
export interface SchemaLike<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export type ParseResult<T> = { ok: true; value: T | null } | { ok: false; error: string };

export type ValueKind = "none" | "single" | "multi" | "range" | "relativeDate" | "me";

export interface FilterOperatorDef {
  id: string;
  label: string;
  valueKind: ValueKind;
  negative?: boolean;
}

export interface FieldType<TValue = unknown, TConfig = unknown> {
  id: FieldTypeId;
  label: string;
  configSchema: SchemaLike<TConfig>;
  defaultConfig: TConfig;
  valueSchema(config: TConfig): SchemaLike<TValue>;
  parse(input: unknown, config: TConfig): ParseResult<TValue>;
  format(value: TValue | null | undefined, config: TConfig): string;
  serialize(value: TValue | null): unknown;
  deserialize(raw: unknown): TValue | null;
  compare(a: TValue, b: TValue, config: TConfig): number;
  operators: FilterOperatorDef[];
  fillSeries?(values: TValue[], count: number): TValue[];
  aggregations?: AggregationId[];
  defaultValue(config: TConfig): TValue | null;
}

// biome-ignore lint/suspicious/noExplicitAny: registry stores heterogeneous field types; public API is typed via FieldType<unknown, unknown>.
type AnyFieldType = FieldType<any, any>;

export interface FieldTypeRegistry {
  register(type: AnyFieldType): void;
  get(id: FieldTypeId): FieldType<unknown, unknown> | undefined;
  list(): FieldType<unknown, unknown>[];
  has(id: FieldTypeId): boolean;
}

export interface SelectConfig {
  options: Option[];
}
export interface NumberConfig {
  precision?: number;
}
export interface CurrencyConfig {
  currency: string;
  precision?: number;
}
export type FormulaResultType = "number" | "text" | "boolean" | "date";
export interface FormulaConfig {
  resultType: FormulaResultType;
}

export function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

function anySchema<T>(): SchemaLike<T> {
  return { safeParse: (input) => ({ success: true, data: input as T }) };
}

function op(id: string, label: string, valueKind: ValueKind, negative?: boolean): FilterOperatorDef {
  return negative ? { id, label, valueKind, negative: true } : { id, label, valueKind };
}

const EMPTY_OPS = [op("isEmpty", "is empty", "none"), op("isNotEmpty", "is not empty", "none")];

export const TEXT_OPERATORS: FilterOperatorDef[] = [
  op("contains", "contains", "single"),
  op("notContains", "does not contain", "single", true),
  op("startsWith", "starts with", "single"),
  op("is", "is", "single"),
  op("isNot", "is not", "single", true),
  ...EMPTY_OPS,
];
export const NUMBER_OPERATORS: FilterOperatorDef[] = [
  op("eq", "=", "single"),
  op("neq", "≠", "single", true),
  op("lt", "<", "single"),
  op("lte", "≤", "single"),
  op("gt", ">", "single"),
  op("gte", "≥", "single"),
  op("between", "between", "range"),
  ...EMPTY_OPS,
];
export const DATE_OPERATORS: FilterOperatorDef[] = [
  op("is", "is", "single"),
  op("isBefore", "is before", "single"),
  op("isAfter", "is after", "single"),
  op("isBetween", "is between", "range"),
  op("isWithin", "is within", "relativeDate"),
  ...EMPTY_OPS,
];
export const SELECT_OPERATORS: FilterOperatorDef[] = [
  op("is", "is", "single"),
  op("isNot", "is not", "single", true),
  op("isAnyOf", "is any of", "multi"),
  op("isNoneOf", "is none of", "multi", true),
  ...EMPTY_OPS,
];
export const USER_OPERATORS: FilterOperatorDef[] = [
  ...SELECT_OPERATORS,
  op("isMe", "is me", "me"),
  op("isNotMe", "is not me", "me", true),
];
export const MULTI_SELECT_OPERATORS: FilterOperatorDef[] = [
  op("hasAnyOf", "has any of", "multi"),
  op("hasAllOf", "has all of", "multi"),
  op("hasNoneOf", "has none of", "multi", true),
  ...EMPTY_OPS,
];
export const BOOLEAN_OPERATORS: FilterOperatorDef[] = [
  op("isTrue", "is checked", "none"),
  op("isFalse", "is not checked", "none"),
];
export const LINK_OPERATORS: FilterOperatorDef[] = [
  op("is", "is", "single"),
  op("isAnyOf", "is any of", "multi"),
  ...EMPTY_OPS,
];

const NUMERIC_AGGS: AggregationId[] = ["count", "sum", "avg", "min", "max", "countEmpty", "countFilled"];
const BASIC_AGGS: AggregationId[] = ["count", "countEmpty", "countFilled"];

function textLike(id: FieldTypeId, label: string, validate?: (s: string) => boolean): FieldType<string, unknown> {
  return {
    id,
    label,
    configSchema: anySchema(),
    defaultConfig: {},
    valueSchema: () => anySchema<string>(),
    parse(input) {
      if (isEmptyValue(input)) return { ok: true, value: null };
      const s = String(input);
      const trimmed = id === "longText" ? s : s.trim();
      if (validate && !validate(trimmed)) return { ok: false, error: `Invalid ${label.toLowerCase()}` };
      return { ok: true, value: trimmed };
    },
    format: (v) => (v == null ? "" : String(v)),
    serialize: (v) => v,
    deserialize: (raw) => (raw == null ? null : String(raw)),
    compare: (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
    operators: TEXT_OPERATORS,
    aggregations: BASIC_AGGS,
    defaultValue: () => null,
  };
}

function toNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const cleaned = input.trim().replace(/[,\s₹$€£]/g, "");
  if (cleaned === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function linearSeries(values: number[], count: number): number[] {
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const step = values.length > 1 ? (last - first) / (values.length - 1) : 0;
  return Array.from({ length: count }, (_, i) => roundFloat(last + step * (i + 1)));
}

function roundFloat(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}

const numberType: FieldType<number, NumberConfig> = {
  id: "number",
  label: "Number",
  configSchema: anySchema(),
  defaultConfig: {},
  valueSchema: () => anySchema<number>(),
  parse(input) {
    if (isEmptyValue(input)) return { ok: true, value: null };
    const n = toNumber(input);
    return n === null ? { ok: false, error: "Not a number" } : { ok: true, value: n };
  },
  format(v, config) {
    if (v == null) return "";
    return config?.precision != null ? v.toFixed(config.precision) : String(v);
  },
  serialize: (v) => v,
  deserialize: (raw) => toNumber(raw),
  compare: (a, b) => a - b,
  operators: NUMBER_OPERATORS,
  fillSeries: (values, count) => linearSeries(values, count),
  aggregations: NUMERIC_AGGS,
  defaultValue: () => null,
};

const currencyType: FieldType<number, CurrencyConfig> = {
  ...(numberType as unknown as FieldType<number, CurrencyConfig>),
  id: "currency",
  label: "Currency",
  defaultConfig: { currency: "INR", precision: 2 },
  format(v, config) {
    if (v == null) return "";
    return v.toFixed(config?.precision ?? 2);
  },
};

const booleanType: FieldType<boolean, unknown> = {
  id: "boolean",
  label: "Checkbox",
  configSchema: anySchema(),
  defaultConfig: {},
  valueSchema: () => anySchema<boolean>(),
  parse(input) {
    if (typeof input === "boolean") return { ok: true, value: input };
    if (isEmptyValue(input)) return { ok: true, value: null };
    const s = String(input).trim().toLowerCase();
    if (["true", "yes", "y", "1", "checked", "x", "✓"].includes(s)) return { ok: true, value: true };
    if (["false", "no", "n", "0", "unchecked"].includes(s)) return { ok: true, value: false };
    return { ok: false, error: "Not a boolean" };
  },
  format: (v) => (v == null ? "" : v ? "true" : "false"),
  serialize: (v) => v,
  deserialize: (raw) => (raw == null ? null : Boolean(raw)),
  compare: (a, b) => Number(a) - Number(b),
  operators: BOOLEAN_OPERATORS,
  aggregations: BASIC_AGGS,
  defaultValue: () => null,
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_RE = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function isoDateFromParts(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

function parseDateString(s: string): string | null {
  const iso = DATE_RE.exec(s);
  if (iso) return isoDateFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = DMY_RE.exec(s);
  if (dmy) return isoDateFromParts(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function addDaysIso(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return t.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const dateType: FieldType<string, unknown> = {
  id: "date",
  label: "Date",
  configSchema: anySchema(),
  defaultConfig: {},
  valueSchema: () => anySchema<string>(),
  parse(input) {
    if (isEmptyValue(input)) return { ok: true, value: null };
    if (input instanceof Date) return { ok: true, value: input.toISOString().slice(0, 10) };
    const d = parseDateString(String(input).trim());
    return d ? { ok: true, value: d } : { ok: false, error: "Not a date" };
  },
  format: (v) => (v == null ? "" : String(v)),
  serialize: (v) => v,
  deserialize: (raw) => (raw == null ? null : String(raw)),
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  operators: DATE_OPERATORS,
  fillSeries(values, count) {
    const first = values[0];
    const last = values[values.length - 1];
    if (!first || !last) return [];
    const step = values.length > 1 ? Math.round(daysBetween(first, last) / (values.length - 1)) : 0;
    return Array.from({ length: count }, (_, i) => addDaysIso(last, step * (i + 1)));
  },
  aggregations: ["count", "min", "max", "countEmpty", "countFilled"],
  defaultValue: () => null,
};

const datetimeType: FieldType<string, unknown> = {
  ...dateType,
  id: "datetime",
  label: "Date & time",
  parse(input) {
    if (isEmptyValue(input)) return { ok: true, value: null };
    if (input instanceof Date) return { ok: true, value: input.toISOString() };
    const t = Date.parse(String(input).trim());
    return Number.isNaN(t) ? { ok: false, error: "Not a date/time" } : { ok: true, value: new Date(t).toISOString() };
  },
  fillSeries(values, count) {
    const ts = values.map((v) => Date.parse(v));
    const first = ts[0] ?? 0;
    const last = ts[ts.length - 1] ?? 0;
    const step = ts.length > 1 ? (last - first) / (ts.length - 1) : 0;
    return Array.from({ length: count }, (_, i) => new Date(last + step * (i + 1)).toISOString());
  },
};

function optionOf(config: SelectConfig | undefined, value: string): Option | undefined {
  return config?.options?.find((o) => o.value === value);
}

function matchOption(config: SelectConfig | undefined, input: string): Option | undefined {
  const needle = input.trim().toLowerCase();
  return config?.options?.find((o) => o.value.toLowerCase() === needle || o.label.toLowerCase() === needle);
}

function selectLike(id: FieldTypeId, label: string, creatable: boolean): FieldType<string, SelectConfig> {
  return {
    id,
    label,
    configSchema: anySchema(),
    defaultConfig: { options: [] },
    valueSchema: () => anySchema<string>(),
    parse(input, config) {
      if (isEmptyValue(input)) return { ok: true, value: null };
      const s = String(input).trim();
      const match = matchOption(config, s);
      if (match) return { ok: true, value: match.value };
      if (creatable) return { ok: true, value: s };
      return { ok: false, error: `Unknown option "${s}"` };
    },
    format: (v, config) => (v == null ? "" : (optionOf(config, v)?.label ?? String(v))),
    serialize: (v) => v,
    deserialize: (raw) => (raw == null ? null : String(raw)),
    compare(a, b, config) {
      const opts = config?.options ?? [];
      const ia = opts.findIndex((o) => o.value === a);
      const ib = opts.findIndex((o) => o.value === b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      return a.localeCompare(b);
    },
    operators: SELECT_OPERATORS,
    aggregations: BASIC_AGGS,
    defaultValue: () => null,
  };
}

const multiSelectType: FieldType<string[], SelectConfig> = {
  id: "multiSelect",
  label: "Multi select",
  configSchema: anySchema(),
  defaultConfig: { options: [] },
  valueSchema: () => anySchema<string[]>(),
  parse(input, config) {
    if (isEmptyValue(input)) return { ok: true, value: null };
    const parts = Array.isArray(input)
      ? input.map(String)
      : String(input)
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
    const out: string[] = [];
    for (const p of parts) {
      const match = matchOption(config, p);
      if (!match) return { ok: false, error: `Unknown option "${p}"` };
      out.push(match.value);
    }
    return { ok: true, value: out };
  },
  format: (v, config) => (v == null ? "" : v.map((x) => optionOf(config, x)?.label ?? x).join(", ")),
  serialize: (v) => v,
  deserialize: (raw) => (Array.isArray(raw) ? raw.map(String) : null),
  compare: (a, b) => a.join(",").localeCompare(b.join(",")),
  operators: MULTI_SELECT_OPERATORS,
  aggregations: BASIC_AGGS,
  defaultValue: () => null,
};

const userType: FieldType<string, SelectConfig> = {
  ...selectLike("user", "User", true),
  operators: USER_OPERATORS,
};

function toLinkRef(raw: unknown): LinkRef | null {
  if (raw && typeof raw === "object" && "id" in raw) {
    const r = raw as { id: unknown; label?: unknown };
    return { id: String(r.id), label: String(r.label ?? r.id) };
  }
  return null;
}

const linkType: FieldType<LinkRef, unknown> = {
  id: "link",
  label: "Link",
  configSchema: anySchema(),
  defaultConfig: {},
  valueSchema: () => anySchema<LinkRef>(),
  parse(input) {
    if (isEmptyValue(input)) return { ok: true, value: null };
    const ref = toLinkRef(input);
    return ref ? { ok: true, value: ref } : { ok: false, error: "Links can't be pasted as text" };
  },
  format: (v) => (v == null ? "" : v.label),
  serialize: (v) => v,
  deserialize: (raw) => toLinkRef(raw),
  compare: (a, b) => a.label.localeCompare(b.label),
  operators: LINK_OPERATORS,
  aggregations: BASIC_AGGS,
  defaultValue: () => null,
};

const formulaType: FieldType<unknown, FormulaConfig> = {
  id: "formula",
  label: "Formula",
  configSchema: anySchema(),
  defaultConfig: { resultType: "text" },
  valueSchema: () => anySchema<unknown>(),
  parse: () => ({ ok: false, error: "Formula columns are read-only" }),
  format(v, config) {
    if (v == null) return "";
    if (v instanceof FormulaError) return "#ERROR";
    const inner = FORMULA_RESULT_TYPES[config?.resultType ?? "text"];
    return inner.format(v as never, inner.defaultConfig as never);
  },
  serialize: (v) => v,
  deserialize: (raw) => raw,
  compare(a, b, config) {
    const inner = FORMULA_RESULT_TYPES[config?.resultType ?? "text"];
    return inner.compare(a as never, b as never, inner.defaultConfig as never);
  },
  // Operators depend on config.resultType — use operatorsFor(fieldType, column).
  operators: TEXT_OPERATORS,
  aggregations: NUMERIC_AGGS,
  defaultValue: () => null,
};

const FORMULA_RESULT_TYPES: Record<FormulaResultType, FieldType<unknown, unknown>> = {
  number: numberType as unknown as FieldType<unknown, unknown>,
  text: textLike("text", "Text") as unknown as FieldType<unknown, unknown>,
  boolean: booleanType as unknown as FieldType<unknown, unknown>,
  date: dateType as unknown as FieldType<unknown, unknown>,
};

/** Operators for a column; formula columns use their result type's operators. */
export function operatorsFor(fieldType: FieldType<unknown, unknown>, column: ColumnDef): FilterOperatorDef[] {
  if (column.type === "formula") {
    const rt = (column.config as FormulaConfig | undefined)?.resultType ?? "text";
    return FORMULA_RESULT_TYPES[rt].operators;
  }
  return fieldType.operators;
}

/** Field type that governs filter semantics (formula → its result type). */
export function effectiveFieldType(registry: FieldTypeRegistry, column: ColumnDef): FieldType<unknown, unknown> | undefined {
  if (column.type === "formula") {
    const rt = (column.config as FormulaConfig | undefined)?.resultType ?? "text";
    return FORMULA_RESULT_TYPES[rt];
  }
  return registry.get(column.type);
}

export function createFieldTypeRegistry(types: AnyFieldType[] = []): FieldTypeRegistry {
  const map = new Map<string, FieldType<unknown, unknown>>();
  const registry: FieldTypeRegistry = {
    register(type) {
      map.set(type.id, type as FieldType<unknown, unknown>);
    },
    get: (id) => map.get(id),
    list: () => [...map.values()],
    has: (id) => map.has(id),
  };
  for (const t of types) registry.register(t);
  return registry;
}

export function createDefaultRegistry(): FieldTypeRegistry {
  return createFieldTypeRegistry([
    textLike("text", "Text"),
    textLike("longText", "Long text"),
    numberType,
    currencyType,
    booleanType,
    dateType,
    datetimeType,
    selectLike("select", "Single select", false),
    multiSelectType,
    selectLike("creatableSelect", "Creatable select", true),
    userType,
    textLike("url", "URL", (s) => /^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(s)),
    textLike("email", "Email", (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)),
    textLike("phone", "Phone", (s) => /^[+\d][\d\s()-]{3,}$/.test(s)),
    linkType,
    formulaType,
  ]);
}

// ============================================================================
// 3. Filter AST — TODO(core): replace with @masai/schema-grid-core export (§4.3)
// ============================================================================

export type RelativeDateKind =
  | "today"
  | "yesterday"
  | "tomorrow"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "lastNDays"
  | "nextNDays";

export interface RelativeDate {
  relative: RelativeDateKind;
  n?: number;
}

export type FilterPrimitive = string | number | boolean | null;

export type FilterValue =
  | FilterPrimitive
  | FilterPrimitive[]
  | { from: FilterPrimitive; to: FilterPrimitive }
  | RelativeDate
  | { me: true };

export interface FilterCondition {
  columnId: string;
  operator: string;
  value?: FilterValue;
}

export interface FilterGroup {
  op: "and" | "or";
  children: FilterNode[];
}

export type FilterNode = FilterGroup | FilterCondition;

export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return "op" in node && Array.isArray((node as FilterGroup).children);
}

export const MAX_FILTER_DEPTH = 2;

export type FilterValidationCode =
  | "unknownColumn"
  | "unreadableColumn"
  | "unknownOperator"
  | "depthExceeded"
  | "valueKindMismatch";

export interface FilterValidationError {
  code: FilterValidationCode;
  message: string;
  columnId?: string;
  path: number[];
}

/**
 * TODO(core): minimal — checks depth, unknown column, unreadable column and
 * unknown operator. Value-kind checks are left to core.
 */
export function validateFilter(
  node: FilterNode | null,
  schema: GridSchema,
  registry: FieldTypeRegistry,
  readableColumnIds: ReadonlySet<string> | readonly string[],
): FilterValidationError[] {
  const errors: FilterValidationError[] = [];
  if (!node) return errors;
  const readable = readableColumnIds instanceof Set ? readableColumnIds : new Set(readableColumnIds as readonly string[]);
  const byId = new Map(schema.columns.map((c) => [c.id, c]));
  const visit = (n: FilterNode, depth: number, path: number[]) => {
    if (isFilterGroup(n)) {
      if (depth > MAX_FILTER_DEPTH) {
        errors.push({ code: "depthExceeded", message: `Filter nesting exceeds depth ${MAX_FILTER_DEPTH}`, path });
        return;
      }
      n.children.forEach((c, i) => visit(c, depth + 1, [...path, i]));
      return;
    }
    const column = byId.get(n.columnId);
    if (!column) {
      errors.push({ code: "unknownColumn", message: `Unknown column "${n.columnId}"`, columnId: n.columnId, path });
      return;
    }
    if (!readable.has(column.id)) {
      errors.push({
        code: "unreadableColumn",
        message: `Column "${column.label}" is not readable`,
        columnId: column.id,
        path,
      });
      return;
    }
    const ft = registry.get(column.type);
    if (ft && !operatorsFor(ft, column).some((o) => o.id === n.operator)) {
      errors.push({
        code: "unknownOperator",
        message: `Operator "${n.operator}" is not valid for ${column.label}`,
        columnId: column.id,
        path,
      });
    }
  };
  visit(node, 1, []);
  return errors;
}

// --- Relative dates -----------------------------------------------------------

export const DEFAULT_TZ = "Asia/Kolkata";

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Monday … 6 = Sunday */
  weekdayMon0: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(date: Date, tz: string): ZonedParts {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(tz, fmt);
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekdayMon0: WEEKDAYS.indexOf(parts.weekday ?? "Mon"),
  };
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const p = zonedParts(new Date(utcMs), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** UTC instant of local midnight for (y, m, d) in tz; handles day overflow. */
export function zonedMidnightUtc(year: number, month: number, day: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  let result = guess - tzOffsetMs(guess, tz);
  result = guess - tzOffsetMs(result, tz);
  return new Date(result);
}

/** Local calendar date (YYYY-MM-DD) of an instant in tz. */
export function zonedDateString(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Resolve a relative date to a half-open `[from, to)` UTC ISO range in `tz`.
 * Weeks start Monday. `lastNDays` includes today (n days ending today);
 * `nextNDays` includes today (n days starting today).
 * TODO(core): replace with @masai/schema-grid-core export (§4.3)
 */
export function resolveRelativeDate(rd: RelativeDate, now: Date, tz: string = DEFAULT_TZ): { from: string; to: string } {
  const p = zonedParts(now, tz);
  const day = (offset: number) => zonedMidnightUtc(p.year, p.month, p.day + offset, tz).toISOString();
  const n = Math.max(1, Math.floor(rd.n ?? 1));
  switch (rd.relative) {
    case "today":
      return { from: day(0), to: day(1) };
    case "yesterday":
      return { from: day(-1), to: day(0) };
    case "tomorrow":
      return { from: day(1), to: day(2) };
    case "thisWeek":
      return { from: day(-p.weekdayMon0), to: day(7 - p.weekdayMon0) };
    case "lastWeek":
      return { from: day(-p.weekdayMon0 - 7), to: day(-p.weekdayMon0) };
    case "thisMonth":
      return {
        from: zonedMidnightUtc(p.year, p.month, 1, tz).toISOString(),
        to: zonedMidnightUtc(p.year, p.month + 1, 1, tz).toISOString(),
      };
    case "lastMonth":
      return {
        from: zonedMidnightUtc(p.year, p.month - 1, 1, tz).toISOString(),
        to: zonedMidnightUtc(p.year, p.month, 1, tz).toISOString(),
      };
    case "lastNDays":
      return { from: day(-(n - 1)), to: day(1) };
    case "nextNDays":
      return { from: day(0), to: day(n) };
  }
}

// --- In-memory matching -------------------------------------------------------

export interface MatchContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  user?: { id: string };
  now?: Date;
  tz?: string;
  /** Override cell reads (e.g. to supply computed formula values). */
  getCellValue?(row: GridRow, column: ColumnDef): unknown;
}

export function readCell(row: GridRow, column: ColumnDef, ctx?: Pick<MatchContext, "getCellValue">): unknown {
  return ctx?.getCellValue ? ctx.getCellValue(row, column) : row.cells[column.key];
}

function asArray(value: FilterValue | undefined): FilterPrimitive[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || typeof value === "object") return [];
  return [value];
}

function isRange(value: FilterValue | undefined): value is { from: FilterPrimitive; to: FilterPrimitive } {
  return !!value && typeof value === "object" && !Array.isArray(value) && "from" in value && "to" in value;
}

function isRelative(value: FilterValue | undefined): value is RelativeDate {
  return !!value && typeof value === "object" && !Array.isArray(value) && "relative" in value;
}

function lower(v: unknown): string {
  return String(v ?? "").toLowerCase();
}

function numericCompare(cell: unknown, operator: string, value: FilterValue | undefined): boolean {
  const n = toNumber(cell);
  if (n === null) return operator === "neq";
  if (operator === "between") {
    if (!isRange(value)) return false;
    const from = toNumber(value.from);
    const to = toNumber(value.to);
    return (from === null || n >= from) && (to === null || n <= to);
  }
  const target = toNumber(value as FilterPrimitive);
  if (target === null) return false;
  switch (operator) {
    case "eq":
      return n === target;
    case "neq":
      return n !== target;
    case "lt":
      return n < target;
    case "lte":
      return n <= target;
    case "gt":
      return n > target;
    case "gte":
      return n >= target;
  }
  return false;
}

/** Normalize a date/datetime cell to an instant (ms) for range checks. */
function cellInstant(cell: unknown, type: FieldTypeId, tz: string): number | null {
  const s = String(cell);
  if (type === "date" || DATE_RE.test(s)) {
    const m = DATE_RE.exec(s);
    if (!m) return null;
    return zonedMidnightUtc(Number(m[1]), Number(m[2]), Number(m[3]), tz).getTime();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Date filter values are `YYYY-MM-DD` (or ISO); compare as local calendar days. */
function cellDay(cell: unknown, type: FieldTypeId, tz: string): string | null {
  const s = String(cell);
  if (DATE_RE.test(s)) return s;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return type === "date" ? s.slice(0, 10) : zonedDateString(new Date(t), tz);
}

function valueDay(v: FilterPrimitive): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  return DATE_RE.test(s) ? s : parseDateString(s);
}

function dateCompare(cell: unknown, type: FieldTypeId, operator: string, value: FilterValue | undefined, ctx: MatchContext): boolean {
  const tz = ctx.tz ?? DEFAULT_TZ;
  if (operator === "isWithin") {
    if (!isRelative(value)) return false;
    const range = resolveRelativeDate(value, ctx.now ?? new Date(), tz);
    const t = cellInstant(cell, type, tz);
    return t !== null && t >= Date.parse(range.from) && t < Date.parse(range.to);
  }
  const day = cellDay(cell, type, tz);
  if (day === null) return false;
  if (operator === "isBetween") {
    if (!isRange(value)) return false;
    const from = valueDay(value.from);
    const to = valueDay(value.to);
    return (from === null || day >= from) && (to === null || day <= to);
  }
  const target = valueDay(value as FilterPrimitive);
  if (target === null) return false;
  if (operator === "is") return day === target;
  if (operator === "isBefore") return day < target;
  if (operator === "isAfter") return day > target;
  return false;
}

function matchCondition(row: GridRow, cond: FilterCondition, ctx: MatchContext): boolean {
  const column = ctx.schema.columns.find((c) => c.id === cond.columnId);
  if (!column) return false;
  const fieldType = effectiveFieldType(ctx.registry, column);
  if (!fieldType) return false;
  const operators = operatorsFor(fieldType, column);
  const opDef = operators.find((o) => o.id === cond.operator);
  if (!opDef) return false;

  const cell = readCell(row, column, ctx);
  const empty = isEmptyValue(cell);
  if (cond.operator === "isEmpty") return empty;
  if (cond.operator === "isNotEmpty") return !empty;
  if (empty) return opDef.negative === true;

  const kind = fieldType.id;
  const { operator, value } = cond;

  if (kind === "boolean") {
    if (operator === "isTrue") return cell === true;
    if (operator === "isFalse") return cell === false;
    return false;
  }
  if (kind === "number" || kind === "currency") return numericCompare(cell, operator, value);
  if (kind === "date" || kind === "datetime") return dateCompare(cell, kind, operator, value, ctx);
  if (kind === "multiSelect") {
    const cellValues = (Array.isArray(cell) ? cell : [cell]).map(String);
    const wanted = asArray(value).map(String);
    if (operator === "hasAnyOf") return wanted.some((w) => cellValues.includes(w));
    if (operator === "hasAllOf") return wanted.length > 0 && wanted.every((w) => cellValues.includes(w));
    if (operator === "hasNoneOf") return !wanted.some((w) => cellValues.includes(w));
    return false;
  }
  if (kind === "link") {
    const id = toLinkRef(cell)?.id ?? String(cell);
    if (operator === "is") return id === String(value);
    if (operator === "isAnyOf") return asArray(value).map(String).includes(id);
    return false;
  }
  if (kind === "select" || kind === "creatableSelect" || kind === "user") {
    const s = String(cell);
    const me = ctx.user?.id;
    switch (operator) {
      case "is":
        return s === String(value);
      case "isNot":
        return s !== String(value);
      case "isAnyOf":
        return asArray(value).map(String).includes(s);
      case "isNoneOf":
        return !asArray(value).map(String).includes(s);
      case "isMe":
        return me !== undefined && s === me;
      case "isNotMe":
        return me === undefined || s !== me;
    }
    return false;
  }
  // text-like
  const hay = lower(cell);
  const needle = lower(value);
  switch (operator) {
    case "contains":
      return hay.includes(needle);
    case "notContains":
      return !hay.includes(needle);
    case "startsWith":
      return hay.startsWith(needle);
    case "is":
      return hay.trim() === needle.trim();
    case "isNot":
      return hay.trim() !== needle.trim();
  }
  return false;
}

/** TODO(core): in-memory filter semantics (§4.3 incl. null semantics). */
export function matchesFilter(row: GridRow, node: FilterNode | null, ctx: MatchContext): boolean {
  if (!node) return true;
  if (isFilterGroup(node)) {
    if (node.children.length === 0) return true;
    return node.op === "and"
      ? node.children.every((c) => matchesFilter(row, c, ctx))
      : node.children.some((c) => matchesFilter(row, c, ctx));
  }
  return matchCondition(row, node, ctx);
}

// ============================================================================
// 4. Sort / search / aggregate — TODO(core): replace with @masai/schema-grid-core export
// ============================================================================

export interface SortContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  getCellValue?(row: GridRow, column: ColumnDef): unknown;
}

/** Compare two cell values; empties sort LAST in both directions. */
export function compareCells(
  a: unknown,
  b: unknown,
  column: ColumnDef,
  registry: FieldTypeRegistry,
  dir: "asc" | "desc" = "asc",
): number {
  const ea = isEmptyValue(a);
  const eb = isEmptyValue(b);
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  const ft = registry.get(column.type);
  const raw = ft ? ft.compare(a, b, column.config ?? ft.defaultConfig) : String(a).localeCompare(String(b));
  return dir === "desc" ? -raw : raw;
}

/** Stable multi-key sort, nulls last in both directions. */
export function sortRows<Row extends GridRow>(rows: readonly Row[], sort: readonly SortSpec[], ctx: SortContext): Row[] {
  const specs = sort
    .map((s) => ({ spec: s, column: ctx.schema.columns.find((c) => c.id === s.columnId) }))
    .filter((x): x is { spec: SortSpec; column: ColumnDef } => !!x.column);
  if (specs.length === 0) return [...rows];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      for (const { spec, column } of specs) {
        const c = compareCells(readCell(x.row, column, ctx), readCell(y.row, column, ctx), column, ctx.registry, spec.dir);
        if (c !== 0) return c;
      }
      return x.index - y.index;
    })
    .map((x) => x.row);
}

/** Case-insensitive search across formatted values of the given (readable) columns. */
export function searchRows<Row extends GridRow>(
  rows: readonly Row[],
  search: string | undefined,
  ctx: SortContext & { readableColumnIds?: ReadonlySet<string> },
): Row[] {
  const needle = (search ?? "").trim().toLowerCase();
  if (!needle) return [...rows];
  const cols = ctx.schema.columns.filter((c) => !ctx.readableColumnIds || ctx.readableColumnIds.has(c.id));
  return rows.filter((row) =>
    cols.some((col) => {
      const ft = ctx.registry.get(col.type);
      const v = readCell(row, col, ctx);
      const text = ft ? ft.format(v, col.config ?? ft.defaultConfig) : String(v ?? "");
      return text.toLowerCase().includes(needle);
    }),
  );
}

/** TODO(core): aggregate a column's values (§4.4 AggregationId). */
export function computeAggregate(values: readonly unknown[], agg: AggregationId): number | string | null {
  const filled = values.filter((v) => !isEmptyValue(v));
  switch (agg) {
    case "count":
      return values.length;
    case "countEmpty":
      return values.length - filled.length;
    case "countFilled":
      return filled.length;
  }
  const nums = filled.map(toNumber).filter((n): n is number => n !== null);
  if (agg === "min" || agg === "max") {
    if (nums.length === filled.length && nums.length > 0) return agg === "min" ? Math.min(...nums) : Math.max(...nums);
    const strs = filled.map(String).sort();
    return (agg === "min" ? strs[0] : strs[strs.length - 1]) ?? null;
  }
  if (nums.length === 0) return agg === "sum" ? 0 : null;
  const sum = roundFloat(nums.reduce((s, n) => s + n, 0));
  return agg === "sum" ? sum : roundFloat(sum / nums.length);
}

/** Alias for the plan's name. */
export const aggregate = computeAggregate;

// ============================================================================
// 5. Permissions — TODO(core): replace with @masai/schema-grid-core export (§4.7)
// ============================================================================

export type Access = "hidden" | "read" | "edit";

export interface GridUser {
  id: string;
  roles: string[];
}

export interface PermissionContext<Row extends GridRow = GridRow> {
  user: GridUser;
  column: ColumnDef;
  row?: Row;
}

export type PermissionResolver<Row extends GridRow = GridRow> = (ctx: PermissionContext<Row>) => Access;

function ruleAllows(rule: RoleRule | undefined, user: GridUser): boolean {
  if (!rule || rule === "all") return true;
  return rule.roles.some((r) => user.roles.includes(r));
}

export function createRolePermissionResolver<Row extends GridRow = GridRow>(): PermissionResolver<Row> {
  return ({ user, column }) => {
    const perms = column.permissions;
    if (!ruleAllows(perms?.read, user)) return "hidden";
    if (column.type === "formula") return "read";
    return ruleAllows(perms?.edit, user) ? "edit" : "read";
  };
}

export function resolveColumnAccess<Row extends GridRow = GridRow>(
  schema: GridSchema,
  resolver: PermissionResolver<Row>,
  user: GridUser,
): Map<string, Access> {
  const out = new Map<string, Access>();
  for (const column of schema.columns) out.set(column.id, resolver({ user, column }));
  return out;
}

// ============================================================================
// 6. Formula engine (minimal) — TODO(core): replace with @masai/schema-grid-core export (§4.8)
//    Supports: numbers, strings, booleans, {ref}, + - * / %, comparisons,
//    && || !, parentheses, IF / IS_EMPTY / AND / OR / NOT / SUM / AVG / MIN /
//    MAX / ROUND / ABS / CONCAT / UPPER / LOWER / TRIM / LEN / COALESCE.
// ============================================================================

export class FormulaError extends Error {
  constructor(
    message: string,
    public readonly position?: number,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}

export type FormulaAst =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "ref"; key: string }
  | { kind: "unary"; op: "-" | "!"; arg: FormulaAst }
  | { kind: "binary"; op: string; left: FormulaAst; right: FormulaAst }
  | { kind: "call"; name: string; args: FormulaAst[] };

export function isFormulaError(x: unknown): x is FormulaError {
  return x instanceof FormulaError;
}

type Tok =
  | { t: "num"; v: number; p: number }
  | { t: "str"; v: string; p: number }
  | { t: "ref"; v: string; p: number }
  | { t: "id"; v: string; p: number }
  | { t: "op"; v: string; p: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(e[-+]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new FormulaError(`Bad number at ${i}`, i);
      out.push({ t: "num", v: Number(m[0]), p: i });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new FormulaError("Unterminated string", i);
      out.push({ t: "str", v: s, p: i });
      i = j + 1;
      continue;
    }
    if (ch === "{") {
      const j = src.indexOf("}", i);
      if (j < 0) throw new FormulaError("Unterminated reference", i);
      out.push({ t: "ref", v: src.slice(i + 1, j).trim(), p: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      const v = m?.[0] ?? ch;
      out.push({ t: "id", v, p: i });
      i += v.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["&&", "||", "==", "!=", "<=", ">=", "<>"].includes(two)) {
      out.push({ t: "op", v: two, p: i });
      i += 2;
      continue;
    }
    if ("+-*/%()<>=!,&".includes(ch)) {
      out.push({ t: "op", v: ch, p: i });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected "${ch}"`, i);
  }
  return out;
}

const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "=": 3,
  "==": 3,
  "!=": 3,
  "<>": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "&": 5,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

export function parseFormula(src: string): FormulaAst | FormulaError {
  try {
    const toks = tokenize(src);
    let pos = 0;
    const peek = () => toks[pos];
    const expectOp = (v: string) => {
      const t = toks[pos];
      if (!t || t.t !== "op" || t.v !== v) throw new FormulaError(`Expected "${v}"`, t?.p ?? src.length);
      pos++;
    };
    const primary = (): FormulaAst => {
      const t = toks[pos++];
      if (!t) throw new FormulaError("Unexpected end of formula", src.length);
      if (t.t === "num") return { kind: "number", value: t.v };
      if (t.t === "str") return { kind: "string", value: t.v };
      if (t.t === "ref") return { kind: "ref", key: t.v };
      if (t.t === "id") {
        const upper = t.v.toUpperCase();
        const next = peek();
        if (next && next.t === "op" && next.v === "(") {
          pos++;
          const args: FormulaAst[] = [];
          const close = peek();
          if (!(close && close.t === "op" && close.v === ")")) {
            args.push(expr(0));
            while (peek()?.t === "op" && peek()?.v === ",") {
              pos++;
              args.push(expr(0));
            }
          }
          expectOp(")");
          return { kind: "call", name: upper, args };
        }
        if (upper === "TRUE") return { kind: "boolean", value: true };
        if (upper === "FALSE") return { kind: "boolean", value: false };
        throw new FormulaError(`Unknown identifier "${t.v}"`, t.p);
      }
      if (t.v === "(") {
        const e = expr(0);
        expectOp(")");
        return e;
      }
      if (t.v === "-" || t.v === "!") return { kind: "unary", op: t.v, arg: expr(7) };
      if (t.v === "+") return expr(7);
      throw new FormulaError(`Unexpected "${t.v}"`, t.p);
    };
    const expr = (minPrec: number): FormulaAst => {
      let left = primary();
      for (;;) {
        const t = peek();
        if (!t || t.t !== "op") break;
        const prec = BINARY_PRECEDENCE[t.v];
        if (prec === undefined || prec <= minPrec) break;
        pos++;
        const right = expr(prec);
        left = { kind: "binary", op: t.v, left, right };
      }
      return left;
    };
    if (toks.length === 0) throw new FormulaError("Empty formula", 0);
    const ast = expr(0);
    if (pos < toks.length) throw new FormulaError(`Unexpected "${toks[pos]?.v}"`, toks[pos]?.p);
    return ast;
  } catch (e) {
    return e instanceof FormulaError ? e : new FormulaError(String(e));
  }
}

export function dependencies(ast: FormulaAst): string[] {
  const out = new Set<string>();
  const walk = (n: FormulaAst) => {
    if (n.kind === "ref") out.add(n.key);
    else if (n.kind === "unary") walk(n.arg);
    else if (n.kind === "binary") {
      walk(n.left);
      walk(n.right);
    } else if (n.kind === "call") n.args.forEach(walk);
  };
  walk(ast);
  return [...out];
}

export function inferResultType(ast: FormulaAst, schema: GridSchema): FormulaResultType {
  switch (ast.kind) {
    case "number":
      return "number";
    case "string":
      return "text";
    case "boolean":
      return "boolean";
    case "ref": {
      const col = schema.columns.find((c) => c.key === ast.key);
      if (!col) return "text";
      if (col.type === "number" || col.type === "currency") return "number";
      if (col.type === "boolean") return "boolean";
      if (col.type === "date" || col.type === "datetime") return "date";
      if (col.type === "formula") return (col.config as FormulaConfig | undefined)?.resultType ?? "text";
      return "text";
    }
    case "unary":
      return ast.op === "!" ? "boolean" : "number";
    case "binary":
      if (["&&", "||", "=", "==", "!=", "<>", "<", "<=", ">", ">="].includes(ast.op)) return "boolean";
      if (ast.op === "&") return "text";
      if (ast.op === "+") {
        const l = inferResultType(ast.left, schema);
        const r = inferResultType(ast.right, schema);
        return l === "text" || r === "text" ? "text" : "number";
      }
      return "number";
    case "call":
      if (["AND", "OR", "NOT", "IS_EMPTY"].includes(ast.name)) return "boolean";
      if (["CONCAT", "UPPER", "LOWER", "TRIM", "LEFT", "RIGHT"].includes(ast.name)) return "text";
      if (ast.name === "IF" && ast.args[1]) return inferResultType(ast.args[1], schema);
      if (ast.name === "COALESCE" && ast.args[0]) return inferResultType(ast.args[0], schema);
      return "number";
  }
}

export interface FormulaEnv {
  now: Date;
  tz: string;
}

function truthy(v: unknown): boolean {
  if (isEmptyValue(v)) return false;
  return Boolean(v);
}

function num(v: unknown): number {
  if (isEmptyValue(v)) return 0;
  const n = toNumber(v);
  if (n === null) throw new FormulaError(`"${String(v)}" is not a number`);
  return n;
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  if (typeof a === "number" || typeof b === "number") {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na !== null && nb !== null) return na === nb;
  }
  return String(a ?? "") === String(b ?? "");
}

/**
 * Evaluate a parsed formula against a row. Throws FormulaError on runtime
 * errors. Formula-typed refs are evaluated recursively (cycle-guarded).
 */
export function evaluate(ast: FormulaAst, row: GridRow, schema: GridSchema, env: FormulaEnv, _stack: string[] = []): unknown {
  const ev = (n: FormulaAst): unknown => evaluate(n, row, schema, env, _stack);
  switch (ast.kind) {
    case "number":
    case "string":
    case "boolean":
      return ast.value;
    case "ref": {
      const col = schema.columns.find((c) => c.key === ast.key);
      if (!col) throw new FormulaError(`Unknown column {${ast.key}}`);
      if (col.type === "formula") {
        if (_stack.includes(col.key)) throw new FormulaError(`Circular reference via {${col.key}}`);
        const inner = parseFormula(col.formula ?? "");
        if (isFormulaError(inner)) throw inner;
        return evaluate(inner, row, schema, env, [..._stack, col.key]);
      }
      return row.cells[col.key] ?? null;
    }
    case "unary":
      return ast.op === "!" ? !truthy(ev(ast.arg)) : -num(ev(ast.arg));
    case "binary": {
      if (ast.op === "&&") return truthy(ev(ast.left)) && truthy(ev(ast.right));
      if (ast.op === "||") return truthy(ev(ast.left)) || truthy(ev(ast.right));
      const l = ev(ast.left);
      const r = ev(ast.right);
      switch (ast.op) {
        case "+":
          if (typeof l === "string" || typeof r === "string") {
            const ln = toNumber(l);
            const rn = toNumber(r);
            if (ln === null || rn === null) return `${l ?? ""}${r ?? ""}`;
            return roundFloat(ln + rn);
          }
          return roundFloat(num(l) + num(r));
        case "&":
          return `${l ?? ""}${r ?? ""}`;
        case "-":
          return roundFloat(num(l) - num(r));
        case "*":
          return roundFloat(num(l) * num(r));
        case "/": {
          const d = num(r);
          if (d === 0) throw new FormulaError("Division by zero");
          return roundFloat(num(l) / d);
        }
        case "%": {
          const d = num(r);
          if (d === 0) throw new FormulaError("Division by zero");
          return num(l) % d;
        }
        case "=":
        case "==":
          return looseEquals(l, r);
        case "!=":
        case "<>":
          return !looseEquals(l, r);
        case "<":
        case "<=":
        case ">":
        case ">=": {
          const ln = toNumber(l);
          const rn = toNumber(r);
          const [a, b]: [number | string, number | string] =
            ln !== null && rn !== null ? [ln, rn] : [String(l ?? ""), String(r ?? "")];
          if (ast.op === "<") return a < b;
          if (ast.op === "<=") return a <= b;
          if (ast.op === ">") return a > b;
          return a >= b;
        }
      }
      throw new FormulaError(`Unknown operator "${ast.op}"`);
    }
    case "call": {
      const args = ast.args;
      switch (ast.name) {
        case "IF":
          return truthy(args[0] ? ev(args[0]) : null) ? (args[1] ? ev(args[1]) : null) : args[2] ? ev(args[2]) : null;
        case "IS_EMPTY":
          return isEmptyValue(args[0] ? ev(args[0]) : null);
        case "AND":
          return args.every((a) => truthy(ev(a)));
        case "OR":
          return args.some((a) => truthy(ev(a)));
        case "NOT":
          return !truthy(args[0] ? ev(args[0]) : null);
        case "SUM":
          return roundFloat(args.reduce((s, a) => s + num(ev(a)), 0));
        case "AVG":
          return args.length ? roundFloat(args.reduce((s, a) => s + num(ev(a)), 0) / args.length) : null;
        case "MIN":
          return Math.min(...args.map((a) => num(ev(a))));
        case "MAX":
          return Math.max(...args.map((a) => num(ev(a))));
        case "ROUND": {
          const digits = args[1] ? num(ev(args[1])) : 0;
          const f = 10 ** digits;
          return Math.round(num(args[0] ? ev(args[0]) : 0) * f) / f;
        }
        case "ABS":
          return Math.abs(num(args[0] ? ev(args[0]) : 0));
        case "CONCAT":
          return args.map((a) => String(ev(a) ?? "")).join("");
        case "UPPER":
          return String((args[0] ? ev(args[0]) : "") ?? "").toUpperCase();
        case "LOWER":
          return String((args[0] ? ev(args[0]) : "") ?? "").toLowerCase();
        case "TRIM":
          return String((args[0] ? ev(args[0]) : "") ?? "").trim();
        case "LEN":
          return String((args[0] ? ev(args[0]) : "") ?? "").length;
        case "COALESCE":
          for (const a of args) {
            const v = ev(a);
            if (!isEmptyValue(v)) return v;
          }
          return null;
        case "TODAY":
          return zonedDateString(env.now, env.tz);
        case "NOW":
          return env.now.toISOString();
      }
      // TODO(core): LEFT, RIGHT, DATEADD, DATEDIFF, YEAR, MONTH, DAY.
      throw new FormulaError(`Unsupported function ${ast.name}()`);
    }
  }
}

// ============================================================================
// 7. Events — TODO(core): replace with @masai/schema-grid-core export (§4.9)
// ============================================================================

export type ConflictResolution = "keepTheirs" | "overwrite";

export interface SchemaGridEvents<Row extends GridRow = GridRow> {
  beforeCellsChange?(batch: ChangeBatch): ChangeBatch | false | Promise<ChangeBatch | false>;
  onCellsChange?(result: ChangeResult, batch: ChangeBatch): void;
  onRowsCreate?(rows: Row[]): void;
  onRowsDelete?(ids: string[]): void;
  onColumnCreate?(column: ColumnDef): void;
  onColumnUpdate?(column: ColumnDef): void;
  onColumnDelete?(columnId: string): void;
  onOptionCreate?(columnId: string, option: Option): void;
  onViewChange?(view: ViewDef): void;
  onConflict?(conflict: CellConflict, resolve: (resolution: ConflictResolution) => Promise<void>): void;
  onRemoteChanges?(entry: ChangeFeedEntry<Row>): void;
  onSchemaChanged?(schemaVersion: number): void;
}

// ============================================================================
// 8. IO bridge — TODO(io): replace with @masai/schema-grid-io exports once the
//    import-export plan ships `writeCsv` / `writeXlsx`.
// ============================================================================

export interface IoExportColumn {
  id: string;
  key: string;
  label: string;
  type: FieldTypeId;
}

export interface IoWriteInput {
  columns: IoExportColumn[];
  /** Already-formatted text cells, one array per row, in `columns` order. */
  rows: string[][];
  fileName?: string;
}

export interface IoModule {
  writeCsv(input: IoWriteInput): Blob | string | Promise<Blob | string>;
  writeXlsx(input: IoWriteInput): Blob | ArrayBuffer | Uint8Array | Promise<Blob | ArrayBuffer | Uint8Array>;
}

const IO_PACKAGE = "@masai/schema-grid-io";

/** Dynamically loads the optional io package; throws a clear error when absent. */
export async function loadIoModule(): Promise<IoModule> {
  let mod: Partial<IoModule>;
  try {
    mod = (await import(/* @vite-ignore */ IO_PACKAGE)) as Partial<IoModule>;
  } catch {
    throw new Error(`XLSX/CSV file export requires the optional peer dependency "${IO_PACKAGE}". Install it to enable exports.`);
  }
  if (typeof mod.writeCsv !== "function" || typeof mod.writeXlsx !== "function") {
    throw new Error(`"${IO_PACKAGE}" is installed but does not export writeCsv/writeXlsx yet.`);
  }
  return mod as IoModule;
}
