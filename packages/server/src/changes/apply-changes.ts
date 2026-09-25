import { type SQL, and, eq, inArray, isNull, sql } from "drizzle-orm";
import { type AccessMap, isReadable, resolveAccess } from "../access/query-access";
import type { ServerContext } from "../context";
import { SchemaGridServerError } from "../errors";
import type { CellChange, ChangeBatch, ChangeConflict, ChangeError, ChangeResult } from "../internal/core";
import { ident } from "../sql/column-expr";
import { type DbRow, hydrateRow } from "../storage/hydrate";
import { jsonPath } from "../storage/keys";
import { insertChangeLog, type ChangeLogEntry } from "./change-log";
import { type GridDb, type WriteDeps, affectedRowsOf } from "./db";
import { physicalWriteValue } from "./physical";
import { type CurrentRow, type PlannedSet, type RowWritePlan, planChanges } from "./plan-changes";

const path = (key: string) => sql.raw(`'${jsonPath(key)}'`);

/** `JSON_REMOVE(JSON_SET(cells, '$.a', CAST(? AS JSON), …), '$.b', …)`, or undefined when no JSON cell changes. */
export function cellsUpdateExpr(sets: PlannedSet[]): SQL | undefined {
  const json = sets.filter((s) => !s.column.source);
  const writes = json.filter((s) => !s.remove);
  const removes = json.filter((s) => s.remove);
  if (writes.length === 0 && removes.length === 0) return undefined;
  // COALESCE guards a (legacy) NULL cells document: JSON_SET(NULL, …) would be NULL.
  let expr: SQL = sql`COALESCE(${ident("cells")}, JSON_OBJECT())`;
  if (writes.length > 0) {
    const args = writes.map((s) => {
      const json = JSON.stringify(s.serialized);
      if (typeof json !== "string") throw new Error(`Column ${s.column.id} serialized to a non-JSON value`);
      return sql`${path(s.column.key)}, CAST(${json} AS JSON)`;
    });
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
  for (const s of plan.sets) {
    if (!s.column.source) continue;
    const w = physicalWriteValue(s.column, s.remove ? null : s.serialized, deps.tables);
    values[w.field] = w.value;
  }
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

/**
 * Locking read (`FOR UPDATE`, primary-key order): sees the latest committed
 * version under REPEATABLE READ and serializes concurrent batches on the same
 * rows in a deadlock-free order.
 */
async function loadRowsForUpdate(
  tx: GridDb,
  deps: WriteDeps,
  ids: string[],
  ctx: ServerContext,
): Promise<Map<string, CurrentRow>> {
  const out = new Map<string, CurrentRow>();
  if (ids.length === 0) return out;
  const { rows } = deps.tables;
  const found = (await tx
    .select()
    .from(rows)
    .where(and(eq(rows.gridId, deps.gridId), inArray(rows.id, ids)))
    .orderBy(rows.id)
    .for("update")) as unknown as DbRow[];
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
export const MAX_BATCH_ID_LENGTH = 64;

export function conflictsFor(rowPlan: RowWritePlan, fresh: CurrentRow | undefined, ctx: ServerContext, access: AccessMap) {
  const conflicts: ChangeConflict[] = [];
  const errors: ChangeError[] = [];
  for (const s of rowPlan.sets) {
    if (!fresh || fresh.deletedAt) {
      errors.push({ rowId: rowPlan.rowId, columnId: s.column.id, message: "Row not found" });
      continue;
    }
    // Row-aware, fail-closed: the other writer may have changed what this user can see.
    const a = ctx.resolver({ user: ctx.user, column: s.column, row: fresh });
    if ((a !== "read" && a !== "edit") || !isReadable(access, s.column.id)) {
      errors.push({ rowId: rowPlan.rowId, columnId: s.column.id, message: "Unknown column" });
      continue;
    }
    const conflict: ChangeConflict = {
      rowId: rowPlan.rowId,
      columnId: s.column.id,
      serverValue: fresh.cells[s.column.key] ?? null,
      serverVersion: fresh.version,
      updatedAt: fresh.updatedAt,
    };
    if (fresh.updatedBy) conflict.updatedBy = fresh.updatedBy;
    conflicts.push(conflict);
  }
  return { conflicts, errors };
}

export async function applyChanges(batch: ChangeBatch, ctx: ServerContext, deps: WriteDeps): Promise<ChangeResult> {
  if (typeof batch.id !== "string" || batch.id.length === 0 || batch.id.length > MAX_BATCH_ID_LENGTH) {
    throw new SchemaGridServerError("INVALID_BATCH", `ChangeBatch.id must be 1..${MAX_BATCH_ID_LENGTH} characters`);
  }
  const rowIds = [...new Set(batch.changes.map((c) => c.rowId))].sort();
  const access = resolveAccess(ctx);
  return deps.db.transaction(async (tx) => {
    const txDeps: WriteDeps = { ...deps, db: tx as unknown as GridDb };
    const now = ctx.now();
    const current = await loadRowsForUpdate(txDeps.db, txDeps, rowIds, ctx);
    const plan = planChanges(batch, current, ctx);
    const applied: CellChange[] = [];
    const conflicts: ChangeConflict[] = [];
    const errors: ChangeError[] = [...plan.errors];
    const versions: Record<string, number> = {};
    const log: ChangeLogEntry[] = [];

    const rowPlans = [...plan.rowPlans].sort((a, b) => (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0));
    for (const rowPlan of rowPlans) {
      const locked = current.get(rowPlan.rowId);
      // Rows are locked, so a version mismatch here is final: report it without writing.
      if (!locked || locked.version !== rowPlan.baseVersion) {
        const c = conflictsFor(rowPlan, locked, ctx, access);
        conflicts.push(...c.conflicts);
        errors.push(...c.errors);
        continue;
      }
      const result = await buildRowUpdate(rowPlan, ctx, txDeps, now);
      if (affectedRowsOf(result) === 0) {
        // Backstop (e.g. a driver/isolation setup without locking reads).
        const fresh = (await loadRowsForUpdate(txDeps.db, txDeps, [rowPlan.rowId], ctx)).get(rowPlan.rowId);
        const c = conflictsFor(rowPlan, fresh, ctx, access);
        conflicts.push(...c.conflicts);
        errors.push(...c.errors);
        continue;
      }
      // The UPDATE is guarded by `version = baseVersion` and bumps it by exactly one.
      versions[rowPlan.rowId] = rowPlan.baseVersion + 1;
      for (const s of rowPlan.sets) {
        applied.push({ rowId: rowPlan.rowId, columnId: s.column.id, prev: s.prev, next: s.next });
        log.push({ rowId: rowPlan.rowId, columnId: s.column.id, kind: "cell", prev: s.prev, next: s.remove ? null : s.serialized });
      }
    }

    await insertChangeLog(txDeps.db, deps.tables, { gridId: deps.gridId, actor: ctx.user.id, at: now, batchId: batch.id }, log);
    return { applied, conflicts, errors, versions };
  });
}
