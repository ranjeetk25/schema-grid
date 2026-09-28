import { Box, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck } from "../internal/icons";
import type { CellColor } from "../internal/core-contracts";
import { CELL_COLOR_PALETTE, CellColorSwatch } from "../theme/cellColorPalette";

export interface ColorSwatchMultiSelectProps {
  value: readonly CellColor[];
  /** The new selection, in palette order. */
  onChange(value: CellColor[]): void;
  /** Accessible name of the group. Default "Colors". */
  label?: string;
  /** Swatch edge in px. Default 18. */
  size?: number;
  error?: string;
}

/**
 * v0.4: the value editor of a "color is" condition — one toggle per palette
 * color (`role="checkbox"`), a check mark on the selected ones.
 */
export function ColorSwatchMultiSelect({
  value,
  onChange,
  label = "Colors",
  size = 18,
  error,
}: ColorSwatchMultiSelectProps) {
  const selected = new Set(value);
  const toggle = (color: CellColor) => {
    const next = new Set(selected);
    if (next.has(color)) next.delete(color);
    else next.add(color);
    onChange(CELL_COLOR_PALETTE.map((p) => p.color).filter((c) => next.has(c)));
  };
  return (
    <Box
      component="fieldset"
      aria-label={label}
      aria-invalid={error ? true : undefined}
      style={{
        border: 0,
        margin: 0,
        padding: 0,
        minWidth: 0,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 4,
        paddingBlock: 3,
      }}
    >
      {CELL_COLOR_PALETTE.map((p) => {
        const on = selected.has(p.color);
        return (
          <Tooltip key={p.color} label={p.label} withinPortal={false}>
            {/* biome-ignore lint/a11y/useSemanticElements: a swatch toggle button, announced as a checkbox. */}
            <UnstyledButton
              role="checkbox"
              aria-checked={on}
              aria-label={p.label}
              data-color={p.color}
              onClick={() => toggle(p.color)}
              style={{
                position: "relative",
                display: "inline-flex",
                borderRadius: 6,
                padding: 2,
                outline: on ? `2px solid ${p.swatch}` : "2px solid transparent",
                outlineOffset: -1,
              }}
            >
              <CellColorSwatch color={p.color} size={size} />
              {on ? (
                <IconCheck
                  size={size - 6}
                  stroke={2.5}
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    margin: "auto",
                    color: p.swatch,
                  }}
                />
              ) : null}
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </Box>
  );
}
