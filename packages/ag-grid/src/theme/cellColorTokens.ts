/**
 * v0.4 cell colors: the palette's design tokens. Each `CellColor` is a soft
 * background fill (text keeps the foreground color) with a light and a dark
 * variant, plus a saturated `swatch` for pickers and legends.
 *
 * The grid's CSS reads `--sg-color-<name>` with the LIGHT value as fallback
 * (see `classNames.ts`), so a dark host sets the variables itself:
 * `cellColorCssVariables("dark")` returns exactly that map (the UI kits'
 * theme bridges spread it next to their other `--sg-*` variables).
 *
 * Lives apart from `theme.ts` because `classNames.ts` needs the fallbacks
 * and `theme.ts` imports `classNames.ts`; `theme.ts` re-exports everything.
 */
import { CELL_COLORS, type CellColor } from "../internal/core";

export interface CellColorToken {
  /** Human label ("Red"). */
  label: string;
  /** Cell background on a light surface. */
  light: string;
  /** Cell background on a dark surface (translucent, so hover/selection still read). */
  dark: string;
  /** Saturated swatch color for pickers / legends (both schemes). */
  swatch: string;
}

export const CELL_COLOR_TOKENS: Readonly<Record<CellColor, CellColorToken>> = Object.freeze({
  red: { label: "Red", light: "#fee2e2", dark: "rgba(239, 68, 68, 0.24)", swatch: "#ef4444" },
  orange: { label: "Orange", light: "#ffedd5", dark: "rgba(249, 115, 22, 0.24)", swatch: "#f97316" },
  yellow: { label: "Yellow", light: "#fef9c3", dark: "rgba(234, 179, 8, 0.22)", swatch: "#eab308" },
  green: { label: "Green", light: "#dcfce7", dark: "rgba(34, 197, 94, 0.22)", swatch: "#22c55e" },
  teal: { label: "Teal", light: "#ccfbf1", dark: "rgba(20, 184, 166, 0.22)", swatch: "#14b8a6" },
  blue: { label: "Blue", light: "#dbeafe", dark: "rgba(59, 130, 246, 0.24)", swatch: "#3b82f6" },
  purple: { label: "Purple", light: "#f3e8ff", dark: "rgba(168, 85, 247, 0.24)", swatch: "#a855f7" },
  pink: { label: "Pink", light: "#fce7f3", dark: "rgba(236, 72, 153, 0.24)", swatch: "#ec4899" },
  gray: { label: "Gray", light: "#f4f4f5", dark: "rgba(161, 161, 170, 0.22)", swatch: "#a1a1aa" },
});

/** The CSS custom property holding a color's cell background (`--sg-color-red`). */
export function cellColorVar(color: CellColor): `--sg-color-${CellColor}` {
  return `--sg-color-${color}`;
}

/** `--sg-color-<name>` → background for every palette color, for the given scheme. */
export function cellColorCssVariables(scheme: "light" | "dark" = "light"): Record<`--sg-color-${CellColor}`, string> {
  const out = {} as Record<`--sg-color-${CellColor}`, string>;
  for (const color of CELL_COLORS) out[cellColorVar(color)] = CELL_COLOR_TOKENS[color][scheme];
  return out;
}
