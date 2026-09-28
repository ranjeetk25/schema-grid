/**
 * v0.4 cell colors, kit side: the palette every color surface shows (paint
 * popover, rules editor, filter-by-color pickers, header submenu), built from
 * ag-grid's `CELL_COLOR_TOKENS` so a swatch is exactly the grid's color.
 * The cell backgrounds themselves come from `--sg-color-*`, declared for
 * both schemes in `styles/tokens.css` (and returned by
 * `useGridThemeFromShadcn().cellColorVariables`).
 */
import type { CSSProperties } from "react";
import { CELL_COLORS, type CellColor } from "../internal/core-contracts";
import { CELL_COLOR_TOKENS, type CellColorToken } from "../internal/grid-contracts";
import { cn } from "../lib/cn";

export interface CellColorPaletteEntry extends CellColorToken {
  color: CellColor;
}

/** Every `CellColor` in core order, with its label, light / dark fills and swatch. */
export const CELL_COLOR_PALETTE: readonly CellColorPaletteEntry[] = Object.freeze(
  CELL_COLORS.map((color) => ({ color, ...CELL_COLOR_TOKENS[color] })),
);

/** "Red", "Teal"… */
export function cellColorLabel(color: CellColor): string {
  return CELL_COLOR_TOKENS[color]?.label ?? color;
}

export interface CellColorSwatchProps {
  /** `null` draws the "No color" swatch (hollow, struck through). */
  color: CellColor | null;
  className?: string;
}

/** A decorative rounded swatch in the palette's saturated color. */
export function CellColorSwatch({ color, className }: CellColorSwatchProps) {
  const style = color ? ({ "--sg-swatch": CELL_COLOR_TOKENS[color].swatch } as CSSProperties) : undefined;
  return (
    <span
      aria-hidden
      data-color={color ?? "none"}
      style={style}
      className={cn(
        "sg:inline-block sg:size-3.5 sg:shrink-0 sg:rounded-sm",
        color
          ? "sg:bg-[var(--sg-swatch)] sg:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]"
          : "sg:border sg:border-input-hover sg:bg-[linear-gradient(to_top_right,transparent_calc(50%-0.5px),var(--sg-ui-danger)_50%,transparent_calc(50%+0.5px))]",
        className,
      )}
    />
  );
}
