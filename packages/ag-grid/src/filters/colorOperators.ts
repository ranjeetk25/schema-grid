/**
 * v0.4 filter by color. Core keeps `COLOR_OPERATORS` (`colorIs`,
 * `colorIsNone`) out of every field type's operator list — they filter the
 * color a cell SHOWS, not its value, and apply to every readable column,
 * `filterable: false` ones included. Whoever lists operators (our column
 * filters, the UI kits' filter builders) appends them when the source can
 * evaluate them: `capabilities.cellColors.filter`.
 *
 * v0.4.1: a column is also blocked from color filtering when a color rule
 * that can color it tests a column the server can't filter on
 * (`colorFilterBlockers`); `colorFilterBlockedReason` says why.
 */
import {
  COLOR_OPERATORS,
  type ColorRule,
  type ColumnDef,
  colorFilterBlockers,
  colorRuleUnfilterableColumn,
  type FieldTypeRegistry,
  type FilterOperatorDef,
  type FilterScopeCapabilitiesLike,
  getColumnOperators,
  type GridSchema,
  sqlFilterablePredicate,
  unfilterableColorRuleReason,
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

/** v0.4.1: the current view's color rules and the (effective) schema they're checked against. */
export interface ColorRulesInput {
  rules: readonly ColorRule[] | undefined;
  schema: GridSchema;
}

/**
 * v0.4.1: why `column` can't be filtered by color on the server, or null when
 * it can: `a color rule on it uses "<label>", which can't be filtered on the
 * server` (the first blocking rule's first unfilterable column). A column is
 * blocked when an enabled rule that can color it tests a column that is
 * `filterable: false` in `schema` or outside `capabilities`' filter scope
 * (`DataSourceCapabilities` or `EffectiveCapabilities`). Independent of
 * `cellColors.filter`; combine with `canFilterByColor`.
 */
export function colorFilterBlockedReason(
  column: ColumnDef,
  rules: readonly ColorRule[] | undefined,
  schema: GridSchema,
  capabilities?: FilterScopeCapabilitiesLike,
): string | null {
  if (!rules || rules.length === 0) return null;
  const isSqlFilterable = sqlFilterablePredicate(schema, capabilities);
  const [first] = colorFilterBlockers(column.id, rules, schema, isSqlFilterable);
  if (!first) return null;
  const offending = colorRuleUnfilterableColumn(first, schema, isSqlFilterable);
  return unfilterableColorRuleReason(offending?.label ?? "");
}

/**
 * The operators a filter builder should offer for a column: core's
 * `getColumnOperators(column, registry)` (none for a `filterable: false`
 * column) plus `COLOR_OPERATORS` when `capabilities.cellColors.filter`.
 * v0.4.1: with `colorRules`, the color operators are left out for a column
 * `colorFilterBlockedReason` blocks (checked against `capabilities` too).
 */
export function columnOperatorsWithColors(
  column: ColumnDef,
  registry: FieldTypeRegistry,
  capabilities: CellColorCapabilitiesLike,
  colorRules?: ColorRulesInput,
): FilterOperatorDef[] {
  const own = column.filterable === false ? [] : getColumnOperators(column, registry);
  if (colorRules && colorFilterBlockedReason(column, colorRules.rules, colorRules.schema, scopeOf(capabilities)) !== null) {
    return [...own];
  }
  return [...withColorOperators(own, capabilities)];
}

/** The filter-scope fields of a capabilities object typed only by its `cellColors`. */
function scopeOf(capabilities: CellColorCapabilitiesLike): FilterScopeCapabilitiesLike {
  return capabilities as FilterScopeCapabilitiesLike;
}

/**
 * v0.4.1: `colorFilterBlockedReason` for a column filter, from AG Grid's
 * `context` (`colorRules()`, `schema`, `effectiveCapabilities`, set by
 * `useSchemaGrid`). Null without that context.
 */
export function colorFilterBlockedReasonOf(context: unknown, column: ColumnDef): string | null {
  if (!context || typeof context !== "object") return null;
  const ctx = context as { colorRules?: unknown; schema?: GridSchema; effectiveCapabilities?: unknown };
  if (typeof ctx.colorRules !== "function" || !ctx.schema) return null;
  const rules = (ctx.colorRules as () => readonly ColorRule[] | undefined)();
  return colorFilterBlockedReason(column, rules, ctx.schema, ctx.effectiveCapabilities as FilterScopeCapabilitiesLike);
}
