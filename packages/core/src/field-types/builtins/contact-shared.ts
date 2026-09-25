import { z } from "zod";
import type { ZodType } from "zod";
import { TEXT_OPERATORS } from "../../filter/operators";
import { compareWithEmptyLast } from "../empty";
import type { FieldType, ParseResult } from "../types";
import { resolveConfig } from "./config";
import { compareText, inputToText } from "./text-shared";

/** Builds a validated single-line text type (url/email/phone). */
export function makeContactType<TConfig extends object>(opts: {
  id: "url" | "email" | "phone";
  label: string;
  configSchema: ZodType<TConfig>;
  defaultConfig: TConfig;
  /** Normalises trimmed, non-empty text; returns null when invalid. */
  normalize: (text: string, config: TConfig) => string | null;
  /** True for an already-normalised stored value. */
  isValid: (value: string) => boolean;
  errorMessage: string;
}): FieldType<string, TConfig> {
  const { defaultConfig } = opts;
  return {
    id: opts.id,
    label: opts.label,
    configSchema: opts.configSchema,
    defaultConfig,
    valueSchema: () => z.nullable(z.string().refine(opts.isValid, opts.errorMessage)),
    parse(input, config): ParseResult<string | null> {
      const raw = inputToText(input);
      if (raw === undefined) return { ok: false, error: opts.errorMessage };
      if (raw === null) return { ok: true, value: null };
      const text = raw.trim();
      if (text === "" || text.length > 2048) {
        return text === "" ? { ok: true, value: null } : { ok: false, error: opts.errorMessage };
      }
      const value = opts.normalize(text, resolveConfig(defaultConfig, config));
      return value === null ? { ok: false, error: opts.errorMessage } : { ok: true, value };
    },
    format: (value) => (typeof value === "string" ? value : ""),
    serialize: (value) => value,
    deserialize: (raw) => (typeof raw === "string" ? raw : null),
    compare: (a, b) => compareWithEmptyLast(a, b, (x, y) => compareText(String(x), String(y))),
    operators: TEXT_OPERATORS,
    defaultValue: () => null,
  };
}
