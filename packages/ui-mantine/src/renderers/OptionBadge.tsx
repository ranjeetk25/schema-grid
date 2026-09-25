import { Badge, useMantineTheme } from "@mantine/core";
import type { SelectOption } from "../internal/core-contracts";
import { resolveOptionColor } from "../internal/options";

/** A coloured badge for a single select option. Renders nothing for an unknown/empty option. */
export function OptionBadge({ option }: { option: SelectOption | undefined }) {
  const theme = useMantineTheme();
  if (!option) return null;
  return <Badge color={resolveOptionColor(option, theme)}>{option.label}</Badge>;
}
