import { type SQL, sql } from "drizzle-orm";
import { UnsupportedOperatorError } from "../errors";
import { type FilterCondition, type FilterNode, getColumnOperators } from "../internal/core";
import { resolveColumnExpr } from "../sql/column-expr";
import type { SqlScope } from "../sql/scope";
import { getOperatorTranslator } from "./operator-table";

function isGroup(node: FilterNode): node is Extract<FilterNode, { op: "and" | "or" }> {
  return "op" in node && "children" in node;
}

function translateCondition(cond: FilterCondition, scope: SqlScope): SQL {
  const column = scope.ctx.schema.columns.find((c) => c.id === cond.columnId);
  if (!column) throw new UnsupportedOperatorError(cond.operator, { columnId: cond.columnId, kind: "unknown column" });
  const operator = getColumnOperators(column, scope.ctx.registry).find((o) => o.id === cond.operator);
  if (!operator) throw new UnsupportedOperatorError(cond.operator, { columnId: column.id, kind: column.type });

  const expr = resolveColumnExpr(column, scope);
  if (operator.id === "isEmpty") return expr.empty;
  if (operator.id === "isNotEmpty") return sql`NOT ${expr.empty}`;

  const translator = getOperatorTranslator(expr.kind, operator.id);
  if (!translator) throw new UnsupportedOperatorError(operator.id, { columnId: column.id, kind: expr.kind });
  const cmp = translator({ expr, column, operator, value: cond.value, scope });

  // Null rule (spec §4.3): negative operators MATCH empty values; positive never do.
  return operator.negative ? sql`(${cmp} OR ${expr.empty})` : sql`(${cmp} AND NOT ${expr.empty})`;
}

/**
 * FilterNode → WHERE fragment. Returns `undefined` for a null filter or an
 * empty AND group (match everything). An empty OR group matches nothing.
 * Assumes the filter was validated/permission-checked (see `assertQueryAccess`).
 */
export function translateFilter(node: FilterNode | null | undefined, scope: SqlScope): SQL | undefined {
  if (!node) return undefined;
  if (!isGroup(node)) return translateCondition(node, scope);
  const translated = node.children.map((c) => translateFilter(c, scope));
  // A child that matches everything makes an OR match everything.
  if (node.op === "or" && translated.some((p) => p === undefined) && translated.length > 0) return undefined;
  const parts = translated.filter((p): p is SQL => p !== undefined);
  if (parts.length === 0) return node.op === "and" ? undefined : sql`FALSE`;
  if (parts.length === 1) return parts[0] as SQL;
  return sql`(${sql.join(parts, node.op === "and" ? sql` AND ` : sql` OR `)})`;
}
