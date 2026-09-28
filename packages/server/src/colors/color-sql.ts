import { type SQL, sql } from "drizzle-orm";
import { type CellColor, type ColorRule, type FilterCondition, type FilterNode, isCellColor } from "../internal/core";
import type { SqlScope } from "../sql/scope";

/** The filter translator, passed in so rule conditions compile with the SAME code as filters. */
export type TranslateWhen = (node: FilterNode | null | undefined, scope: SqlScope) => SQL | undefined;

/**
 * JSON path of a column's entry in a colors document: `$."<id>"` (quoted
 * member, `"` and `\` escaped). Always bound as a parameter, never inlined:
 * column ids are free-form.
 */
export function cellColorJsonPath(columnId: string): string {
  return `$."${columnId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A palette color as an SQL string literal (only ever called with `isCellColor` values). */
function colorLiteral(color: CellColor): SQL {
  return sql.raw(`'${color}'`);
}

const isLive = (rule: ColorRule): boolean =>
  typeof rule === "object" &&
  rule !== null &&
  rule.enabled !== false &&
  isCellColor(rule.color) &&
  rule.when !== null &&
  rule.when !== undefined;

/** `CASE WHEN <when1> THEN 'c1' … END` over `rules` (first match wins), or undefined for none. */
function firstMatch(rules: readonly ColorRule[], scope: SqlScope, translateWhen: TranslateWhen): SQL | undefined {
  if (rules.length === 0) return undefined;
  // A rule's `when` is compiled like any filter, except that color conditions inside it never match.
  const ruleScope: SqlScope = { ...scope, colors: { inRule: true } };
  const branches = rules.map((rule) => {
    const when = translateWhen(rule.when, ruleScope) ?? sql`TRUE`;
    return sql`WHEN ${when} THEN ${colorLiteral(rule.color)}`;
  });
  return sql`CASE ${sql.join(branches, sql` `)} END`;
}

/**
 * The color a cell SHOWS, as SQL (NULL = none), with core's precedence
 * (`resolveCellColor`): the row's manual color for the column > the first
 * matching enabled `cells` rule targeting the column > the first matching
 * enabled `row` rule:
 *
 *   COALESCE(JSON_UNQUOTE(JSON_EXTRACT(<colors>, '$."c"')), CASE <cells rules> END, CASE <row rules> END)
 *
 * Parts that cannot apply are left out (no color store → no manual part).
 * Rule conditions compile through `translateWhen` (the filter translator).
 */
export function shownColorExpr(columnId: string, scope: SqlScope, translateWhen: TranslateWhen): SQL | undefined {
  const parts: SQL[] = [];
  const manual = scope.colors?.manual;
  if (manual) parts.push(sql`JSON_UNQUOTE(JSON_EXTRACT(${manual}, ${cellColorJsonPath(columnId)}))`);
  const rules = (Array.isArray(scope.colors?.rules) ? (scope.colors?.rules as readonly ColorRule[]) : []).filter(isLive);
  const cells = firstMatch(
    rules.filter((r) => r.target?.kind === "cells" && Array.isArray(r.target.columnIds) && r.target.columnIds.includes(columnId)),
    scope,
    translateWhen,
  );
  const row = firstMatch(
    rules.filter((r) => r.target?.kind === "row"),
    scope,
    translateWhen,
  );
  if (cells) parts.push(cells);
  if (row) parts.push(row);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return sql`COALESCE(${sql.join(parts, sql`, `)})`;
}

/**
 * `colorIs [..]` → `COALESCE(<shown> IN ('red', …), FALSE)` (two-valued, `<shown>` evaluated once);
 * `colorIsNone` → `(<shown> IS NULL)`. Only palette colors are ever inlined; a
 * list without one matches nothing. Inside a rule's own `when` → FALSE.
 */
export function translateColorCondition(cond: FilterCondition, scope: SqlScope, translateWhen: TranslateWhen): SQL {
  if (scope.colors?.inRule) return sql`FALSE`;
  const shown = shownColorExpr(cond.columnId, scope, translateWhen);
  if (cond.operator === "colorIsNone") return shown ? sql`(${shown} IS NULL)` : sql`TRUE`;
  const values = Array.isArray(cond.value) ? [...new Set(cond.value.filter(isCellColor))] : [];
  if (!shown || values.length === 0) return sql`FALSE`;
  const list = sql.join(values.map(colorLiteral), sql`, `);
  return sql`COALESCE(${shown} IN (${list}), FALSE)`;
}
