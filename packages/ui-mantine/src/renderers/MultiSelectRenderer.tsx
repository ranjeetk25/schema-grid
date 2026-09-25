import { Pill, useMantineTheme } from "@mantine/core";
import type { SelectOption } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { getSelectOptions, resolveOptionColor } from "../internal/options";

export interface MultiSelectRendererConfig {
  options?: SelectOption[];
}

export interface MultiSelectRendererProps extends UiRendererProps<string[], MultiSelectRendererConfig> {
  /** How many pills to show before collapsing the rest into "+N". @default 3 */
  limit?: number;
}

/** A row of coloured pills, one per selected value, collapsing overflow into "+N". */
export function MultiSelectRenderer({ value, config, limit = 3 }: MultiSelectRendererProps) {
  const theme = useMantineTheme();
  const values = value ?? [];
  if (values.length === 0) return null;

  const options = getSelectOptions(config);
  const visible = values.slice(0, limit);
  const overflow = values.length - visible.length;

  return (
    <Pill.Group>
      {visible.map((v) => {
        const option = options.find((o) => o.value === v);
        const color = resolveOptionColor(option, theme);
        return (
          <Pill key={v} style={{ backgroundColor: `var(--mantine-color-${color}-light)`, color: `var(--mantine-color-${color}-light-color)` }}>
            {option?.label ?? v}
          </Pill>
        );
      })}
      {overflow > 0 && <Pill>{`+${overflow}`}</Pill>}
    </Pill.Group>
  );
}
