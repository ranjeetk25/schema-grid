import type { CSSProperties } from "react";
import { type Option, type PermissionUser, canSetOption } from "./core-contracts";

/**
 * Named option tones, in swatch order. The names match the colour strings
 * core options already carry (`{ color: "green" }`), so schemas authored for
 * ui-mantine render the same here. Each maps to muted `--sg-tone-*` tokens.
 */
export const OPTION_TONES = [
  "gray",
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "grape",
  "pink",
] as const;

export type OptionTone = (typeof OPTION_TONES)[number];

const TONE_SET: ReadonlySet<string> = new Set(OPTION_TONES);

const isOption = (v: unknown): v is Option =>
  !!v && typeof v === "object" && typeof (v as Option).label === "string" && typeof (v as Option).id === "string";

/** Reads the core `{id, label, color?}[]` option list from a select-family config (the stored value is `id`). */
export function getSelectOptions(config: unknown): Option[] {
  if (!config || typeof config !== "object") return [];
  const options = (config as { options?: unknown }).options;
  return Array.isArray(options) ? options.filter(isOption) : [];
}

const CSS_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|var\(--)/i;

/** A named tone, a raw CSS colour, or `"gray"` as the fallback. */
export function resolveOptionColor(option: { color?: string | undefined } | null | undefined): string {
  const color = option?.color?.trim();
  if (!color) return "gray";
  if (TONE_SET.has(color)) return color;
  if (CSS_COLOR_RE.test(color)) return color;
  return "gray";
}

/**
 * Inline style that feeds `--sg-tone-bg/fg/dot` for an option: token-backed
 * for named tones (so dark mode retunes them), `color-mix` tints for raw CSS
 * colours.
 */
export function optionToneStyle(option: { color?: string | undefined } | null | undefined): CSSProperties {
  const color = resolveOptionColor(option);
  if (TONE_SET.has(color)) {
    return {
      "--sg-tone-bg": `var(--sg-tone-${color}-bg)`,
      "--sg-tone-fg": `var(--sg-tone-${color}-fg)`,
      "--sg-tone-dot": `var(--sg-tone-${color}-dot)`,
    } as CSSProperties;
  }
  return {
    "--sg-tone-bg": `color-mix(in srgb, ${color} 14%, transparent)`,
    "--sg-tone-fg": `color-mix(in srgb, ${color} 80%, var(--sg-ui-foreground))`,
    "--sg-tone-dot": color,
  } as CSSProperties;
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
