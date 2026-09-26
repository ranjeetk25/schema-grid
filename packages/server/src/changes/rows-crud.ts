import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { projectRow } from "../access/projection";
import { resolveAccess } from "../access/query-access";
import type { ServerContext } from "../context";
import { PermissionError, RowValidationError } from "../errors";
import { type GridRow, type PermissionUser, type RowPartial, getColumnValueFieldType } from "../internal/core";
import { ident } from "../sql/column-expr";
import { hydrateRow } from "../storage/hydrate";
import { type ChangeLogEntry, insertChangeLog } from "./change-log";
import type { GridDb, WriteDeps } from "./db";
import { validateCellValue } from "./plan-changes";
import { physicalWriteValue } from "./physical";
import { uuidv7 } from "./uuid";

export interface CreateRowsOptions {
  generateId?: () => string;
  /** Applied to hydrated rows before projection (formula evaluation hook). */
  transformRows?: (rows: GridRow[]) => GridRow[];
  /** Post-read hook (see `RowSource.mapRows`): after `transformRows`, before projection. */
  mapRows?: (rows: GridRow[]) => Promise<GridRow[]> | GridRow[];
  /** Zone of naive DATETIME wall times in physical `datetime` columns. Default UTC. */
  naiveDatetimeZone?: string;
}

/**
 * Inserts rows at version 1. Each cell comes from the partial (must be editable
 * for the user, never a formula nor `settable: false`), else `ColumnDef.defaultValue`, else the type's
 * `defaultValue(config)`. Invalid/unknown/non-editable input throws
 * `RowValidationError` before anything is written. Logs one `create` entry per row.
 */
export async function createRows(
  partials: RowPartial[],
  ctx: ServerContext,
  deps: WriteDeps,
  options: CreateRowsOptions = {},
): Promise<GridRow[]> {
  if (partials.length === 0) return [];
  const now = ctx.now();
  const byKey = new Map(ctx.schema.columns.map((c) => [c.key, c]));
  const inserts: Record<string, unknown>[] = [];
  const log: ChangeLogEntry[] = [];

  partials.forEach((partial, rowIndex) => {
    const given = (partial.cells ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(given)) {
      const column = byKey.get(key);
      if (!column) throw new RowValidationError(rowIndex, key, "Unknown column");
      if (column.type === "formula") throw new RowValidationError(rowIndex, column.id, "Column is read-only (formula)");
      // `settable: false` rejects explicit values only; its default below is still written (v0.2 C1).
      if (ctx.resolver({ user: ctx.user, column }) !== "edit" || column.settable === false) {
        throw new RowValidationError(rowIndex, column.id, "Column is read-only");
      }
    }
    const id = partial.id ?? (options.generateId ? options.generateId() : uuidv7(now.getTime()));
    const cells: Record<string, unknown> = {};
    const values: Record<string, unknown> = { id, gridId: deps.gridId, version: 1, updatedAt: now, updatedBy: ctx.user.id };
    for (const column of ctx.schema.columns) {
      if (column.type === "formula") continue;
      let value: unknown;
      if (column.key in given) value = given[column.key];
      else if (column.defaultValue !== undefined) value = column.defaultValue;
      else value = getColumnValueFieldType(column, ctx.registry)?.defaultValue(column.config) ?? null;
      const v = validateCellValue(column, value, ctx);
      if (!v.ok) throw new RowValidationError(rowIndex, column.id, v.message);
      if (column.source) {
        const w = physicalWriteValue(column, v.remove ? null : v.serialized, deps.tables);
        values[w.field] = w.value;
      } else if (!v.remove) {
        cells[column.key] = v.serialized;
      }
    }
    values.cells = cells;
    inserts.push(values);
    const physical = Object.fromEntries(
      ctx.schema.columns.filter((c) => c.source).map((c) => [c.key, values[(c.source as { valueField: string }).valueField] ?? null]),
    );
    log.push({ rowId: id, columnId: null, kind: "create", prev: null, next: { ...cells, ...physical } });
  });

  await deps.db.transaction(async (tx) => {
    await tx.insert(deps.tables.rows).values(inserts as never);
    await insertChangeLog(tx as unknown as GridDb, deps.tables, { gridId: deps.gridId, actor: ctx.user.id, at: now, batchId: null }, log);
  });

  const access = resolveAccess(ctx);
  let rows = inserts.map((v) =>
    hydrateRow(
      { ...(v as { id: string; version: number; cells: Record<string, unknown> }), updatedAt: now, updatedBy: ctx.user.id },
      ctx.schema,
      ctx.registry,
      options.naiveDatetimeZone ? { naiveDatetimeZone: options.naiveDatetimeZone } : {},
    ),
  );
  if (options.transformRows) rows = options.transformRows(rows);
  if (options.mapRows) rows = await options.mapRows(rows);
  return rows.map((r) => projectRow(r, ctx.schema, access));
}

export interface DeleteRowsOptions {
  /** Row-deletion permission hook. Default: allow. */
  canDeleteRows?: (user: PermissionUser) => boolean;
}

/**
 * Soft-deletes rows (sets `deleted_at`, bumps `version`) and logs one `delete`
 * entry per row. Unknown and already-deleted ids are skipped silently. Returns
 * the ids actually deleted (v0.3.1; `[]` when nothing was live).
 */
export async function deleteRows(ids: string[], ctx: ServerContext, deps: WriteDeps, options: DeleteRowsOptions = {}): Promise<string[]> {
  if (options.canDeleteRows && !options.canDeleteRows(ctx.user)) throw new PermissionError([], "edit", "Row deletion denied");
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const now = ctx.now();
  const { rows } = deps.tables;
  return deps.db.transaction(async (tx) => {
    const live = await tx
      .select({ id: rows.id })
      .from(rows)
      .where(and(eq(rows.gridId, deps.gridId), inArray(rows.id, unique), isNull(rows.deletedAt)));
    const liveIds = live.map((r) => r.id);
    if (liveIds.length === 0) return [];
    await tx
      .update(rows)
      .set({ deletedAt: now, updatedAt: now, updatedBy: ctx.user.id, version: sql`${ident("version")} + 1` } as never)
      .where(and(eq(rows.gridId, deps.gridId), inArray(rows.id, liveIds), isNull(rows.deletedAt)));
    await insertChangeLog(
      tx as unknown as GridDb,
      deps.tables,
      { gridId: deps.gridId, actor: ctx.user.id, at: now, batchId: null },
      liveIds.map((rowId) => ({ rowId, columnId: null, kind: "delete" as const, prev: null, next: null })),
    );
    return liveIds;
  });
}
