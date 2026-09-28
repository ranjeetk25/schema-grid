import { type AccessMap, assertQueryAccess } from "../access/query-access";
import { FilterValidationError } from "../errors";
import { type GridQuery, hasColorCondition, readableColumnIds, validateColorRules } from "../internal/core";
import type { SqlScope } from "../sql/scope";

/**
 * The scope one `fetch` compiles with (v0.4): when the filter has a color
 * condition (`colorIs` / `colorIsNone`), `query.colorRules` are validated
 * (core `validateColorRules`: palette, targets, readable columns, each `when`
 * like a filter) and attached as `scope.colors.rules`; problems throw
 * `FilterValidationError` (wire `FILTER_INVALID` 400) before any SQL, after the
 * usual filter permission checks. Without a color condition the rules are
 * ignored (not even validated) and `scope` is returned as is.
 */
export function colorQueryScope<S extends SqlScope>(query: GridQuery, scope: S, access: AccessMap): S {
  if (!hasColorCondition(query.filter)) return scope;
  assertQueryAccess(query, scope.ctx, access);
  const checked = validateColorRules(query.colorRules, scope.ctx.schema, scope.ctx.registry, readableColumnIds(access));
  if (!checked.ok) throw new FilterValidationError(checked.issues);
  return { ...scope, colors: { ...scope.colors, rules: checked.rules } };
}
