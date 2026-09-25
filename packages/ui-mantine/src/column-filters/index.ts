import type { ComponentType } from "react";
import type { FieldTypeId } from "../internal/core-contracts";
import { MantineConditionFilter } from "./MantineConditionFilter";
import { MantineSetFilter } from "./MantineSetFilter";

export { MantineConditionFilter, buildColumnCondition, valueTypeOf } from "./MantineConditionFilter";
export { MantineSetFilter, distinctRowOptions, selectedFromModel, setFilterModel } from "./MantineSetFilter";
export { filterOptions, toColumnFilterOptions, type ColumnFilterOption } from "./options";

/** Types whose Mantine column filter is the searchable checkbox list. */
export const MANTINE_SET_FILTER_TYPES: ReadonlySet<FieldTypeId> = new Set<FieldTypeId>(["select", "multiSelect", "user", "boolean"]);

/** The Mantine `filterComponent` for a field type (set list for set-like types, condition card otherwise). */
export function mantineFilterComponentFor(type: FieldTypeId): ComponentType<never> {
  return (MANTINE_SET_FILTER_TYPES.has(type) ? MantineSetFilter : MantineConditionFilter) as ComponentType<never>;
}
