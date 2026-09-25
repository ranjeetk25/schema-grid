import { z, type ZodType } from "zod";
import { NUMBER_OPERATORS } from "../../filter/operators";
import type { AggregationId } from "../../query/types";
import type { FieldType, ParseResult } from "../types";
import { compareWithEmptyLast } from "../empty";
import { resolveConfig } from "./config";
import { filterNumericSeeds, fillSeriesLinear, parseNumberInput } from "./number-shared";

export interface NumberConfig {
  /** Decimal places shown/enforced when formatting, 0-10. */
  precision: number;
  useGrouping: boolean;
  locale: string;
  /** Optional validation limits, merged in from `ColumnValidation`. */
  min?: number;
  max?: number;
}

const defaultConfig: NumberConfig = {
  precision: 0,
  useGrouping: true,
  locale: "en-IN",
};

const configSchema: ZodType<NumberConfig> = z.object({
  precision: z.number().min(0).max(10),
  useGrouping: z.boolean(),
  locale: z.string(),
  min: z.number().optional(),
  max: z.number().optional(),
});

function valueSchema(config: NumberConfig): ZodType<number | null> {
  const c = resolveConfig(defaultConfig, config);
  return z
    .union([z.number(), z.null()])
    .refine((v) => v === null || Number.isFinite(v), { message: "Must be a finite number" })
    .refine((v) => v === null || c.min === undefined || v >= c.min, { message: "Below minimum" })
    .refine((v) => v === null || c.max === undefined || v <= c.max, { message: "Above maximum" });
}

function parse(input: unknown, _config: NumberConfig): ParseResult<number | null> {
  return parseNumberInput(input);
}

function format(value: number | null | undefined, config: NumberConfig): string {
  if (value === null || value === undefined) return "";
  const c = resolveConfig(defaultConfig, config);
  return new Intl.NumberFormat(c.locale, {
    minimumFractionDigits: c.precision,
    maximumFractionDigits: c.precision,
    useGrouping: c.useGrouping,
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

function compare(a: number | null, b: number | null, _config: NumberConfig): number {
  return compareWithEmptyLast(a, b, (x, y) => (x as number) - (y as number));
}

function defaultValue(_config: NumberConfig): number | null {
  return null;
}

function fillSeries(values: (number | null)[], count: number, _config: NumberConfig): number[] {
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

export const numberFieldType: FieldType<number, NumberConfig> = {
  id: "number",
  label: "Number",
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
