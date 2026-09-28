import { type SQL, and, eq, inArray, sql } from "drizzle-orm";
import type { AccessMap } from "../access/query-access";
import type { GridDb } from "../changes/db";
import type { ServerContext } from "../context";
import { SchemaGridServerError } from "../errors";
import {
  type CellColor,
  type CellColorBatch,
  type CellColorChange,
  type CellColorResult,
  COLUMN_READ_ONLY_MESSAGE,
  type GridRow,
  canColorCell,
  cellEditDenial,
  isCellColor,
} from "../internal/core";
import { ident } from "../sql/column-expr";
import { cellColorJsonPath } from "./color-sql";
import type { CellColorStore } from "./color-store";

/** Same limit as `ChangeBatch.id` (`INVALID_BATCH` otherwise). */
const MAX_BATCH_ID_LENGTH = 64;

/** Final color per changed cell (null = cleared), grouped by row, in first-applied order. */
export type CellColorWrites = Map<string, Map<string, CellColor | null>>;

export interface CellColorPlan {
  applied: CellColorChange[];
  rejected: CellColorResult["rejected"];
  writes: CellColorWrites;
}

/** `CellColorBatch.id` must be 1..64 characters, `changes` a list. */
export function assertCellColorBatch(batch: CellColorBatch): void {
  if (typeof batch?.id !== "string" || batch.id.length === 0 || batch.id.length > MAX_BATCH_ID_LENGTH) {
    throw new SchemaGridServerError("INVALID_BATCH", `CellColorBatch.id must be 1..${MAX_BATCH_ID_LENGTH} characters`);
  }
  if (!Array.isArray(batch.changes)) throw new SchemaGridServerError("INVALID_BATCH", "CellColorBatch.changes must be a list");
}

/** Distinct row ids of a batch, sorted (the lock order of the write path). */
export function cellColorRowIds(batch: CellColorBatch): string[] {
  return [...new Set(batch.changes.map((c) => c?.rowId).filter((id): id is string => typeof id === "string"))].sort();
}

/**
 * Checks every change like core's in-memory source, in order: an unknown or
 * deleted row → "Row not found"; an unknown column, or one the caller cannot
 * read → "Column not found"; a cell the caller may not edit (`canColorCell`:
 * row-aware resolver says edit, not a formula, not `settable: false`, and
 * edit in the row-independent access map) → core's `cellEditDenial` message
 * (v0.4.1: "Column is read-only (formula)", "Column is read-only" or, for a
 * `permissions.edit` refusal, "Only specific people can edit this column"); anything but a
 * palette color or null → "Invalid color". The last applied change of a cell wins.
 * `rows` are the LIVE rows (hydrated with every cell, hidden ones included).
 */
export function planCellColors(
  batch: CellColorBatch,
  rows: ReadonlyMap<string, GridRow>,
  ctx: ServerContext,
  access: AccessMap,
): CellColorPlan {
  const byId = new Map(ctx.schema.columns.map((c) => [c.id, c]));
  const applied: CellColorChange[] = [];
  const rejected: CellColorResult["rejected"] = [];
  const writes: CellColorWrites = new Map();
  for (const change of batch.changes) {
    const { rowId, columnId, color } = change;
    const reject = (message: string) => rejected.push({ rowId, columnId, message });
    const row = rows.get(rowId);
    const column = byId.get(columnId);
    const a = column ? access.get(column.id) : undefined;
    if (!row) reject("Row not found");
    else if (!column || (a !== "read" && a !== "edit")) reject("Column not found");
    else if (a !== "edit" || !canColorCell(row, column, ctx.user, ctx.resolver)) {
      reject(cellEditDenial(column, "read")?.message ?? COLUMN_READ_ONLY_MESSAGE);
    }
    else if (color !== null && !isCellColor(color)) reject("Invalid color");
    else {
      let cells = writes.get(rowId);
      if (!cells) {
        cells = new Map();
        writes.set(rowId, cells);
      }
      cells.set(column.id, color);
      applied.push({ rowId, columnId, color });
    }
  }
  return { applied, rejected, writes };
}

/**
 * Upserts each row's colors document, one statement per row (sorted by row id):
 * `INSERT … ON DUPLICATE KEY UPDATE colors = JSON_REMOVE(JSON_SET(colors, '$."c"', 'red', …), '$."d"', …)`,
 * setting `updated_at` / `updated_by`. A document emptied by clears stays (as
 * `{}`) so its `updated_at` still reaches the change feed. Run it inside the
 * caller's transaction.
 */
export async function writeCellColors(
  db: GridDb,
  store: CellColorStore,
  gridId: string,
  writes: CellColorWrites,
  actor: string,
  now: Date,
): Promise<void> {
  const t = store.table;
  for (const rowId of [...writes.keys()].sort()) {
    const cells = [...(writes.get(rowId) ?? new Map<string, CellColor | null>())];
    const sets = cells.filter((e): e is [string, CellColor] => e[1] !== null);
    const removes = cells.filter(([, color]) => color === null).map(([columnId]) => columnId);
    let doc: SQL = sql`COALESCE(${ident("colors")}, JSON_OBJECT())`;
    if (sets.length > 0) {
      doc = sql`JSON_SET(${doc}, ${sql.join(
        sets.map(([columnId, color]) => sql`${cellColorJsonPath(columnId)}, ${color}`),
        sql`, `,
      )})`;
    }
    if (removes.length > 0) {
      doc = sql`JSON_REMOVE(${doc}, ${sql.join(
        removes.map((columnId) => sql`${cellColorJsonPath(columnId)}`),
        sql`, `,
      )})`;
    }
    await db
      .insert(t)
      .values({ gridId, rowId, colors: Object.fromEntries(sets), updatedAt: now, updatedBy: actor })
      .onDuplicateKeyUpdate({ set: { colors: doc, updatedAt: now, updatedBy: actor } as never });
  }
}

/** The stored colors documents of `ids` (raw, see `parseCellColors`), by row id. */
export async function loadCellColors(
  db: GridDb,
  store: CellColorStore,
  gridId: string,
  ids: readonly string[],
): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  if (ids.length === 0) return out;
  const t = store.table;
  const found = (await db
    .select({ rowId: t.rowId, colors: t.colors })
    .from(t)
    .where(and(eq(t.gridId, gridId), inArray(t.rowId, [...new Set(ids)])))) as { rowId: string; colors: unknown }[];
  for (const r of found) out.set(String(r.rowId), r.colors);
  return out;
}

/** Deletes the colors of deleted rows (same transaction as the row deletion). */
export async function deleteCellColors(db: GridDb, store: CellColorStore, gridId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const t = store.table;
  await db.delete(t).where(and(eq(t.gridId, gridId), inArray(t.rowId, [...ids])));
}
