import { z, type ZodType } from "zod";
import { NUMBER_OPERATORS } from "../../filter/operators";
import type { AggregationId } from "../../query/types";
import type { FieldType, ParseResult } from "../types";
import { compareWithEmptyLast } from "../empty";
import { resolveConfig } from "./config";
import { filterNumericSeeds, fillSeriesLinear, parseNumberInput } from "./number-shared";

export interface CurrencyConfig {
  /** ISO 4217 currency code, e.g. "INR". */
  currencyCode: string;
  locale: string;
  /** Decimal places shown/enforced when formatting. */
  precision: number;
  /** Optional validation limits, merged in from `ColumnValidation`. */
  min?: number;
  max?: number;
}

const defaultConfig: CurrencyConfig = {
  currencyCode: "INR",
  locale: "en-IN",
  precision: 2,
};

const configSchema: ZodType<CurrencyConfig> = z.object({
  currencyCode: z.string(),
  locale: z.string(),
  precision: z.number().min(0).max(10),
  min: z.number().optional(),
  max: z.number().optional(),
});

function valueSchema(config: CurrencyConfig): ZodType<number | null> {
  const c = resolveConfig(defaultConfig, config);
  return z
    .union([z.number(), z.null()])
    .refine((v) => v === null || Number.isFinite(v), { message: "Must be a finite number" })
    .refine((v) => v === null || c.min === undefined || v >= c.min, { message: "Below minimum" })
    .refine((v) => v === null || c.max === undefined || v <= c.max, { message: "Above maximum" });
}

function parse(input: unknown, _config: CurrencyConfig): ParseResult<number | null> {
  return parseNumberInput(input);
}

function format(value: number | null | undefined, config: CurrencyConfig): string {
  if (value === null || value === undefined) return "";
  const c = resolveConfig(defaultConfig, config);
  return new Intl.NumberFormat(c.locale, {
    style: "currency",
    currency: c.currencyCode,
    minimumFractionDigits: c.precision,
    maximumFractionDigits: c.precision,
  }).format(value);
}

function serialize(value: number | null): unknown {
  return value;
}

function deserialize(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (raw.trim().length > 0 && Number.isFinite(n)) return n;
  }
  return null;
}

function compare(a: number | null, b: number | null, _config: CurrencyConfig): number {
  return compareWithEmptyLast(a, b, (x, y) => (x as number) - (y as number));
}

function defaultValue(_config: CurrencyConfig): number | null {
  return null;
}

function fillSeries(values: (number | null)[], count: number, _config: CurrencyConfig): number[] {
  return fillSeriesLinear(filterNumericSeeds(values), count);
}

const aggregations: readonly AggregationId[] = [
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "countEmpty",
  "countFilled",
];

export const currencyFieldType: FieldType<number, CurrencyConfig> = {
  id: "currency",
  label: "Currency",
  configSchema,
  defaultConfig,
  valueSchema,
  parse,
  format,
  serialize,
  deserialize,
  compare,
  operators: NUMBER_OPERATORS,
  fillSeries,
  aggregations,
  defaultValue,
};
