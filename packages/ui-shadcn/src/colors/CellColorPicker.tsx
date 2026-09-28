import { CheckIcon } from "lucide-react";
import type { CellColor } from "../internal/core-contracts";
import { cn } from "../lib/cn";
import { CELL_COLOR_PALETTE, ColorSwatch } from "../theme/cellColors";

export interface CellColorPickerProps {
  /** Picked color (`null` = "No color"); `undefined` marks nothing. */
  value?: CellColor | null;
  onPick(color: CellColor | null): void;
  /** Show the "No color" button. Default true. */
  allowNone?: boolean;
  /** Accessible name of the swatch group. Default "Colors". */
  "aria-label"?: string;
  className?: string;
}

const SWATCH_BUTTON = cn(
  "sg:grid sg:size-7 sg:place-items-center sg:rounded-md sg:border sg:border-transparent sg:outline-none",
  "sg:transition-colors sg:hover:border-input-hover sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
  "sg:aria-pressed:border-primary",
);

/**
 * The palette as a 9-swatch grid (one named toggle button per color, in
 * core order) plus a "No color" row. Used by the toolbar paint popover and
 * the rules editor's color picker.
 */
export function CellColorPicker({ value, onPick, allowNone = true, className, ...rest }: CellColorPickerProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of toggle buttons, not a form fieldset
    <div role="group" aria-label={rest["aria-label"] ?? "Colors"} className={cn("sg:flex sg:flex-col sg:gap-1.5", className)}>
      <div className="sg:grid sg:grid-cols-9 sg:gap-1">
        {CELL_COLOR_PALETTE.map((p) => (
          <button
            key={p.color}
            type="button"
            aria-label={p.label}
            title={p.label}
            aria-pressed={value === undefined ? undefined : value === p.color}
            className={SWATCH_BUTTON}
            onClick={() => onPick(p.color)}
          >
            <ColorSwatch color={p.color} className="sg:size-5" />
          </button>
        ))}
      </div>
      {allowNone ? (
        <button
          type="button"
          aria-label="No color"
          aria-pressed={value === undefined ? undefined : value === null}
          className={cn(
            "sg:flex sg:h-7 sg:items-center sg:gap-2 sg:rounded-md sg:px-1.5 sg:text-sm sg:text-foreground sg:outline-none",
            "sg:hover:bg-muted sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
          )}
          onClick={() => onPick(null)}
        >
          <ColorSwatch color={null} />
          <span className="sg:flex-1 sg:text-left">No color</span>
          {value === null ? <CheckIcon aria-hidden className="sg:size-3.5 sg:text-primary" /> : null}
        </button>
      ) : null}
    </div>
  );
}
