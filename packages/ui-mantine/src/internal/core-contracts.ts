/**
 * Core adapter. The ONLY place ui-mantine gets `@masai/schema-grid-core`
 * types and logic from.
 *
 * `@masai/schema-grid-core` is being built concurrently and currently only
 * exports a placeholder, so every symbol below is a local minimal fallback
 * that follows the binding names in spec §4. Each section carries a
 * `TODO(core)` marker: once core ships, delete the section and re-export the
 * real symbol from "@masai/schema-grid-core" instead.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// §4.1 Schema
// TODO(core): replace with real export — GridSchema, ColumnDef, ColumnPermissions,
// RoleRule, ViewDef, SortSpec, GroupSpec, AggregationId
// ---------------------------------------------------------------------------

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

// `(string & {})` keeps literal autocomplete while allowing custom ids.
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
  pinned?: "left" | "right" | null;
  hidden?: boolean;
  order: number;
  indexed?: boolean;
  formula?: string;
  source?: { valueField: string };
  createdAt: string;
  updatedAt: string;
}

export type AggregationId = "count" | "sum" | "avg" | "min" | "max" | "countEmpty" | "countFilled";

export interface SortSpec {
  columnId: string;
  dir: "asc" | "desc";
}

export interface GroupSpec {
  columnId: string;
  aggregations?: { columnId: string; agg: AggregationId }[];
}

export interface ViewColumnState {
  id: string;
  hidden: boolean;
  width: number | null;
  pinned: "left" | "right" | null;
  order: number;
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

// ---------------------------------------------------------------------------
// §4.3 Filter AST
// TODO(core): replace with real export — FilterNode, FilterGroup, FilterCondition,
// FilterValue, RelativeDate, RELATIVE_DATE_PRESETS, isFilterGroup
// ---------------------------------------------------------------------------

export const RELATIVE_DATE_PRESETS = [
  "today",
  "yesterday",
  "tomorrow",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "lastNDays",
  "nextNDays",
] as const;

export type RelativeDatePreset = (typeof RELATIVE_DATE_PRESETS)[number];

export interface RelativeDate {
  relative: RelativeDatePreset;
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

// ---------------------------------------------------------------------------
// §4.2 Field types
// TODO(core): replace with real export — FieldType, FieldTypeRegistry,
// FilterOperatorDef, ValueKind, ParseResult, createDefaultRegistry
// ---------------------------------------------------------------------------

export type ValueKind = "none" | "single" | "multi" | "range" | "relativeDate" | "me";

export interface FilterOperatorDef {
  id: string;
  label: string;
  valueKind: ValueKind;
  negative?: boolean;
}

export type ParseResult<TValue> = { ok: true; value: TValue } | { ok: false; error: string };

export interface FieldType<TValue = unknown, TConfig = unknown> {
  id: FieldTypeId;
  label: string;
  configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
  defaultConfig: TConfig;
  valueSchema(config: TConfig): z.ZodType<TValue, z.ZodTypeDef, unknown>;
  parse(input: unknown, config: TConfig): ParseResult<TValue>;
  format(value: TValue | null | undefined, config: TConfig): string;
  serialize(value: TValue): unknown;
  deserialize(raw: unknown): TValue;
  compare(a: TValue, b: TValue, config: TConfig): number;
  operators: FilterOperatorDef[];
  fillSeries?(values: TValue[], count: number): TValue[];
  aggregations?: AggregationId[];
  defaultValue(config: TConfig): TValue | null;
}

// biome-ignore lint/suspicious/noExplicitAny: registry stores heterogeneous field types
export type AnyFieldType = FieldType<any, any>;

export interface FieldTypeRegistry {
  register(type: AnyFieldType): void;
  get(id: FieldTypeId): AnyFieldType | undefined;
  list(): AnyFieldType[];
  has(id: FieldTypeId): boolean;
}

export interface SelectOption {
  label: string;
  value: string;
  color?: string;
}

export interface UserRef {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface LinkRef {
  id: string;
  label: string;
}

const isEmptyValue = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

const op = (id: string, label: string, valueKind: ValueKind, negative?: boolean): FilterOperatorDef =>
  negative ? { id, label, valueKind, negative } : { id, label, valueKind };

const EMPTY_OPS = [op("isEmpty", "is empty", "none"), op("isNotEmpty", "is not empty", "none")];

const OPS = {
  option: [
    op("is", "is", "single"),
    op("isNot", "is not", "single", true),
    op("isAnyOf", "is any of", "multi"),
    op("isNoneOf", "is none of", "multi", true),
    ...EMPTY_OPS,
  ],
  multi: [
    op("hasAnyOf", "has any of", "multi"),
    op("hasAllOf", "has all of", "multi"),
    op("hasNoneOf", "has none of", "multi", true),
    ...EMPTY_OPS,
  ],
  date: [
    op("is", "is", "single"),
    op("isBefore", "is before", "single"),
    op("isAfter", "is after", "single"),
    op("isBetween", "is between", "range"),
    op("isWithin", "is within", "relativeDate"),
    ...EMPTY_OPS,
  ],
  number: [
    op("eq", "=", "single"),
    op("neq", "≠", "single", true),
    op("lt", "<", "single"),
    op("lte", "≤", "single"),
    op("gt", ">", "single"),
    op("gte", "≥", "single"),
    op("between", "between", "range"),
    ...EMPTY_OPS,
  ],
  text: [
    op("contains", "contains", "single"),
    op("notContains", "does not contain", "single", true),
    op("startsWith", "starts with", "single"),
    op("is", "is", "single"),
    op("isNot", "is not", "single", true),
    ...EMPTY_OPS,
  ],
  boolean: [op("isTrue", "is true", "none"), op("isFalse", "is false", "none")],
  link: [op("is", "is", "single"), op("isAnyOf", "is any of", "multi"), ...EMPTY_OPS],
} satisfies Record<string, FilterOperatorDef[]>;

const NUMERIC_AGGREGATIONS: AggregationId[] = ["count", "sum", "avg", "min", "max", "countEmpty", "countFilled"];

const optionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  color: z.string().optional(),
});

const selectConfigSchema = z.object({
  options: z.array(optionSchema).default([]),
});
type SelectConfig = z.infer<typeof selectConfigSchema>;

const labelFor = (config: SelectConfig | undefined, value: unknown): string => {
  const found = config?.options?.find((o) => o.value === value);
  return found ? found.label : String(value);
};

const compareStrings = (a: unknown, b: unknown) => String(a ?? "").localeCompare(String(b ?? ""));
const compareNumbers = (a: unknown, b: unknown) => Number(a ?? 0) - Number(b ?? 0);

interface TypeSpec<TValue, TConfig> {
  id: BuiltInFieldTypeId;
  label: string;
  configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
  valueSchema: z.ZodType<TValue, z.ZodTypeDef, unknown>;
  operators: FilterOperatorDef[];
  parse: (input: unknown, config: TConfig) => ParseResult<TValue>;
  format?: (value: TValue, config: TConfig) => string;
  compare?: (a: TValue, b: TValue, config: TConfig) => number;
  defaultValue?: (config: TConfig) => TValue | null;
  aggregations?: AggregationId[];
}

function defineType<TValue, TConfig>(spec: TypeSpec<TValue, TConfig>): FieldType<TValue, TConfig> {
  const defaultConfig = spec.configSchema.parse({});
  return {
    id: spec.id,
    label: spec.label,
    configSchema: spec.configSchema,
    defaultConfig,
    valueSchema: () => spec.valueSchema,
    parse: spec.parse,
    format: (value, config) => {
      if (isEmptyValue(value)) return "";
      return spec.format ? spec.format(value as TValue, config ?? defaultConfig) : String(value);
    },
    serialize: (value) => value,
    deserialize: (raw) => raw as TValue,
    compare: spec.compare ?? compareStrings,
    operators: spec.operators,
    aggregations: spec.aggregations,
    defaultValue: spec.defaultValue ?? (() => null),
  };
}

const textParse = (input: unknown): ParseResult<string> =>
  input === null || input === undefined ? { ok: true, value: "" } : { ok: true, value: String(input) };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{5,}$/;

function parseUrl(input: unknown): ParseResult<string> {
  const s = String(input ?? "").trim();
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "URL must start with http:// or https://" };
    return { ok: true, value: s };
  } catch {
    return { ok: false, error: "Not a valid URL" };
  }
}

function parseNumber(input: unknown): ParseResult<number> {
  if (typeof input === "number") return Number.isFinite(input) ? { ok: true, value: input } : { ok: false, error: "Not a number" };
  const s = String(input ?? "")
    .replace(/[,\s]/g, "")
    .replace(/^[^\d\-.]+/, "");
  if (s === "") return { ok: false, error: "Not a number" };
  const n = Number(s);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "Not a number" };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDate(input: unknown): ParseResult<string> {
  const s = String(input ?? "").trim();
  if (DATE_RE.test(s) && !Number.isNaN(Date.parse(s))) return { ok: true, value: s };
  const d = new Date(s);
  if (s !== "" && !Number.isNaN(d.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return { ok: true, value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
  }
  return { ok: false, error: "Not a valid date (YYYY-MM-DD)" };
}
function parseDateTime(input: unknown): ParseResult<string> {
  const s = String(input ?? "").trim();
  const d = new Date(s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s);
  if (s === "" || Number.isNaN(d.getTime())) return { ok: false, error: "Not a valid date-time" };
  return { ok: true, value: d.toISOString() };
}

const currencyConfigSchema = z.object({
  currency: z.string().default("INR"),
  locale: z.string().default("en-IN"),
  decimalScale: z.number().int().min(0).max(6).default(0),
  fixedDecimalScale: z.boolean().default(false),
});
type CurrencyConfig = z.infer<typeof currencyConfigSchema>;

/** Currency symbol for an ISO code in a locale, e.g. INR → ₹. */
export function currencySymbol(currency: string, locale = "en-US"): string {
  try {
    const part = new Intl.NumberFormat(locale, { style: "currency", currency })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

const numberConfigSchema = z.object({
  precision: z.number().int().min(0).max(10).default(0),
  min: z.number().optional(),
  max: z.number().optional(),
});

const userConfigSchema = z.object({ multiple: z.boolean().default(false) });
const linkConfigSchema = z.object({
  targetSchemaId: z.string().optional(),
  allowMultiple: z.boolean().default(false),
});

const userLabel = (v: unknown): string => {
  if (v && typeof v === "object" && "name" in v) return String((v as UserRef).name);
  return String(v);
};
const linkLabel = (v: unknown): string => {
  if (v && typeof v === "object" && "label" in v) return String((v as LinkRef).label);
  return String(v);
};

export function createDefaultRegistry(): FieldTypeRegistry {
  const registry = createFieldTypeRegistry();
  const optionValue = z.string();
  const types: AnyFieldType[] = [
    defineType({
      id: "text",
      label: "Text",
      configSchema: z.object({ maxLength: z.number().int().positive().optional() }),
      valueSchema: z.string(),
      operators: OPS.text,
      parse: textParse,
    }),
    defineType({
      id: "longText",
      label: "Long text",
      configSchema: z.object({ maxLength: z.number().int().positive().optional() }),
      valueSchema: z.string(),
      operators: OPS.text,
      parse: textParse,
    }),
    defineType({
      id: "number",
      label: "Number",
      configSchema: numberConfigSchema,
      valueSchema: z.number(),
      operators: OPS.number,
      parse: parseNumber,
      format: (v, c) => Number(v).toFixed(c.precision),
      compare: compareNumbers,
      aggregations: NUMERIC_AGGREGATIONS,
    }),
    defineType<number, CurrencyConfig>({
      id: "currency",
      label: "Currency",
      configSchema: currencyConfigSchema,
      valueSchema: z.number(),
      operators: OPS.number,
      parse: parseNumber,
      format: (v, c) =>
        new Intl.NumberFormat(c.locale, {
          style: "currency",
          currency: c.currency,
          minimumFractionDigits: c.fixedDecimalScale ? c.decimalScale : 0,
          maximumFractionDigits: c.decimalScale,
        }).format(Number(v)),
      compare: compareNumbers,
      aggregations: NUMERIC_AGGREGATIONS,
    }),
    defineType<boolean, Record<string, never>>({
      id: "boolean",
      label: "Checkbox",
      configSchema: z.object({}) as unknown as z.ZodType<Record<string, never>, z.ZodTypeDef, unknown>,
      valueSchema: z.boolean(),
      operators: OPS.boolean,
      parse: (input) => {
        const s = String(input ?? "").trim().toLowerCase();
        if (["true", "yes", "1", "y", "checked"].includes(s)) return { ok: true, value: true };
        if (["false", "no", "0", "n", ""].includes(s)) return { ok: true, value: false };
        return { ok: false, error: "Not a boolean" };
      },
      format: (v) => (v ? "Yes" : "No"),
      defaultValue: () => false,
    }),
    defineType({
      id: "date",
      label: "Date",
      configSchema: z.object({}),
      valueSchema: z.string().regex(DATE_RE),
      operators: OPS.date,
      parse: parseDate,
    }),
    defineType({
      id: "datetime",
      label: "Date & time",
      configSchema: z.object({}),
      valueSchema: z.string(),
      operators: OPS.date,
      parse: parseDateTime,
    }),
    defineType<string, SelectConfig>({
      id: "select",
      label: "Single select",
      configSchema: selectConfigSchema,
      valueSchema: optionValue,
      operators: OPS.option,
      parse: (input, config) => {
        const s = String(input ?? "").trim();
        const match = config.options.find((o) => o.value === s || o.label.toLowerCase() === s.toLowerCase());
        return match ? { ok: true, value: match.value } : { ok: false, error: `Unknown option "${s}"` };
      },
      format: (v, c) => labelFor(c, v),
    }),
    defineType<string[], SelectConfig>({
      id: "multiSelect",
      label: "Multiple select",
      configSchema: selectConfigSchema,
      valueSchema: z.array(optionValue),
      operators: OPS.multi,
      parse: (input, config) => {
        const parts = Array.isArray(input)
          ? input.map(String)
          : String(input ?? "")
              .split(/[,;]/)
              .map((s) => s.trim())
              .filter(Boolean);
        const out: string[] = [];
        for (const p of parts) {
          const m = config.options.find((o) => o.value === p || o.label.toLowerCase() === p.toLowerCase());
          if (!m) return { ok: false, error: `Unknown option "${p}"` };
          out.push(m.value);
        }
        return { ok: true, value: out };
      },
      format: (v, c) => v.map((x) => labelFor(c, x)).join(", "),
      defaultValue: () => [],
    }),
    defineType<string, SelectConfig>({
      id: "creatableSelect",
      label: "Select (creatable)",
      configSchema: selectConfigSchema,
      valueSchema: optionValue,
      operators: OPS.option,
      parse: (input, config) => {
        const s = String(input ?? "").trim();
        const match = config.options.find((o) => o.value === s || o.label.toLowerCase() === s.toLowerCase());
        return { ok: true, value: match ? match.value : s };
      },
      format: (v, c) => labelFor(c, v),
    }),
    defineType({
      id: "user",
      label: "User",
      configSchema: userConfigSchema,
      valueSchema: z.union([z.string(), z.object({ id: z.string(), name: z.string() })]),
      operators: [...OPS.option, op("isMe", "is me", "me"), op("isNotMe", "is not me", "me", true)],
      parse: (input) => ({ ok: true, value: String(input ?? "") }),
      format: (v) => userLabel(v),
    }),
    defineType({
      id: "url",
      label: "URL",
      configSchema: z.object({}),
      valueSchema: z.string(),
      operators: OPS.text,
      parse: parseUrl,
    }),
    defineType({
      id: "email",
      label: "Email",
      configSchema: z.object({}),
      valueSchema: z.string().email(),
      operators: OPS.text,
      parse: (input) => {
        const s = String(input ?? "").trim();
        return EMAIL_RE.test(s) ? { ok: true, value: s } : { ok: false, error: "Not a valid email address" };
      },
    }),
    defineType({
      id: "phone",
      label: "Phone",
      configSchema: z.object({}),
      valueSchema: z.string(),
      operators: OPS.text,
      parse: (input) => {
        const s = String(input ?? "").trim();
        return PHONE_RE.test(s) ? { ok: true, value: s } : { ok: false, error: "Not a valid phone number" };
      },
    }),
    defineType({
      id: "link",
      label: "Link to record",
      configSchema: linkConfigSchema,
      valueSchema: z.unknown(),
      operators: OPS.link,
      parse: (input) => ({ ok: true, value: input }),
      format: (v) => (Array.isArray(v) ? v.map(linkLabel).join(", ") : linkLabel(v)),
    }),
    defineType({
      id: "formula",
      label: "Formula",
      configSchema: z.object({}),
      valueSchema: z.unknown(),
      operators: [],
      parse: () => ({ ok: false, error: "Formula columns are read-only" }),
      format: (v) => (typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : String(v)),
    }),
  ];
  for (const t of types) registry.register(t);
  return registry;
}

export function createFieldTypeRegistry(): FieldTypeRegistry {
  const map = new Map<string, AnyFieldType>();
  return {
    register: (type) => {
      map.set(type.id, type);
    },
    get: (id) => map.get(id),
    list: () => [...map.values()],
    has: (id) => map.has(id),
  };
}

// ---------------------------------------------------------------------------
// §4.7 Permissions
// TODO(core): replace with real export — Access, ActorRef, PermissionContext,
// PermissionResolver, createRolePermissionResolver, resolveColumnAccess
// ---------------------------------------------------------------------------

export type Access = "hidden" | "read" | "edit";

export interface ActorRef {
  id: string;
  name?: string;
  avatarUrl?: string;
}

export interface PermissionUser {
  id: string;
  roles: string[];
}

export interface PermissionContext {
  user: PermissionUser;
  column: ColumnDef;
  row?: GridRow;
}

export type PermissionResolver = (ctx: PermissionContext) => Access;

const ruleAllows = (rule: RoleRule | undefined, roles: string[]): boolean =>
  rule === undefined || rule === "all" || rule.roles.some((r) => roles.includes(r));

export function createRolePermissionResolver(): PermissionResolver {
  return ({ user, column }) => {
    if (!ruleAllows(column.permissions?.read, user.roles)) return "hidden";
    if (column.type === "formula") return "read";
    return ruleAllows(column.permissions?.edit, user.roles) ? "edit" : "read";
  };
}

export function resolveColumnAccess(
  schema: GridSchema,
  resolver: PermissionResolver,
  user: PermissionUser,
): Map<string, Access> {
  const out = new Map<string, Access>();
  for (const column of schema.columns) out.set(column.id, resolver({ user, column }));
  return out;
}

// ---------------------------------------------------------------------------
// §4.5 / §4.6 Rows, changes, data source
// TODO(core): replace with real export — GridRow, CellChange, ChangeConflict,
// ChangeResult, Option, DataSource
// ---------------------------------------------------------------------------

export interface GridRow {
  id: string;
  version: number;
  updatedAt: string;
  updatedBy?: ActorRef;
  cells: Record<string, unknown>;
}

export interface CellChange {
  rowId: string;
  columnId: string;
  prev: unknown;
  next: unknown;
}

export interface ChangeConflict {
  rowId: string;
  columnId: string;
  serverValue: unknown;
  serverVersion: number;
  updatedBy?: ActorRef;
  updatedAt: string;
}

export interface ChangeResult {
  applied: CellChange[];
  conflicts: ChangeConflict[];
  errors: { rowId: string; columnId: string; message: string }[];
}

/** Option returned by `getOptions`/`createOption`; user pickers may add `avatarUrl`. */
export interface Option {
  label: string;
  value: string;
  color?: string;
  avatarUrl?: string;
}

/** Only the option/lookup subset of §4.6 DataSource is needed by UI widgets. */
export interface DataSource<Row extends GridRow = GridRow> {
  fetch?(query: unknown): Promise<{ rows: Row[]; total?: number }>;
  getOptions?(columnId: string, search?: string): Promise<Option[]>;
  createOption?(columnId: string, label: string): Promise<Option>;
  lookup?(columnId: string, search: string): Promise<LinkRef[]>;
}

// ---------------------------------------------------------------------------
// §4.3 validateFilter
// TODO(core): replace with real export — validateFilter, FilterValidationError
// ---------------------------------------------------------------------------

export type FilterValidationCode =
  | "unknownColumn"
  | "unreadableColumn"
  | "unknownOperator"
  | "depthExceeded"
  | "valueKindMismatch";

export interface FilterValidationError {
  code: FilterValidationCode;
  /** Child-index path from the root node (root = []). */
  path: number[];
  columnId?: string;
  message: string;
}

export const MAX_FILTER_DEPTH = 2;

/** Operators of a column, resolving formula columns to their result type's operators. */
export function operatorsForColumn(column: ColumnDef, schema: GridSchema, registry: FieldTypeRegistry): FilterOperatorDef[] {
  if (column.type === "formula") {
    const parsed = column.formula ? parseFormula(column.formula) : null;
    if (!parsed || isFormulaError(parsed)) return [];
    const resultType = inferResultType(parsed, schema);
    return registry.get(resultType === "text" ? "text" : resultType)?.operators ?? [];
  }
  return registry.get(column.type)?.operators ?? [];
}

const isPrimitive = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const isFilledPrimitive = (v: unknown) => isPrimitive(v) && v !== "";

export function valueMatchesKind(kind: ValueKind, value: unknown): boolean {
  switch (kind) {
    case "none":
      return value === undefined || value === null;
    case "single":
      return isFilledPrimitive(value);
    case "multi":
      return Array.isArray(value) && value.length > 0 && value.every(isFilledPrimitive);
    case "range": {
      if (!value || typeof value !== "object" || !("from" in value) || !("to" in value)) return false;
      const r = value as { from: unknown; to: unknown };
      return isFilledPrimitive(r.from) && isFilledPrimitive(r.to);
    }
    case "relativeDate": {
      if (!value || typeof value !== "object" || !("relative" in value)) return false;
      const rd = value as RelativeDate;
      if (!(RELATIVE_DATE_PRESETS as readonly string[]).includes(rd.relative)) return false;
      if (rd.relative === "lastNDays" || rd.relative === "nextNDays")
        return typeof rd.n === "number" && Number.isInteger(rd.n) && rd.n > 0;
      return true;
    }
    case "me":
      return !!value && typeof value === "object" && (value as { me?: unknown }).me === true;
  }
}

export function validateFilter(
  node: FilterNode,
  schema: GridSchema,
  registry: FieldTypeRegistry,
  readableColumnIds: ReadonlySet<string> | readonly string[],
): FilterValidationError[] {
  const readable = readableColumnIds instanceof Set ? readableColumnIds : new Set(readableColumnIds as readonly string[]);
  const errors: FilterValidationError[] = [];
  const visit = (n: FilterNode, path: number[], depth: number) => {
    if (isFilterGroup(n)) {
      if (depth > MAX_FILTER_DEPTH) {
        errors.push({ code: "depthExceeded", path, message: `Filter groups may nest at most ${MAX_FILTER_DEPTH} levels` });
        return;
      }
      n.children.forEach((c, i) => visit(c, [...path, i], depth + 1));
      return;
    }
    const column = schema.columns.find((c) => c.id === n.columnId);
    if (!column) {
      errors.push({ code: "unknownColumn", path, columnId: n.columnId, message: "Unknown column" });
      return;
    }
    if (!readable.has(column.id)) {
      errors.push({ code: "unreadableColumn", path, columnId: n.columnId, message: "Column is not readable" });
      return;
    }
    const operator = operatorsForColumn(column, schema, registry).find((o) => o.id === n.operator);
    if (!operator) {
      errors.push({ code: "unknownOperator", path, columnId: n.columnId, message: `Unknown operator "${n.operator}"` });
      return;
    }
    if (!valueMatchesKind(operator.valueKind, n.value)) {
      errors.push({
        code: "valueKindMismatch",
        path,
        columnId: n.columnId,
        message: operator.valueKind === "none" ? "This operator takes no value" : "A value is required",
      });
    }
  };
  visit(node, [], 1);
  return errors;
}

// ---------------------------------------------------------------------------
// §4.8 Formula engine (minimal parser + type inference)
// TODO(core): replace with real export — parseFormula, FormulaAst, FormulaError,
// isFormulaError, inferResultType, dependencies, FormulaResultType, FORMULA_FUNCTIONS
// ---------------------------------------------------------------------------

export type FormulaResultType = "number" | "text" | "boolean" | "date";

export type FormulaAst =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "ref"; key: string }
  | { kind: "unary"; op: "-" | "!"; operand: FormulaAst }
  | { kind: "binary"; op: string; left: FormulaAst; right: FormulaAst }
  | { kind: "call"; name: string; args: FormulaAst[] };

export interface FormulaError {
  kind: "error";
  message: string;
  position?: number;
}

export function isFormulaError(v: FormulaAst | FormulaError): v is FormulaError {
  return v.kind === "error";
}

const FUNCTION_TYPES: Record<string, FormulaResultType | "arg1" | "arg0"> = {
  IF: "arg1",
  AND: "boolean",
  OR: "boolean",
  NOT: "boolean",
  SUM: "number",
  AVG: "number",
  MIN: "number",
  MAX: "number",
  ROUND: "number",
  ABS: "number",
  CONCAT: "text",
  UPPER: "text",
  LOWER: "text",
  TRIM: "text",
  LEN: "number",
  LEFT: "text",
  RIGHT: "text",
  TODAY: "date",
  NOW: "date",
  DATEADD: "date",
  DATEDIFF: "number",
  YEAR: "number",
  MONTH: "number",
  DAY: "number",
  IS_EMPTY: "boolean",
  COALESCE: "arg0",
};

export const FORMULA_FUNCTIONS: readonly string[] = Object.keys(FUNCTION_TYPES);

type Tok =
  | { t: "num"; v: number; p: number }
  | { t: "str"; v: string; p: number }
  | { t: "ref"; v: string; p: number }
  | { t: "id"; v: string; p: number }
  | { t: "op"; v: string; p: number }
  | { t: "eof"; p: number };

class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    public position: number,
  ) {
    super(message);
  }
}

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
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaSyntaxError("Invalid number", i);
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
      if (j >= src.length) throw new FormulaSyntaxError("Unterminated string", i);
      out.push({ t: "str", v: s, p: i });
      i = j + 1;
      continue;
    }
    if (ch === "{") {
      const end = src.indexOf("}", i);
      if (end === -1) throw new FormulaSyntaxError("Unclosed column reference", i);
      const key = src.slice(i + 1, end).trim();
      if (!key) throw new FormulaSyntaxError("Empty column reference", i);
      out.push({ t: "ref", v: key, p: i });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ t: "id", v: m[0], p: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "!=", "<>", "==", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two, p: i });
      i += 2;
      continue;
    }
    if ("+-*/%<>=!(),&".includes(ch)) {
      out.push({ t: "op", v: ch, p: i });
      i++;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected character "${ch}"`, i);
  }
  out.push({ t: "eof", p: src.length });
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
    if (src.trim() === "") return { kind: "error", message: "Formula is empty", position: 0 };
    const toks = tokenize(src);
    let pos = 0;
    const peek = () => toks[pos] as Tok;
    const next = () => toks[pos++] as Tok;
    const expectOp = (v: string) => {
      const t = next();
      if (t.t !== "op" || t.v !== v) throw new FormulaSyntaxError(`Expected "${v}"`, t.p);
    };
    const parsePrimary = (): FormulaAst => {
      const t = next();
      switch (t.t) {
        case "num":
          return { kind: "number", value: t.v };
        case "str":
          return { kind: "string", value: t.v };
        case "ref":
          return { kind: "ref", key: t.v };
        case "id": {
          const upper = t.v.toUpperCase();
          if (upper === "TRUE" || upper === "FALSE") return { kind: "boolean", value: upper === "TRUE" };
          if (!(upper in FUNCTION_TYPES)) throw new FormulaSyntaxError(`Unknown function "${t.v}"`, t.p);
          expectOp("(");
          const args: FormulaAst[] = [];
          const nt = peek();
          if (!(nt.t === "op" && nt.v === ")")) {
            args.push(parseExpr(0));
            while (peek().t === "op" && (peek() as { v: string }).v === ",") {
              next();
              args.push(parseExpr(0));
            }
          }
          expectOp(")");
          return { kind: "call", name: upper, args };
        }
        case "op":
          if (t.v === "(") {
            const e = parseExpr(0);
            expectOp(")");
            return e;
          }
          if (t.v === "-" || t.v === "!") return { kind: "unary", op: t.v, operand: parseExpr(7) };
          throw new FormulaSyntaxError(`Unexpected "${t.v}"`, t.p);
        case "eof":
          throw new FormulaSyntaxError("Unexpected end of formula", t.p);
      }
    };
    const parseExpr = (minPrec: number): FormulaAst => {
      let left = parsePrimary();
      for (;;) {
        const t = peek();
        if (t.t !== "op") break;
        const prec = BINARY_PRECEDENCE[t.v];
        if (prec === undefined || prec < minPrec) break;
        next();
        const right = parseExpr(prec + 1);
        left = { kind: "binary", op: t.v, left, right };
      }
      return left;
    };
    const ast = parseExpr(0);
    const rest = peek();
    if (rest.t !== "eof") throw new FormulaSyntaxError("Unexpected token", rest.p);
    return ast;
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return { kind: "error", message: e.message, position: e.position };
    return { kind: "error", message: String(e) };
  }
}

export function dependencies(ast: FormulaAst): string[] {
  const out = new Set<string>();
  const walk = (n: FormulaAst) => {
    switch (n.kind) {
      case "ref":
        out.add(n.key);
        break;
      case "unary":
        walk(n.operand);
        break;
      case "binary":
        walk(n.left);
        walk(n.right);
        break;
      case "call":
        n.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(ast);
  return [...out];
}

function columnResultType(column: ColumnDef, schema: GridSchema, seen: Set<string>): FormulaResultType {
  switch (column.type) {
    case "number":
    case "currency":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
    case "datetime":
      return "date";
    case "formula": {
      if (!column.formula || seen.has(column.key)) return "text";
      const ast = parseFormula(column.formula);
      if (isFormulaError(ast)) return "text";
      return infer(ast, schema, new Set([...seen, column.key]));
    }
    default:
      return "text";
  }
}

function infer(ast: FormulaAst, schema: GridSchema, seen: Set<string>): FormulaResultType {
  switch (ast.kind) {
    case "number":
      return "number";
    case "string":
      return "text";
    case "boolean":
      return "boolean";
    case "ref": {
      const col = schema.columns.find((c) => c.key === ast.key);
      return col ? columnResultType(col, schema, seen) : "text";
    }
    case "unary":
      return ast.op === "!" ? "boolean" : "number";
    case "binary": {
      if (["=", "==", "!=", "<>", "<", "<=", ">", ">=", "&&", "||"].includes(ast.op)) return "boolean";
      if (ast.op === "&") return "text";
      const l = infer(ast.left, schema, seen);
      const r = infer(ast.right, schema, seen);
      if (ast.op === "+" && (l === "text" || r === "text")) return "text";
      if ((ast.op === "+" || ast.op === "-") && l === "date" && r === "number") return "date";
      return "number";
    }
    case "call": {
      const t = FUNCTION_TYPES[ast.name];
      if (t === "arg1") return ast.args[1] ? infer(ast.args[1], schema, seen) : "text";
      if (t === "arg0") return ast.args[0] ? infer(ast.args[0], schema, seen) : "text";
      return t ?? "text";
    }
  }
}

export function inferResultType(ast: FormulaAst, schema: GridSchema): FormulaResultType {
  return infer(ast, schema, new Set());
}
