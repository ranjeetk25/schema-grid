/**
 * v0.4 filter by color. Core keeps `COLOR_OPERATORS` (`colorIs`,
 * `colorIsNone`) out of every field type's operator list — they filter the
 * color a cell SHOWS, not its value, and apply to every readable column,
 * `filterable: false` ones included. Whoever lists operators (our column
 * filters, the UI kits' filter builders) appends them when the source can
 * evaluate them: `capabilities.cellColors.filter`.
 */
import {
  COLOR_OPERATORS,
  type ColumnDef,
  type FieldTypeRegistry,
  type FilterOperatorDef,
  getColumnOperators,
} from "../internal/core";

/** Anything carrying `cellColors` capabilities (`DataSourceCapabilities`, `EffectiveCapabilities`, `handle.effectiveCapabilities`). */
export type CellColorCapabilitiesLike = { cellColors?: { filter?: boolean } | undefined } | null | undefined;

/** `context.effectiveCapabilities` from AG Grid's untyped `context` (set by `useSchemaGrid`). */
export function capabilitiesOf(context: unknown): CellColorCapabilitiesLike {
  if (!context || typeof context !== "object") return undefined;
  const caps = (context as { effectiveCapabilities?: unknown }).effectiveCapabilities;
  return caps && typeof caps === "object" ? (caps as CellColorCapabilitiesLike) : undefined;
}

/** True when the source evaluates `colorIs` / `colorIsNone`. */
export function canFilterByColor(capabilities: CellColorCapabilitiesLike): boolean {
  return capabilities?.cellColors?.filter === true;
}

/** `operators` followed by `COLOR_OPERATORS` when the capabilities allow; `operators` itself otherwise. */
export function withColorOperators(
  operators: readonly FilterOperatorDef[],
  capabilities: CellColorCapabilitiesLike,
): readonly FilterOperatorDef[] {
  return canFilterByColor(capabilities) ? [...operators, ...COLOR_OPERATORS] : operators;
}

/**
 * The operators a filter builder should offer for a column: core's
 * `getColumnOperators(column, registry)` (none for a `filterable: false`
 * column) plus `COLOR_OPERATORS` when `capabilities.cellColors.filter`.
 */
export function columnOperatorsWithColors(
  column: ColumnDef,
  registry: FieldTypeRegistry,
  capabilities: CellColorCapabilitiesLike,
): FilterOperatorDef[] {
  const own = column.filterable === false ? [] : getColumnOperators(column, registry);
  return [...withColorOperators(own, capabilities)];
}
