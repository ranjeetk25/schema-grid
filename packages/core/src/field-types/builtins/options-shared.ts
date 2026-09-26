import { z, type ZodType } from "zod";
import type { Option } from "../../common/types";

const roleRuleSchema = z.union([z.literal("all"), z.object({ roles: z.array(z.string()) })]);

export const optionSchema: ZodType<Option> = z.object({
  id: z.string().min(1),
  label: z.string(),
  color: z.string().optional(),
  settableBy: roleRuleSchema.optional(),
});

export interface OptionsConfig {
  options: Option[];
}

export const optionsConfigSchema: ZodType<OptionsConfig> = z
  .object({
    options: z.array(optionSchema),
  })
  .refine(
    (config) => new Set(config.options.map((o) => o.id)).size === config.options.length,
    { message: "option ids must be unique" },
  );

/**
 * Finds an option in `options` matching `text`: an exact id match first,
 * then a case-insensitive, trimmed label match. Returns `undefined` when
 * neither matches.
 */
/** Filters a runtime (possibly malformed) options value down to valid Options. */
export function safeOptions(options: unknown): Option[] {
  if (!Array.isArray(options)) return [];
  return options.filter(
    (o): o is Option =>
      typeof o === "object" && o !== null && typeof o.id === "string" && typeof o.label === "string",
  );
}

export function findOptionByIdOrLabel(input: readonly Option[], text: string): Option | undefined {
  const options = safeOptions(input);
  const byId = options.find((o) => o.id === text);
  if (byId) return byId;
  const needle = text.trim().toLowerCase();
  return options.find((o) => o.label.trim().toLowerCase() === needle);
}

/**
 * Compares two option ids by their order in `options` (config order).
 * Unknown ids sort after all known ids, in a stable manner relative to each
 * other (by string comparison, so ordering is deterministic).
 */
export function compareByOptionOrder(a: string, b: string, input: readonly Option[]): number {
  const options = safeOptions(input);
  const indexA = options.findIndex((o) => o.id === a);
  const indexB = options.findIndex((o) => o.id === b);
  const rankA = indexA === -1 ? options.length : indexA;
  const rankB = indexB === -1 ? options.length : indexB;
  if (rankA !== rankB) return rankA - rankB;
  if (rankA === options.length) {
    // Both unknown: fall back to a stable, deterministic order.
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return 0;
}
