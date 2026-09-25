import { z, type ZodType } from "zod";
import type { FieldType, ParseResult } from "../types";
import { MULTI_SELECT_OPERATORS } from "../../filter/operators";
import { compareWithEmptyLast } from "../empty";
import { resolveConfig } from "./config";
import { findOptionByIdOrLabel, optionSchema, safeOptions, type OptionsConfig } from "./options-shared";

export interface MultiSelectConfig extends OptionsConfig {
  allowCreate?: boolean;
}

const defaultConfig: MultiSelectConfig = { options: [], allowCreate: false };

export const multiSelectConfigSchema: ZodType<MultiSelectConfig> = z
  .object({
    options: z.array(optionSchema),
    allowCreate: z.boolean().optional(),
  })
  .refine((config) => new Set(config.options.map((o) => o.id)).size === config.options.length, {
    message: "option ids must be unique",
  });

/** Splits a free-form string into candidate tokens (comma/semicolon/newline-separated). */
function splitTokens(input: string): string[] {
  return input
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toRawTokens(input: unknown): string[] | null {
  if (input === null || input === undefined) return [];
  if (Array.isArray(input)) {
    return input.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  }
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map((v) => v.trim());
      }
    } catch {
      // fall through to delimiter splitting
    }
  }
  return splitTokens(trimmed);
}

function sortByConfigOrder(ids: string[], options: OptionsConfig["options"]): string[] {
  return [...ids].sort((a, b) => {
    const indexA = options.findIndex((o) => o.id === a);
    const indexB = options.findIndex((o) => o.id === b);
    return indexA - indexB;
  });
}

export const multiSelectFieldType: FieldType<string[], MultiSelectConfig> = {
  id: "multiSelect",
  label: "Multi-select",
  configSchema: multiSelectConfigSchema,
  defaultConfig,

  valueSchema(config: MultiSelectConfig): ZodType<string[] | null> {
    const c = resolveConfig(defaultConfig, config);
    const ids = new Set(safeOptions(c.options).map((o) => o.id));
    return z
      .array(z.string())
      .nullable()
      .refine((v) => v === null || c.allowCreate || v.every((id) => ids.has(id)), {
        message: "all values must be existing option ids",
      });
  },

  parse(input: unknown, config: MultiSelectConfig): ParseResult<string[]> {
    const c = resolveConfig(defaultConfig, config);
    const tokens = toRawTokens(input);
    if (tokens === null) {
      return { ok: false, error: "multiSelect value must be a string or an array" };
    }
    if (tokens.length === 0) return { ok: true, value: [] };

    const knownIds = new Set<string>();
    const pendingLabels: string[] = [];
    for (const token of tokens) {
      const option = findOptionByIdOrLabel(safeOptions(c.options), token);
      if (option) {
        knownIds.add(option.id);
        continue;
      }
      if (!c.allowCreate) {
        return { ok: false, error: `"${token}" does not match any option` };
      }
      if (!pendingLabels.includes(token)) pendingLabels.push(token);
    }

    const sortedKnown = sortByConfigOrder([...knownIds], safeOptions(c.options));
    const value = [...sortedKnown, ...pendingLabels];
    if (pendingLabels.length > 0) {
      return { ok: true, value, pendingOptions: pendingLabels };
    }
    return { ok: true, value };
  },

  format(value: string[] | null | undefined, config: MultiSelectConfig): string {
    if (value === null || value === undefined || value.length === 0) return "";
    const c = resolveConfig(defaultConfig, config);
    return value
      .map((id) => safeOptions(c.options).find((o) => o.id === id)?.label ?? id)
      .join(", ");
  },

  serialize(value: string[] | null): unknown {
    return value === null ? null : [...value];
  },

  deserialize(raw: unknown): string[] | null {
    if (!Array.isArray(raw)) return null;
    return raw.filter((v): v is string => typeof v === "string");
  },

  compare(a: string[] | null, b: string[] | null, config: MultiSelectConfig): number {
    const c = resolveConfig(defaultConfig, config);
    return compareWithEmptyLast(a, b, (x, y) => {
      const arrX = x as string[];
      const arrY = y as string[];
      const firstX = arrX[0];
      const firstY = arrY[0];
      if (firstX !== undefined && firstY !== undefined) {
        const indexX = safeOptions(c.options).findIndex((o) => o.id === firstX);
        const indexY = safeOptions(c.options).findIndex((o) => o.id === firstY);
        const rankX = indexX === -1 ? safeOptions(c.options).length : indexX;
        const rankY = indexY === -1 ? safeOptions(c.options).length : indexY;
        if (rankX !== rankY) return rankX - rankY;
      }
      return arrX.length - arrY.length;
    });
  },

  operators: MULTI_SELECT_OPERATORS,

  defaultValue(): string[] {
    return [];
  },
};
