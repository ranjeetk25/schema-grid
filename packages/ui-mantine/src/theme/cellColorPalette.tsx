/**
 * v0.4 cell colors: the palette as the kit displays it (label + swatch per
 * `CellColor`), from the same tokens the grid paints with
 * (`CELL_COLOR_TOKENS`). A swatch is filled with the cell background
 * (`var(--sg-color-<name>)`, which `mantineGridCssVariablesResolver` sets
 * per colour scheme) and ringed with the saturated `swatch` color, so it
 * looks like the painted cell in light and dark mode alike.
 */
import type { CSSProperties } from "react";
import { CELL_COLOR_TOKENS, cellColorVar } from "../internal/color-contracts";
import { CELL_COLORS, type CellColor } from "../internal/core-contracts";

export interface CellColorPaletteEntry {
  color: CellColor;
  /** Human label ("Red"). */
  label: string;
  /** Saturated swatch color (pickers, legends). */
  swatch: string;
  /** The cell background as CSS: the scheme's `--sg-color-<name>`, light token as fallback. */
  fill: string;
}

/** Every `CellColor` in palette order. */
export const CELL_COLOR_PALETTE: readonly CellColorPaletteEntry[] =
  Object.freeze(
    CELL_COLORS.map((color) => ({
      color,
      label: CELL_COLOR_TOKENS[color].label,
      swatch: CELL_COLOR_TOKENS[color].swatch,
      fill: `var(${cellColorVar(color)}, ${CELL_COLOR_TOKENS[color].light})`,
    })),
  );

/** "Red", or "No color" for null. */
export function cellColorLabel(color: CellColor | null): string {
  return color === null ? "No color" : CELL_COLOR_TOKENS[color].label;
}

export interface CellColorSwatchProps {
  /** null draws the "no color" mark (a struck-through empty chip). */
  color: CellColor | null;
  /** Edge length in px. Default 16. */
  size?: number;
  /** Accessible name; without one the swatch is decorative (`aria-hidden`). */
  title?: string;
  style?: CSSProperties;
}

const NONE_FILL =
  "linear-gradient(to top right, transparent calc(50% - 1px), var(--mantine-color-dimmed) calc(50% - 1px), var(--mantine-color-dimmed) calc(50% + 1px), transparent calc(50% + 1px))";

/** One palette chip. */
export function CellColorSwatch({
  color,
  size = 16,
  title,
  style,
}: CellColorSwatchProps) {
  const token = color ? CELL_COLOR_TOKENS[color] : null;
  const fill = color
    ? `var(${cellColorVar(color)}, ${CELL_COLOR_TOKENS[color].light})`
    : NONE_FILL;
  return (
    <span
      data-color={color ?? "none"}
      {...(title
        ? { role: "img", "aria-label": title, title }
        : { "aria-hidden": true })}
      style={{
        display: "inline-block",
        flex: "none",
        width: size,
        height: size,
        borderRadius: 4,
        background: fill,
        boxShadow: `inset 0 0 0 1.5px ${token ? token.swatch : "var(--mantine-color-default-border)"}`,
        ...style,
      }}
    />
  );
}
