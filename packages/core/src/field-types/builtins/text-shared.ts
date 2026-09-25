import { z } from "zod";
import type { ZodType } from "zod";
import { TEXT_OPERATORS } from "../../filter/operators";
import { compareWithEmptyLast } from "../empty";
import type { FieldType, ParseResult } from "../types";
import { resolveConfig } from "./config";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Case-insensitive, numeric-aware string compare. */
export function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

export interface TextLikeConfig {
  maxLength?: number;
  minLength?: number;
}

const lengthSchema = z
  .number()
  .refine((n) => Number.isInteger(n) && n >= 0, "Must be a non-negative integer")
  .optional();

export const textLikeConfigSchema: ZodType<TextLikeConfig> = z.object({
  maxLength: lengthSchema,
  minLength: lengthSchema,
});

/** Converts a primitive input to a string, or undefined when it can't. */
export function inputToText(input: unknown): string | null | undefined {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return input;
  if (typeof input === "number") return Number.isFinite(input) ? String(input) : undefined;
  if (typeof input === "boolean" || typeof input === "bigint") return String(input);
  return undefined;
}

export function textValueSchema(config: TextLikeConfig): ZodType<string | null> {
  const { maxLength, minLength } = config;
  return z.nullable(
    z
      .string()
      .refine((s) => maxLength === undefined || s.length <= maxLength, "Text is too long")
      .refine((s) => minLength === undefined || s.length >= minLength, "Text is too short"),
  );
}

export function makeTextLikeType(opts: {
  id: "text" | "longText";
  label: string;
  normalize: (s: string) => string;
}): FieldType<string, TextLikeConfig> {
  const defaultConfig: TextLikeConfig = {};
  return {
    id: opts.id,
    label: opts.label,
    configSchema: textLikeConfigSchema,
    defaultConfig,
    valueSchema: (config) => textValueSchema(resolveConfig(defaultConfig, config)),
    parse(input, config): ParseResult<string | null> {
      const c = resolveConfig(defaultConfig, config);
      const raw = inputToText(input);
      if (raw === undefined) return { ok: false, error: "Not a text value" };
      if (raw === null) return { ok: true, value: null };
      const value = opts.normalize(raw).trim();
      if (value === "") return { ok: true, value: null };
      if (typeof c.maxLength === "number" && value.length > c.maxLength) {
        return { ok: false, error: `Text exceeds ${c.maxLength} characters` };
      }
      return { ok: true, value };
    },
    format: (value) => (typeof value === "string" ? value : ""),
    serialize: (value) => value,
    deserialize: (raw) => (typeof raw === "string" ? raw : null),
    compare: (a, b) =>
      compareWithEmptyLast(a, b, (x, y) => compareText(String(x), String(y))),
    operators: TEXT_OPERATORS,
    defaultValue: () => null,
  };
}

