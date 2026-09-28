import { Button, Popover, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { IconPaint } from "../internal/icons";
import type { CellColor } from "../internal/core-contracts";
import { CellColorPicker } from "./CellColorPicker";

export interface CellColorButtonProps {
  /**
   * Some selected cell is paintable (`handle.canPaint()`). False keeps the
   * button usable but disables the swatches with a hint, so the popover can
   * explain instead of the button silently doing nothing.
   */
  canPaint: boolean;
  /** Paints the selection (`handle.setCellColor(color)`); null clears. */
  onPaint(color: CellColor | null): unknown;
  /** Button label (also its accessible name). Default "Cell color". */
  label?: string;
}

/**
 * v0.4 toolbar "Cell color": a popover with the palette and "No color" that
 * paints the grid's range selection (or focused cell). The popover renders
 * inline (`withinPortal: false`) and does not take focus, so the grid's
 * selection is untouched until a swatch is clicked; it closes after a pick.
 */
export function CellColorButton({
  canPaint,
  onPaint,
  label = "Cell color",
}: CellColorButtonProps) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      withinPortal={false}
      position="bottom-start"
      offset={6}
      trapFocus={false}
    >
      <Popover.Target>
        <Button
          variant="subtle"
          color="gray"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={opened}
          onClick={() => setOpened((o) => !o)}
          leftSection={<IconPaint size={16} stroke={1.75} aria-hidden />}
          styles={{
            root: { paddingInline: 10 },
            section: { marginInlineEnd: 6 },
          }}
        >
          {label}
        </Button>
      </Popover.Target>
      <Popover.Dropdown p={8} aria-label={label}>
        <Stack gap={6}>
          <CellColorPicker
            disabled={!canPaint}
            onPick={(color) => {
              setOpened(false);
              void Promise.resolve(onPaint(color)).catch(() => undefined);
            }}
          />
          {!canPaint ? (
            <Text fz={12} c="dimmed" maw={200}>
              Select cells you can edit to color them.
            </Text>
          ) : null}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
