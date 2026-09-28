import { MultiPicker, type PickerItem } from "../filter-builder/pickers";
import type { CellColor } from "../internal/core-contracts";
import { CELL_COLOR_PALETTE, CellColorSwatch } from "../theme/cellColors";

export interface ColorSwatchMultiSelectProps {
  value: readonly CellColor[];
  onChange(colors: CellColor[]): void;
  /** Default "Colors". */
  "aria-label"?: string;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}

const ITEMS: PickerItem[] = CELL_COLOR_PALETTE.map((p) => ({ value: p.color, label: p.label, icon: <CellColorSwatch color={p.color} /> }));

/**
 * Palette multi-select (cmdk list with a swatch per color, stays open while
 * toggling): the value editor of a `colorIs` filter condition.
 */
export function ColorSwatchMultiSelect({ value, onChange, placeholder = "Select colors", invalid, describedBy, className, ...rest }: ColorSwatchMultiSelectProps) {
  return (
    <MultiPicker
      aria-label={rest["aria-label"] ?? "Colors"}
      placeholder={placeholder}
      items={ITEMS}
      value={value}
      onChange={(next) => onChange(next as CellColor[])}
      invalid={invalid}
      describedBy={describedBy}
      className={className}
    />
  );
}
