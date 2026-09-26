import type { MantineTheme } from "@mantine/core";
import { type Option, type PermissionUser, canSetOption } from "./core-contracts";

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

/** "counsellor" → "Counsellor", "finance_team" → "Finance team". */
const roleLabel = (role: string): string => {
  const words = role.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** "Only Admin can set this" when `user` may not set `option` (v0.3 `settableBy`), else null. */
export function optionLockReason(option: Option, user: PermissionUser | undefined): string | null {
  if (canSetOption(option, user)) return null;
  const roles = option.settableBy && option.settableBy !== "all" ? option.settableBy.roles.map(roleLabel) : [];
  if (roles.length === 0) return "Nobody can set this";
  return `Only ${roles.length === 1 ? roles[0] : `${roles.slice(0, -1).join(", ")} or ${roles[roles.length - 1]}`} can set this`;
}

const idsOf = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/**
 * The options a picker offers `user`: every option they may set, plus the
 * ones already in `current` (shown, but locked: `lockReason`). Options the
 * user can neither set nor already holds are left out entirely.
 */
export function pickableOptions(
  options: readonly Option[],
  user: PermissionUser | undefined,
  current: unknown,
): { option: Option; lockReason: string | null }[] {
  const held = new Set(idsOf(current));
  const out: { option: Option; lockReason: string | null }[] = [];
  for (const option of options) {
    const lockReason = optionLockReason(option, user);
    if (lockReason === null || held.has(option.id)) out.push({ option, lockReason });
  }
  return out;
}
