import { z, type ZodType } from "zod";
import { BOOLEAN_OPERATORS } from "../../filter/operators";
import type { FieldType, ParseResult } from "../types";
import { compareWithEmptyLast } from "../empty";

export type BooleanConfig = Record<string, never>;

const defaultConfig: BooleanConfig = {};

const configSchema: ZodType<BooleanConfig> = z.object({});

function valueSchema(_config: BooleanConfig): ZodType<boolean | null> {
  return z.union([z.boolean(), z.null()]);
}

const TRUE_STRINGS = new Set(["true", "yes", "y", "1", "checked", "✓"]);
const FALSE_STRINGS = new Set(["false", "no", "n", "0"]);

function parse(input: unknown, _config: BooleanConfig): ParseResult<boolean | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input === "boolean") return { ok: true, value: input };
  if (typeof input === "number") {
    if (input === 1) return { ok: true, value: true };
    if (input === 0) return { ok: true, value: false };
    return { ok: false, error: "Cannot parse number as boolean" };
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length === 0) return { ok: false, error: "Value is empty" };
    const lower = trimmed.toLowerCase();
    if (TRUE_STRINGS.has(lower)) return { ok: true, value: true };
    if (FALSE_STRINGS.has(lower)) return { ok: true, value: false };
    return { ok: false, error: `Cannot parse "${input}" as a boolean` };
  }
  return { ok: false, error: "Invalid boolean" };
}

function format(value: boolean | null | undefined, _config: BooleanConfig): string {
  if (value === null || value === undefined) return "";
  return value ? "true" : "false";
}

function serialize(value: boolean | null): unknown {
  return value;
}

function deserialize(raw: unknown): boolean | null {
  return typeof raw === "boolean" ? raw : null;
}

function compare(a: boolean | null, b: boolean | null, _config: BooleanConfig): number {
  return compareWithEmptyLast(a, b, (x, y) => {
    if (x === y) return 0;
    return x ? 1 : -1;
  });
}

function defaultValue(_config: BooleanConfig): boolean | null {
  return false;
}

export const booleanFieldType: FieldType<boolean, BooleanConfig> = {
  id: "boolean",
  label: "Boolean",
  configSchema,
  defaultConfig,
  valueSchema,
  parse,
  format,
  serialize,
  deserialize,
  compare,
  operators: BOOLEAN_OPERATORS,
  defaultValue,
};
