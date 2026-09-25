import type { MantineTheme } from "@mantine/core";
import type { SelectOption } from "./core-contracts";

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

const isOption = (v: unknown): v is SelectOption =>
  !!v && typeof v === "object" && typeof (v as SelectOption).label === "string" && typeof (v as SelectOption).value === "string";

/** Reads the `{label, value, color}[]` option list from a select-family config. */
export function getSelectOptions(config: unknown): SelectOption[] {
  if (!config || typeof config !== "object") return [];
  const options = (config as { options?: unknown }).options;
  return Array.isArray(options) ? options.filter(isOption) : [];
}

const CSS_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|var\(--)/i;

/** A Mantine named colour, a raw CSS colour, or `"gray"` as the fallback. */
export function resolveOptionColor(option: Pick<SelectOption, "color"> | null | undefined, theme: Pick<MantineTheme, "colors">): string {
  const color = option?.color?.trim();
  if (!color) return "gray";
  if (color in theme.colors) return color;
  if (CSS_COLOR_RE.test(color)) return color;
  return "gray";
}

export function findOption(options: SelectOption[], value: unknown): SelectOption | undefined {
  return options.find((o) => o.value === value);
}
