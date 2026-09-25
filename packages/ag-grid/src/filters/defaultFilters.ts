import type { ComponentType } from "react";
import type { CustomFilterProps, CustomFloatingFilterProps } from "ag-grid-react";
import type { UiFilterEntry } from "../compile/uiRegistry";
import { BUILT_IN_FIELD_TYPE_IDS, type FieldTypeId } from "../internal/core";
import { ConditionFilter } from "./ConditionFilter";
import { FloatingFilter } from "./FloatingFilter";
import { SetFilter } from "./SetFilter";

/** Types whose filter is the searchable checkbox list (`SetFilter`). */
const SET_FILTER_TYPES: ReadonlySet<FieldTypeId> = new Set<FieldTypeId>(["select", "multiSelect", "user", "boolean"]);

const setEntry: UiFilterEntry = {
  filterComponent: SetFilter as ComponentType<CustomFilterProps>,
  floatingFilter: FloatingFilter as ComponentType<CustomFloatingFilterProps>,
};

/** Formula columns use ConditionFilter too — `operatorsFor` switches to the result type's operators. */
const conditionEntry: UiFilterEntry = {
  filterComponent: ConditionFilter as ComponentType<CustomFilterProps>,
  floatingFilter: FloatingFilter as ComponentType<CustomFloatingFilterProps>,
};

/**
 * Per-type filter/floating-filter registrations merged by
 * `createDefaultUiRegistry`: select, multiSelect, user and boolean get
 * `SetFilter`; every other built-in type (formula included) gets `ConditionFilter`.
 */
export const DEFAULT_FILTERS: Partial<Record<FieldTypeId, UiFilterEntry>> = Object.fromEntries(
  BUILT_IN_FIELD_TYPE_IDS.map((id) => [id, SET_FILTER_TYPES.has(id) ? setEntry : conditionEntry]),
);
