import { type AccessMap, assertQueryAccess } from "../access/query-access";
import { FilterValidationError } from "../errors";
import {
  COLOR_OPERATORS,
  type ColorRule,
  type ColorRuleIssue,
  type DataSourceCapabilities,
  type FilterNode,
  type GridQuery,
  type GridSchema,
  colorFilterBlockedMessage,
  colorFilterBlockers,
  colorRuleUnfilterableColumn,
  hasColorCondition,
  readableColumnIds,
  sqlFilterablePredicate,
  validateColorRules,
} from "../internal/core";
import type { SqlScope } from "../sql/scope";

const COLOR_OPERATOR_IDS: ReadonlySet<string> = new Set(COLOR_OPERATORS.map((o) => o.id));

/** Column ids of the filter's color conditions (`colorIs` / `colorIsNone`), in walk order, once each. */
function colorConditionColumnIds(node: FilterNode | null | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if ("op" in node && "children" in node) {
    for (const child of node.children) colorConditionColumnIds(child, out);
  } else if (COLOR_OPERATOR_IDS.has(node.operator) && !out.includes(node.columnId)) {
    out.push(node.columnId);
  }
  return out;
}

/**
 * v0.4.1: rejects a color condition on a column whose shown color depends on a
 * rule the server can't compile (core `colorFilterBlockers`: the rule's `when`
 * tests a `filterable: false` column — SQL-view computed columns included — or
 * one outside the source's `filter` scope). `FilterValidationError` → wire
 * `FILTER_INVALID` 400 with core's `colorFilterBlockedMessage`.
 */
function assertColorFilterable(
  filter: FilterNode | null | undefined,
  rules: readonly ColorRule[],
  schema: GridSchema,
  capabilities: Pick<DataSourceCapabilities, "filter"> | undefined,
): void {
  const isSqlFilterable = sqlFilterablePredicate(schema, capabilities);
  for (const columnId of colorConditionColumnIds(filter)) {
    const blocker = colorFilterBlockers(columnId, rules, schema, isSqlFilterable)[0];
    if (!blocker) continue;
    const column = schema.columns.find((c) => c.id === columnId);
    const offending = colorRuleUnfilterableColumn(blocker, schema, isSqlFilterable);
    if (!column || !offending) continue;
    // Shaped like core's `ColorRuleIssue` (rule-level: `path` [], `ruleIndex` / `ruleId`).
    const issue: ColorRuleIssue = {
      code: "unfilterableColumn",
      path: [],
      columnId: offending.id,
      ruleIndex: rules.indexOf(blocker),
      ruleId: blocker.id,
      message: colorFilterBlockedMessage(column.label, offending.label),
    };
    throw new FilterValidationError([issue]);
  }
}

/**
 * The scope one `fetch` compiles with (v0.4): when the filter has a color
 * condition (`colorIs` / `colorIsNone`), `query.colorRules` are validated
 * (core `validateColorRules`: palette, targets, readable columns, each `when`
 * like a filter) and attached as `scope.colors.rules`; problems throw
 * `FilterValidationError` (wire `FILTER_INVALID` 400) before any SQL, after the
 * usual filter permission checks. v0.4.1: so does a color condition on a
 * column one of whose rules tests a column the server can't filter on
 * (`capabilities.filter` narrows what counts as filterable). Without a color
 * condition the rules are ignored (not even validated) and `scope` is returned as is.
 */
export function colorQueryScope<S extends SqlScope>(
  query: GridQuery,
  scope: S,
  access: AccessMap,
  capabilities?: Pick<DataSourceCapabilities, "filter">,
): S {
  if (!hasColorCondition(query.filter)) return scope;
  assertQueryAccess(query, scope.ctx, access);
  const checked = validateColorRules(query.colorRules, scope.ctx.schema, scope.ctx.registry, readableColumnIds(access));
  if (!checked.ok) throw new FilterValidationError(checked.issues);
  assertColorFilterable(query.filter, checked.rules, scope.ctx.schema, capabilities);
  return { ...scope, colors: { ...scope.colors, rules: checked.rules } };
}
