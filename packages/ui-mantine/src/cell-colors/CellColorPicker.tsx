import { Box, Tooltip, UnstyledButton } from "@mantine/core";
import type { CellColor } from "../internal/core-contracts";
import { CELL_COLOR_PALETTE, CellColorSwatch } from "../theme/cellColorPalette";

export interface CellColorPickerProps {
  /** A palette color, or null for "No color". */
  onPick(color: CellColor | null): void;
  /** Marks the current color (`aria-pressed`). */
  value?: CellColor | null;
  /** Offer "No color" (clear). Default true. */
  withNone?: boolean;
  disabled?: boolean;
  /** Accessible name of the swatch group. Default "Cell colors". */
  label?: string;
  /** Swatch edge in px. Default 20. */
  size?: number;
}

/** v0.4: the palette as a row of swatch buttons (+ "No color"), e.g. inside the toolbar's "Cell color" popover. */
export function CellColorPicker({
  onPick,
  value,
  withNone = true,
  disabled,
  label = "Cell colors",
  size = 20,
}: CellColorPickerProps) {
  const entries: { color: CellColor | null; label: string; swatch?: string }[] =
    [
      ...CELL_COLOR_PALETTE,
      ...(withNone ? [{ color: null, label: "No color" }] : []),
    ];
  return (
    <Box
      component="fieldset"
      aria-label={label}
      style={{
        border: 0,
        margin: 0,
        padding: 0,
        minWidth: 0,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 4,
        maxWidth: 5 * (size + 10),
      }}
    >
      {entries.map((e) => {
        const current = value !== undefined && value === e.color;
        return (
          <Tooltip key={e.color ?? "none"} label={e.label} withinPortal={false}>
            <UnstyledButton
              aria-label={e.label}
              aria-pressed={value !== undefined ? current : undefined}
              data-color={e.color ?? "none"}
              disabled={disabled}
              onClick={() => onPick(e.color)}
              style={{
                display: "inline-flex",
                padding: 3,
                borderRadius: 6,
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
                outline: current
                  ? `2px solid ${e.swatch ?? "var(--mantine-color-default-border)"}`
                  : undefined,
                outlineOffset: -1,
              }}
            >
              <CellColorSwatch color={e.color} size={size} />
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </Box>
  );
}
