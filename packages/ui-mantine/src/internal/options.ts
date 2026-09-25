import type { MantineTheme } from "@mantine/core";
import type { Option } from "./core-contracts";

/** Mantine's default named palette, in swatch order. */
export const MANTINE_NAMED_COLORS = [
  "gray",
  "red",
  "pink",
  "grape",
  "violet",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "green",
  "lime",
  "yellow",
  "orange",
] as const;

const isOption = (v: unknown): v is Option =>
  !!v && typeof v === "object" && typeof (v as Option).label === "string" && typeof (v as Option).id === "string";

/**
 * Reads the core `{id, label, color?}[]` option list from a select-family
 * config (the stored value is `id`). Options without an id, and repeated ids,
 * are dropped (first wins): a half-typed draft in the column panel can hold
 * them, and Mantine's Select throws on duplicate values.
 */
export function getSelectOptions(config: unknown): Option[] {
  if (!config || typeof config !== "object") return [];
  const options = (config as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const out: Option[] = [];
  for (const o of options) {
    if (!isOption(o) || o.id === "" || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

const CSS_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|var\(--)/i;

/** A Mantine named colour, a raw CSS colour, or `"gray"` as the fallback. */
export function resolveOptionColor(option: { color?: string | undefined } | null | undefined, theme: Pick<MantineTheme, "colors">): string {
  const color = option?.color?.trim();
  if (!color) return "gray";
  if (color in theme.colors) return color;
  if (CSS_COLOR_RE.test(color)) return color;
  return "gray";
}

export function findOption(options: readonly Option[], value: unknown): Option | undefined {
  return options.find((o) => o.id === value);
}
