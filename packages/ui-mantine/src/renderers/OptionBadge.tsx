import { Badge, type MantineTheme, useMantineTheme } from "@mantine/core";
import type { CSSProperties } from "react";
import type { Option } from "../internal/core-contracts";
import { resolveOptionColor } from "../internal/options";

/** 12px text, 20px tall, sentence case: the cell pill size (Mantine's `sm` badge is 10px text). */
export const CELL_BADGE_STYLES = {
  root: {
    height: 20,
    fontSize: 12,
    lineHeight: "20px",
    padding: "0 6px",
    fontWeight: 500,
    textTransform: "none",
    letterSpacing: 0,
    flexShrink: 0,
    maxWidth: "100%",
  } satisfies CSSProperties,
  label: { overflow: "hidden", textOverflow: "ellipsis" } satisfies CSSProperties,
  section: { marginInlineEnd: 5 } satisfies CSSProperties,
};

/** The filled swatch colour for an option colour (a Mantine palette name or a raw CSS colour). */
export function optionDotColor(color: string, theme: Pick<MantineTheme, "colors">): string {
  return color in theme.colors ? `var(--mantine-color-${color}-filled)` : color;
}

/** An 8px circle in the option's colour. */
export function OptionDot({ color }: { color: string }) {
  const theme = useMantineTheme();
  return (
    <span
      aria-hidden
      data-testid="option-color-dot"
      data-color={color}
      style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: optionDotColor(color, theme) }}
    />
  );
}

/** A coloured pill for a single select option (light fill + 8px colour dot). Renders nothing for an unknown/empty option. */
export function OptionBadge({ option, withDot = true }: { option: Option | undefined; withDot?: boolean }) {
  const theme = useMantineTheme();
  if (!option) return null;
  const color = resolveOptionColor(option, theme);
  return (
    <Badge
      variant="light"
      radius="sm"
      color={color}
      styles={CELL_BADGE_STYLES}
      leftSection={withDot ? <OptionDot color={color} /> : undefined}
    >
      {option.label}
    </Badge>
  );
}
