import { z, type ZodType } from "zod";
import type { FieldType, ParseResult } from "../types";
import { SELECT_OPERATORS } from "../../filter/operators";
import { compareWithEmptyLast } from "../empty";
import { resolveConfig } from "./config";
import {
  compareByOptionOrder,
  findOptionByIdOrLabel,
  safeOptions,
  optionsConfigSchema,
  type OptionsConfig,
} from "./options-shared";

export type SelectConfig = OptionsConfig;

const defaultConfig: SelectConfig = { options: [] };

export const selectFieldType: FieldType<string, SelectConfig> = {
  id: "select",
  label: "Select",
  configSchema: optionsConfigSchema,
  defaultConfig,

  valueSchema(config: SelectConfig): ZodType<string | null> {
    const c = resolveConfig(defaultConfig, config);
    const ids = new Set(safeOptions(c.options).map((o) => o.id));
    return z
      .string()
      .nullable()
      .refine((v) => v === null || ids.has(v), { message: "value must be an existing option id" });
  },

  parse(input: unknown, config: SelectConfig): ParseResult<string | null> {
    const c = resolveConfig(defaultConfig, config);
    if (input === null || input === undefined) return { ok: true, value: null };
    if (typeof input !== "string") {
      return { ok: false, error: "select value must be a string" };
    }
    const trimmed = input.trim();
    if (trimmed.length === 0) return { ok: true, value: null };
    const option = findOptionByIdOrLabel(safeOptions(c.options), trimmed);
    if (!option) {
      return { ok: false, error: `"${input}" does not match any option` };
    }
    return { ok: true, value: option.id };
  },

  format(value: string | null | undefined, config: SelectConfig): string {
    if (value === null || value === undefined) return "";
    const c = resolveConfig(defaultConfig, config);
    const option = safeOptions(c.options).find((o) => o.id === value);
    return option ? option.label : value;
  },

  serialize(value: string | null): unknown {
    return value;
  },

  deserialize(raw: unknown): string | null {
    return typeof raw === "string" ? raw : null;
  },

  compare(a: string | null, b: string | null, config: SelectConfig): number {
    const c = resolveConfig(defaultConfig, config);
    return compareWithEmptyLast(a, b, (x, y) => compareByOptionOrder(x as string, y as string, safeOptions(c.options)));
  },

  operators: SELECT_OPERATORS,

  defaultValue(): string | null {
    return null;
  },
};
