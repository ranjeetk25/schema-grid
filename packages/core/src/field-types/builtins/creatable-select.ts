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

export type CreatableSelectConfig = OptionsConfig;

const defaultConfig: CreatableSelectConfig = { options: [] };

export const creatableSelectFieldType: FieldType<string, CreatableSelectConfig> = {
  id: "creatableSelect",
  label: "Creatable select",
  configSchema: optionsConfigSchema,
  defaultConfig,

  valueSchema(): ZodType<string | null> {
    return z
      .string()
      .nullable()
      .refine((v) => v === null || v.trim().length > 0, {
        message: "value must be a non-empty string",
      });
  },

  parse(input: unknown, config: CreatableSelectConfig): ParseResult<string | null> {
    const c = resolveConfig(defaultConfig, config);
    if (input === null || input === undefined) return { ok: true, value: null };
    if (typeof input !== "string") {
      return { ok: false, error: "creatableSelect value must be a string" };
    }
    const trimmed = input.trim();
    if (trimmed.length === 0) return { ok: true, value: null };
    const option = findOptionByIdOrLabel(safeOptions(c.options), trimmed);
    if (option) return { ok: true, value: option.id };
    // Unknown label: return a label placeholder. Caller is expected to
    // create the option and swap this placeholder for the new option id.
    return { ok: true, value: trimmed, pendingOptions: [trimmed] };
  },

  format(value: string | null | undefined, config: CreatableSelectConfig): string {
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

  compare(a: string | null, b: string | null, config: CreatableSelectConfig): number {
    const c = resolveConfig(defaultConfig, config);
    return compareWithEmptyLast(a, b, (x, y) => compareByOptionOrder(x as string, y as string, safeOptions(c.options)));
  },

  operators: SELECT_OPERATORS,

  defaultValue(): string | null {
    return null;
  },
};
