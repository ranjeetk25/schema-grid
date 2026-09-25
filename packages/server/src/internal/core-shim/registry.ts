/**
 * TEMPORARY minimal field-type registry (core plan Tasks 7–26). Only what the
 * server needs: ids, operators (with `negative`), valueSchema, parse,
 * serialize/deserialize, compare, aggregations, defaultValue.
 * TODO(core): replace with @masai/schema-grid-core `createDefaultRegistry`.
 */
import { z } from "zod";
import { isEmptyValue } from "./empty";
import {
  BOOLEAN_OPERATORS,
  DATE_OPERATORS,
  LINK_OPERATORS,
  MULTI_SELECT_OPERATORS,
  NUMBER_OPERATORS,
  SELECT_OPERATORS,
  TEXT_OPERATORS,
  USER_OPERATORS,
} from "./operators";
import type {
  AggregationId,
  AnyFieldType,
  ColumnDef,
  FieldType,
  FieldTypeRegistry,
  FilterOperatorDef,
  FormulaResultType,
  LinkRef,
  Option,
  ParseResult,
  UserRef,
} from "./types";

export function createFieldTypeRegistry(types: AnyFieldType[] = []): FieldTypeRegistry {
  const map = new Map<string, AnyFieldType>();
  const registry: FieldTypeRegistry = {
    register(type) {
      if (map.has(type.id)) throw new Error(`Field type "${type.id}" is already registered`);
      map.set(type.id, type);
    },
    get: (id) => map.get(id),
    list: () => [...map.values()],
    has: (id) => map.has(id),
  };
  for (const t of types) registry.register(t);
  return registry;
}

const ALL_AGGS: readonly AggregationId[] = ["count", "sum", "avg", "min", "max", "countEmpty", "countFilled"];
const DATE_AGGS: readonly AggregationId[] = ["count", "min", "max", "countEmpty", "countFilled"];

const cmpBasic = (a: unknown, b: unknown): number => {
  if (isEmptyValue(a) && isEmptyValue(b)) return 0;
  if (isEmptyValue(a)) return 1;
  if (isEmptyValue(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
};

interface Spec<T, C> {
  id: string;
  operators: readonly FilterOperatorDef[];
  configSchema?: z.ZodType<C>;
  defaultConfig?: C;
  value: (config: C) => z.ZodType<T>;
  parse?: (input: unknown, config: C) => ParseResult<T | null>;
  format?: (value: T | null, config: C) => string;
  aggregations?: readonly AggregationId[];
  defaultValue?: T | null;
  compare?: (a: T | null, b: T | null) => number;
}

function make<T, C = Record<string, never>>(spec: Spec<T, C>): FieldType<T, C> {
  const t: FieldType<T, C> = {
    id: spec.id,
    label: spec.id,
    configSchema: (spec.configSchema ?? z.object({}).passthrough()) as unknown as z.ZodType<C>,
    defaultConfig: (spec.defaultConfig ?? {}) as C,
    valueSchema: (config) => spec.value(config).nullable() as unknown as z.ZodType<T | null>,
    parse:
      spec.parse ??
      ((input, config) => {
        if (isEmptyValue(input)) return { ok: true, value: null };
        const r = spec.value(config).safeParse(typeof input === "string" ? input.trim() : input);
        return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues[0]?.message ?? "invalid" };
      }),
    format: spec.format ?? ((v) => (v === null || v === undefined ? "" : String(v))),
    serialize: (v) => (isEmptyValue(v) ? null : v),
    deserialize: (raw) => {
      if (raw === null || raw === undefined) return null;
      const r = spec.value(t.defaultConfig).safeParse(raw);
      return r.success ? r.data : (raw as T);
    },
    compare: (a, b) => (spec.compare ? spec.compare(a, b) : cmpBasic(a, b)),
    operators: spec.operators,
    defaultValue: () => (spec.defaultValue === undefined ? null : spec.defaultValue),
  };
  if (spec.aggregations) t.aggregations = spec.aggregations;
  return t;
}

const text = (id: string, schema: z.ZodType<string> = z.string()) =>
  make<string>({ id, operators: TEXT_OPERATORS, value: () => schema });

const numberParse = (input: unknown): ParseResult<number | null> => {
  if (isEmptyValue(input)) return { ok: true, value: null };
  const n = typeof input === "number" ? input : Number(String(input).replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "Not a number" };
};

const optionsConfig = z.object({
  options: z.array(z.object({ id: z.string(), label: z.string(), color: z.string().optional() })),
});
type OptionsConfig = { options: Option[] };
const findOption = (config: OptionsConfig, input: string) =>
  config.options.find((o) => o.id === input || o.label.toLowerCase() === input.toLowerCase());

const selectType = (id: string, creatable: boolean) =>
  make<string, OptionsConfig>({
    id,
    operators: SELECT_OPERATORS,
    configSchema: optionsConfig,
    defaultConfig: { options: [] },
    value: (config) =>
      creatable
        ? z.string()
        : z.string().refine((v) => config.options.some((o) => o.id === v), { message: "Unknown option" }),
    parse: (input, config) => {
      if (isEmptyValue(input)) return { ok: true, value: null };
      const s = String(input).trim();
      const found = findOption(config, s);
      if (found) return { ok: true, value: found.id };
      return creatable ? { ok: true, value: s, pendingOptions: [s] } : { ok: false, error: `Unknown option "${s}"` };
    },
  });

const userRefSchema = z.object({ id: z.string(), name: z.string().optional() });
const linkRefSchema = z.object({ id: z.string(), label: z.string() });

export type FormulaConfig = { resultType: FormulaResultType; precision?: number };

export const builtinFieldTypes: readonly AnyFieldType[] = [
  text("text"),
  text("longText"),
  make<number>({ id: "number", operators: NUMBER_OPERATORS, value: () => z.number().finite(), parse: numberParse, aggregations: ALL_AGGS }),
  make<number>({ id: "currency", operators: NUMBER_OPERATORS, value: () => z.number().finite(), parse: numberParse, aggregations: ALL_AGGS }),
  make<boolean>({
    id: "boolean",
    operators: BOOLEAN_OPERATORS,
    value: () => z.boolean(),
    defaultValue: false,
    parse: (input) => {
      if (typeof input === "boolean") return { ok: true, value: input };
      const s = String(input ?? "").trim().toLowerCase();
      if (["true", "yes", "y", "1", "checked", "✓"].includes(s)) return { ok: true, value: true };
      if (["false", "no", "n", "0"].includes(s)) return { ok: true, value: false };
      return { ok: false, error: "Not a boolean" };
    },
  }),
  make<string>({
    id: "date",
    operators: DATE_OPERATORS,
    value: () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
    aggregations: DATE_AGGS,
  }),
  make<string>({
    id: "datetime",
    operators: DATE_OPERATORS,
    value: () => z.string().datetime({ offset: false, precision: 3 }),
    aggregations: DATE_AGGS,
    parse: (input) => {
      if (isEmptyValue(input)) return { ok: true, value: null };
      const d = new Date(String(input));
      return Number.isNaN(d.getTime()) ? { ok: false, error: "Invalid datetime" } : { ok: true, value: d.toISOString() };
    },
  }),
  selectType("select", false),
  make<string[], OptionsConfig & { allowCreate?: boolean }>({
    id: "multiSelect",
    operators: MULTI_SELECT_OPERATORS,
    configSchema: optionsConfig.extend({ allowCreate: z.boolean().optional() }),
    defaultConfig: { options: [] },
    value: () => z.array(z.string()),
    defaultValue: [],
    parse: (input, config) => {
      if (isEmptyValue(input)) return { ok: true, value: [] };
      const parts = Array.isArray(input) ? input.map(String) : String(input).split(",");
      const ids: string[] = [];
      for (const p of parts) {
        const found = findOption(config, p.trim());
        if (!found) return { ok: false, error: `Unknown option "${p.trim()}"` };
        if (!ids.includes(found.id)) ids.push(found.id);
      }
      return { ok: true, value: ids };
    },
  }),
  selectType("creatableSelect", true),
  make<UserRef>({
    id: "user",
    operators: USER_OPERATORS,
    value: () => userRefSchema,
    parse: (input) => {
      if (isEmptyValue(input)) return { ok: true, value: null };
      if (typeof input === "string") return { ok: true, value: { id: input.trim() } };
      const r = userRefSchema.safeParse(input);
      return r.success ? { ok: true, value: r.data } : { ok: false, error: "Invalid user" };
    },
    format: (v) => (v ? (v.name ?? v.id) : ""),
  }),
  text("url", z.string().url()),
  text("email", z.string().email()),
  text("phone", z.string().regex(/^\+?\d{7,15}$/, "Invalid phone")),
  make<LinkRef[]>({
    id: "link",
    operators: LINK_OPERATORS,
    value: () => z.array(linkRefSchema),
    defaultValue: [],
  }),
  make<unknown, FormulaConfig>({
    id: "formula",
    operators: [...NUMBER_OPERATORS, ...TEXT_OPERATORS, ...BOOLEAN_OPERATORS, ...DATE_OPERATORS],
    configSchema: z.object({
      resultType: z.enum(["number", "text", "boolean", "date"]),
      precision: z.number().int().min(0).max(10).optional(),
    }),
    defaultConfig: { resultType: "text" },
    value: () => z.union([z.number(), z.string(), z.boolean()]),
    parse: () => ({ ok: false, error: "Formula columns are read-only" }),
  }),
];

export function createDefaultRegistry(): FieldTypeRegistry {
  return createFieldTypeRegistry([...builtinFieldTypes]);
}

export function getColumnFieldType(column: ColumnDef, registry: FieldTypeRegistry): AnyFieldType | undefined {
  if (column.type === "formula") {
    const rt = (column.config as Partial<FormulaConfig> | null)?.resultType ?? "text";
    const mapped = rt === "date" ? "datetime" : rt;
    return registry.get(mapped);
  }
  return registry.get(column.type);
}

export function getColumnOperators(column: ColumnDef, registry: FieldTypeRegistry): readonly FilterOperatorDef[] {
  return getColumnFieldType(column, registry)?.operators ?? [];
}

export const UNIVERSAL_AGGREGATIONS: readonly AggregationId[] = ["count", "countEmpty", "countFilled"];
export function isAggregationAllowed(fieldType: AnyFieldType | undefined, agg: AggregationId): boolean {
  if (UNIVERSAL_AGGREGATIONS.includes(agg)) return true;
  return fieldType?.aggregations?.includes(agg) ?? false;
}
