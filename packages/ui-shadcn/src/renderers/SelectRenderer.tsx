import type { Option } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { findOption, getSelectOptions } from "../internal/options";
import { OptionBadge } from "./OptionBadge";

export interface SelectRendererConfig {
  options?: Option[];
}

/** Renders the value's option as a tone badge (an unknown id shows as a neutral badge), or nothing when empty. */
export function SelectRenderer({ value, config }: UiRendererProps<string, SelectRendererConfig>) {
  if (value === null || value === undefined || value === "") return null;
  const option = findOption(getSelectOptions(config), value) ?? { id: String(value), label: String(value) };
  return <OptionBadge option={option} />;
}
