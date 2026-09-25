import { z } from "zod";
import type { ZodType } from "zod";
import {
  BOOLEAN_OPERATORS,
  DATE_OPERATORS,
  type FilterOperatorDef,
  NUMBER_OPERATORS,
  TEXT_OPERATORS,
} from "../../filter/operators";
import type { FormulaResultType } from "../../formula/types";
import type { AnyFieldType, FieldType } from "../types";
import { booleanFieldType } from "./boolean";
import { resolveConfig } from "./config";
import { dateFieldType } from "./date";
import { datetimeFieldType } from "./datetime";
import { numberFieldType } from "./number";
import { textFieldType } from "./text";

export interface FormulaConfig {
  /** Set by the column builder from `inferResultType` when the column is saved. */
  resultType: FormulaResultType;
  /** Decimal places for number results. */
  precision?: number;
}

/** A materialised formula value. */
export type FormulaCellValue = number | string | boolean;

const defaultConfig: FormulaConfig = { resultType: "text" };

const RESULT_TYPES = ["number", "text", "boolean", "date"] as const;

const configSchema: ZodType<FormulaConfig> = z.object({
  resultType: z.enum(RESULT_TYPES),
  precision: z
    .number()
    .refine((n) => Number.isInteger(n) && n >= 0 && n <= 10, "precision must be 0-10")
    .optional(),
});

function resolve(config: unknown): FormulaConfig {
  const c = resolveConfig(defaultConfig, config);
  return (RESULT_TYPES as readonly string[]).includes(c.resultType) ? c : { ...c, resultType: "text" };
}

/** The built-in type a formula result delegates to, with its config. */
function delegate(config: unknown, value?: unknown): { type: AnyFieldType; config: unknown } {
  const c = resolve(config);
  switch (c.resultType) {
    case "number":
      return {
        type: numberFieldType as AnyFieldType,
        config: { ...numberFieldType.defaultConfig, precision: c.precision ?? 0 },
      };
    case "boolean":
      return { type: booleanFieldType as AnyFieldType, config: booleanFieldType.defaultConfig };
    case "date":
      return typeof value === "string" && value.length === 10
        ? { type: dateFieldType as AnyFieldType, config: dateFieldType.defaultConfig }
        : { type: datetimeFieldType as AnyFieldType, config: datetimeFieldType.defaultConfig };
    default:
      return { type: textFieldType as AnyFieldType, config: textFieldType.defaultConfig };
  }
}

function unionOperators(...sets: (readonly FilterOperatorDef[])[]): readonly FilterOperatorDef[] {
  const seen = new Map<string, FilterOperatorDef>();
  for (const set of sets) for (const op of set) if (!seen.has(op.id)) seen.set(op.id, op);
  return Object.freeze([...seen.values()]);
}

/**
 * Read-only computed column. Value semantics (validation, format, compare)
 * delegate to the type of `config.resultType`: number → number, text → text,
 * boolean → boolean, date → datetime (or date for "YYYY-MM-DD" values).
 * Per-column operators and aggregations resolve through `getColumnOperators`
 * / `getColumnAggregations`; the static `operators` is the union of all result types'.
 */
export const formulaFieldType: FieldType<FormulaCellValue, FormulaConfig> = {
  id: "formula",
  label: "Formula",
  configSchema,
  defaultConfig,
  valueSchema(config) {
    const c = resolve(config);
    if (c.resultType === "date") {
      return z.nullable(
        z.string().refine((s) => {
          const d = delegate(c, s);
          return d.type.valueSchema(d.config).safeParse(s).success;
        }, "Invalid date"),
      ) as ZodType<FormulaCellValue | null>;
    }
    const d = delegate(c);
    return d.type.valueSchema(d.config) as ZodType<FormulaCellValue | null>;
  },
  parse: () => ({ ok: false, error: "Formula columns are read-only" }),
  format(value, config) {
    const d = delegate(config, value);
    try {
      return d.type.format(value, d.config);
    } catch {
      return value === null || value === undefined ? "" : String(value);
    }
  },
  serialize: (value) => value,
  deserialize: (raw) =>
    typeof raw === "number" || typeof raw === "string" || typeof raw === "boolean" ? raw : null,
  compare(a, b, config) {
    const d = delegate(config, typeof a === "string" ? a : b);
    return d.type.compare(a, b, d.config);
  },
  operators: unionOperators(NUMBER_OPERATORS, TEXT_OPERATORS, BOOLEAN_OPERATORS, DATE_OPERATORS),
  defaultValue: () => null,
};
