import type { Option } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { findOption, getSelectOptions } from "../internal/options";
import { CellBox } from "./CellBox";
import { OptionBadge } from "./OptionBadge";

export interface SelectRendererConfig {
  options?: Option[];
}

/** Renders the value's option as a coloured pill with an 8px dot; an unknown id shows as plain text. */
export function SelectRenderer({ value, config }: UiRendererProps<string, SelectRendererConfig>) {
  if (value === null || value === undefined || value === "") return null;
  const option = findOption(getSelectOptions(config), value) ?? { id: String(value), label: String(value) };
  return (
    <CellBox>
      <OptionBadge option={option} />
    </CellBox>
  );
}
