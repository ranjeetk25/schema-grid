/**
 * ag-grid adapter for the column filters: the only file in `column-filters/`
 * that imports `@ranjeetk25/schema-grid-ag-grid` / `ag-grid-react`.
 */
export {
  RELATIVE_DATE_LABELS,
  resolveFilterColumn,
  type ResolvedFilterColumn,
  type SchemaFilterProps,
} from "@ranjeetk25/schema-grid-ag-grid/filters";
export { useGridFilter } from "ag-grid-react";
export { getSchemaGridContext } from "../internal/grid-contracts";

/**
 * Stable across renders: ag-grid-react treats a new `doesFilterPass` identity on a
 * re-render of an active filter as "the filter logic changed" and fires a spurious
 * `filterChanged` (a duplicate server fetch). Rows arrive pre-filtered by core.
 */
export const PASS_ALL_FILTER_METHODS = { doesFilterPass: () => true };

/**
 * Every Mantine dropdown inside an AG Grid filter popup renders inline: AG
 * Grid closes the popup on any click outside its element, including a portal.
 */
export const INLINE_COMBOBOX = { withinPortal: false, offset: 4 } as const;
export const INLINE_POPOVER = { withinPortal: false } as const;
