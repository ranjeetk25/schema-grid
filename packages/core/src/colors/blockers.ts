/**
 * v0.4.1: color rules the server can't evaluate. A rule's `when` may test a
 * `filterable: false` column (it renders client-side from row values), but a
 * SQL source can't compile `colorIs` / `colorIsNone` through such a rule. These
 * helpers name the rules that block filtering a column by color, and the
 * messages servers and UI kits show for it.
 */
import type { ColumnScope } from "../datasource/capabilities";
import { isFilterCondition, isFilterGroup } from "../filter/guards";
import type { FilterNode } from "../filter/types";
import { getColumnById } from "../schema/lookup";
import type { ColumnDef, GridSchema } from "../schema/types";
import type { ColorRule } from "./types";

/**
 * The capability fields `sqlFilterablePredicate` reads: a source's `filter`
 * scope (`DataSourceCapabilities`) and / or the per-column `filterable`
 * (`EffectiveCapabilities.columns`). Both kinds of capabilities fit.
 */
export type FilterScopeCapabilitiesLike =
  | { filter?: ColumnScope; columns?: Record<string, { filterable?: boolean } | undefined> }
  | null
  | undefined;

/**
 * The default "can the server filter on this column?" check: the column
 * exists, is not `filterable: false`, and (with `capabilities`) is in the
 * source's `filter` scope and not marked unfilterable in the effective
 * capabilities. Pass the server's effective schema, where computed columns
 * are already `filterable: false`.
 */
export function sqlFilterablePredicate(
  schema: GridSchema,
  capabilities?: FilterScopeCapabilitiesLike,
): (columnId: string) => boolean {
  const scope = capabilities?.filter;
  const columns = capabilities?.columns;
  return (columnId) => {
    const column = getColumnById(schema, columnId);
    if (!column || column.filterable === false) return false;
    if (columns?.[column.id]?.filterable === false) return false;
    if (scope && scope !== "all" && !scope.columnIds.includes(column.id)) return false;
    return true;
  };
}

/** Column ids a `when` tests, in walk order (malformed nodes are skipped). */
function conditionColumnIds(node: FilterNode | null, out: string[] = []): string[] {
  if (isFilterGroup(node)) for (const child of node.children) conditionColumnIds(child, out);
  else if (isFilterCondition(node)) out.push(node.columnId);
  return out;
}

/** The first column in `rule.when` the server can't filter on, or undefined. Unknown ids are skipped. */
export function colorRuleUnfilterableColumn(
  rule: ColorRule,
  schema: GridSchema,
  isSqlFilterable: (columnId: string) => boolean,
): ColumnDef | undefined {
  for (const id of conditionColumnIds(rule.when)) {
    if (isSqlFilterable(id)) continue;
    const column = getColumnById(schema, id);
    if (column) return column;
  }
  return undefined;
}

/** True when `rule` (enabled, with a condition) can change the color `columnId` shows. */
function canColor(rule: ColorRule, columnId: string): boolean {
  if (rule.enabled === false || rule.when === null) return false;
  return rule.target.kind === "row" || rule.target.columnIds.includes(columnId);
}

/**
 * The enabled rules that can affect `columnId`'s shown color (`cells` rules
 * targeting it and every `row` rule) whose `when` tests a column for which
 * `isSqlFilterable` is false. Non-empty = the server can't filter `columnId`
 * by color. Rules that can't color `columnId` are ignored.
 */
export function colorFilterBlockers(
  columnId: string,
  rules: readonly ColorRule[] | undefined,
  schema: GridSchema,
  isSqlFilterable: (columnId: string) => boolean,
): ColorRule[] {
  if (!rules) return [];
  return rules.filter(
    (rule) => canColor(rule, columnId) && colorRuleUnfilterableColumn(rule, schema, isSqlFilterable) !== undefined,
  );
}

/** `a color rule on it uses "<label>", which can't be filtered on the server` (UI hint / tooltip). */
export function unfilterableColorRuleReason(offendingLabel: string): string {
  return `a color rule on it uses "${offendingLabel}", which can't be filtered on the server`;
}

/** The server's 400 `FILTER_INVALID` message: `Can't filter "<label>" by color: <reason>`. */
export function colorFilterBlockedMessage(columnLabel: string, offendingLabel: string): string {
  return `Can't filter "${columnLabel}" by color: ${unfilterableColorRuleReason(offendingLabel)}`;
}
