import { type SQL, and, eq, inArray, isNull, sql } from "drizzle-orm";
import { isReadable, resolveAccess } from "../access/query-access";
import type { ServerContext } from "../context";
import type { CellChange, ChangeBatch, ChangeConflict, ChangeError, ChangeResult } from "../internal/core";
import { ident } from "../sql/column-expr";
import { type DbRow, hydrateRow } from "../storage/hydrate";
import { jsonPath } from "../storage/keys";
import { insertChangeLog, type ChangeLogEntry } from "./change-log";
import { type GridDb, type WriteDeps, affectedRowsOf } from "./db";
import { type CurrentRow, type PlannedSet, type RowWritePlan, planChanges } from "./plan-changes";

const path = (key: string) => sql.raw(`'${jsonPath(key)}'`);

/** `JSON_REMOVE(JSON_SET(cells, '$.a', CAST(? AS JSON), …), '$.b', …)`, or undefined when no JSON cell changes. */
export function cellsUpdateExpr(sets: PlannedSet[]): SQL | undefined {
  const json = sets.filter((s) => !s.column.source);
  const writes = json.filter((s) => !s.remove);
  const removes = json.filter((s) => s.remove);
  if (writes.length === 0 && removes.length === 0) return undefined;
  let expr: SQL = sql`${ident("cells")}`;
  if (writes.length > 0) {
    const args = writes.map((s) => sql`${path(s.column.key)}, CAST(${JSON.stringify(s.serialized)} AS JSON)`);
    expr = sql`JSON_SET(${expr}, ${sql.join(args, sql`, `)})`;
  }
  if (removes.length > 0) {
    expr = sql`JSON_REMOVE(${expr}, ${sql.join(
      removes.map((s) => path(s.column.key)),
      sql`, `,
    )})`;
  }
  return expr;
}

function physicalValue(set: PlannedSet): unknown {
  if (set.remove) return null;
  if (set.column.type === "datetime" && typeof set.serialized === "string") return new Date(set.serialized);
  return set.serialized;
}

/**
 * The optimistic UPDATE for one row: bumps `version` exactly once and only
 * matches when the row is still at `plan.baseVersion` and not deleted.
 */
export function buildRowUpdate(plan: RowWritePlan, ctx: ServerContext, deps: WriteDeps, now: Date) {
  const { rows } = deps.tables;
  const values: Record<string, unknown> = {
    version: sql`${ident("version")} + 1`,
    updatedAt: now,
    updatedBy: ctx.user.id,
  };
  const cells = cellsUpdateExpr(plan.sets);
  if (cells) values.cells = cells;
  for (const s of plan.sets) if (s.column.source) values[s.column.source.valueField] = physicalValue(s);
  return deps.db
    .update(rows)
    .set(values as never)
    .where(
      and(
        eq(rows.id, plan.rowId),
        eq(rows.gridId, deps.gridId),
        eq(rows.version, plan.baseVersion),
        isNull(rows.deletedAt),
      ),
    );
}

async function loadRows(tx: GridDb, deps: WriteDeps, ids: string[], ctx: ServerContext): Promise<Map<string, CurrentRow>> {
  const out = new Map<string, CurrentRow>();
  if (ids.length === 0) return out;
  const { rows } = deps.tables;
  const found = (await tx
    .select()
    .from(rows)
    .where(and(eq(rows.gridId, deps.gridId), inArray(rows.id, ids)))) as unknown as DbRow[];
  for (const r of found) {
    const row: CurrentRow = hydrateRow(r, ctx.schema, ctx.registry);
    if (r.deletedAt) row.deletedAt = r.deletedAt instanceof Date ? r.deletedAt.toISOString() : String(r.deletedAt);
    out.set(row.id, row);
  }
  return out;
}

/**
 * Applies a ChangeBatch with optimistic version checks, in ONE transaction:
 * read current rows → `planChanges` → one UPDATE per row (version guard) →
 * rows that matched 0 rows become conflicts (with the server's current state),
 * never errors → change_log rows for applied cells only.
 * A conflict on one row does not block the others.
 */
export async function applyChanges(batch: ChangeBatch, ctx: ServerContext, deps: WriteDeps): Promise<ChangeResult> {
  const rowIds = [...new Set(batch.changes.map((c) => c.rowId))];
  const access = resolveAccess(ctx);
  return deps.db.transaction(async (tx) => {
    const txDeps: WriteDeps = { ...deps, db: tx as unknown as GridDb };
    const now = ctx.now();
    const current = await loadRows(txDeps.db, txDeps, rowIds, ctx);
    const plan = planChanges(batch, current, ctx);
    const applied: CellChange[] = [];
    const conflicts: ChangeConflict[] = [];
    const errors: ChangeError[] = [...plan.errors];
    const log: ChangeLogEntry[] = [];

    for (const rowPlan of plan.rowPlans) {
      const result = await buildRowUpdate(rowPlan, ctx, txDeps, now);
      if (affectedRowsOf(result) === 0) {
        const fresh = (await loadRows(txDeps.db, txDeps, [rowPlan.rowId], ctx)).get(rowPlan.rowId);
        for (const s of rowPlan.sets) {
          if (!fresh || fresh.deletedAt) {
            errors.push({ rowId: rowPlan.rowId, columnId: s.column.id, message: "Row not found" });
            continue;
          }
          const conflict: ChangeConflict = {
            rowId: rowPlan.rowId,
            columnId: s.column.id,
            serverValue: isReadable(access, s.column.id) ? (fresh.cells[s.column.key] ?? null) : null,
            serverVersion: fresh.version,
            updatedAt: fresh.updatedAt,
          };
          if (fresh.updatedBy) conflict.updatedBy = fresh.updatedBy;
          conflicts.push(conflict);
        }
        continue;
      }
      for (const s of rowPlan.sets) {
        applied.push({ rowId: rowPlan.rowId, columnId: s.column.id, prev: s.prev, next: s.next });
        log.push({ rowId: rowPlan.rowId, columnId: s.column.id, kind: "cell", prev: s.prev, next: s.remove ? null : s.serialized });
      }
    }

    await insertChangeLog(txDeps.db, deps.tables, { gridId: deps.gridId, actor: ctx.user.id, at: now, batchId: batch.id }, log);
    return { applied, conflicts, errors };
  });
}
