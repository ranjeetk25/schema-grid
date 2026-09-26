import { type SQL, sql } from "drizzle-orm";
import { UnsupportedOperatorError } from "../errors";
import type { SortSpec } from "../internal/core";
import { binaryText, choiceRank } from "../sql/choice-order";
import { resolveColumnExpr, rowIdExpr } from "../sql/column-expr";
import type { SqlScope } from "../sql/scope";
import type { StorageKind } from "../sql/storage-kind";

const UNSORTABLE_KINDS: ReadonlySet<StorageKind> = new Set(["multi", "json"]);

export interface SortKey {
  columnId: string;
  dir: "asc" | "desc";
  /** Typed, comparable/sortable expression. */
  expr: SQL;
  /** `(CASE WHEN <empty> THEN 1 ELSE 0 END)` — 1 when the cell is empty, so nulls sort last. */
  nullFlag: SQL;
  kind: StorageKind;
}

/**
 * Builds ORDER BY from `SortSpec[]`: each spec contributes `nullFlag ASC, typed <dir>`
 * (nulls last in both directions) — for `choice` columns `nullFlag ASC, optionRank <dir>,
 * binary(value) <dir>` (two keys), matching core's option-order compare — and the list always ends with `<rowId> ASC` as a stable
 * tie-breaker. Throws `UnsupportedOperatorError` for an unknown column id or an
 * unsortable kind (multi, json).
 */
export function translateSort(sort: SortSpec[], scope: SqlScope): { orderBy: SQL[]; keys: SortKey[] } {
  const keys: SortKey[] = [];
  const orderBy: SQL[] = [];

  for (const spec of sort) {
    const column = scope.ctx.schema.columns.find((c) => c.id === spec.columnId);
    if (!column) {
      throw new UnsupportedOperatorError("sort", { columnId: spec.columnId, kind: "unknown-column" });
    }

    // "sort": mapped columns answer with `sortExpr` — the keyset keys below reuse the same ColumnExpr.
    const resolved = resolveColumnExpr(column, scope, "sort");
    if (UNSORTABLE_KINDS.has(resolved.kind)) {
      throw new UnsupportedOperatorError("sort", { columnId: column.id, kind: resolved.kind });
    }

    const nullFlag = sql`(CASE WHEN ${resolved.empty} THEN 1 ELSE 0 END)`;
    // NULL for every empty form ('' included), so inside the empty group rows are ordered by id only —
    // exactly what the keyset predicate assumes.
    const expr = sql`(CASE WHEN ${resolved.empty} THEN NULL ELSE ${resolved.typed} END)`;
    const dirSql = spec.dir === "desc" ? sql`DESC` : sql`ASC`;

    orderBy.push(sql`${nullFlag} ASC`);
    if (resolved.kind === "choice") {
      // Core orders select values by OPTION ORDER (`compareByOptionOrder`), not alphabetically:
      // rank in config order, then code-point order for ids outside the options. Two keyset keys.
      const rank = choiceRank(expr, column);
      const bin = binaryText(expr);
      orderBy.push(sql`${rank} ${dirSql}`);
      orderBy.push(sql`${bin} ${dirSql}`);
      keys.push({ columnId: column.id, dir: spec.dir, expr: rank, nullFlag, kind: "number" });
      keys.push({ columnId: column.id, dir: spec.dir, expr: bin, nullFlag, kind: resolved.kind });
      continue;
    }
    orderBy.push(sql`${expr} ${dirSql}`);
    keys.push({ columnId: column.id, dir: spec.dir, expr, nullFlag, kind: resolved.kind });
  }

  orderBy.push(sql`${rowIdExpr(scope)} ASC`);
  return { orderBy, keys };
}
