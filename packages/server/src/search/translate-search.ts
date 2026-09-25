import { type SQL, sql } from "drizzle-orm";
import { columnExprResolverOf, resolveColumnExpr } from "../sql/column-expr";
import type { SqlScope } from "../sql/scope";
import { storageKindOf } from "../sql/storage-kind";
import { escapeLike, likeSql } from "../sql/like";
import type { Access } from "../internal/core";
import { isReadable } from "../access/query-access";

const SEARCHABLE_KINDS = new Set(["text", "choice", "ref"]);

/**
 * Free-text search across readable, searchable columns: an OR of `typed LIKE '%term%'`.
 * Searchable kinds: text, choice, ref, and formula columns whose plan is
 * `inline`/`generated` with a `text` result kind. Number/date/datetime/boolean/multi/json
 * are excluded, unless the scope's resolver overrides it (`ColumnExprResolver.searchable`). A blank term or no searchable columns returns `undefined`.
 */
export function translateSearch(
  search: string | undefined,
  access: ReadonlyMap<string, Access>,
  scope: SqlScope,
): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;

  const pattern = `%${escapeLike(term)}%`;
  const branches: SQL[] = [];
  const resolver = columnExprResolverOf(scope);

  for (const column of scope.ctx.schema.columns) {
    if (!isReadable(access, column.id)) continue;

    if (column.type === "formula") {
      const plan = scope.formulaPlans?.get(column.id);
      if (!plan) continue;
      if (plan.mode !== "inline" && plan.mode !== "generated") continue;
      if (plan.resultKind !== "text") continue;
    } else {
      const override = resolver.searchable?.(column);
      if (override === false) continue;
      if (override === undefined) {
        const kind = storageKindOf(column, scope.ctx.registry, scope.storageOverrides).kind;
        if (!SEARCHABLE_KINDS.has(kind)) continue;
      }
    }

    const expr = resolveColumnExpr(column, scope);
    branches.push(likeSql(expr.typed, pattern));
  }

  if (branches.length === 0) return undefined;
  return sql`(${sql.join(branches, sql` OR `)})`;
}
