import { and, asc, eq, gt, max } from "drizzle-orm";
import type { WriteDeps } from "../changes/db";
import { type ReadRowsOptions, readRowsById } from "../changes/read-rows";
import type { ServerContext } from "../context";
import { CursorError } from "../errors";
import type { ChangeFeedEntry, GridRow } from "../internal/core";

export interface GetChangesOptions extends ReadRowsOptions {
  /** Max change_log entries to read per call. Default 1000, clamped to 1..10000. */
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 1000;
const MIN_MAX_ENTRIES = 1;
const MAX_MAX_ENTRIES = 10000;

function clampMaxEntries(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_MAX_ENTRIES;
  return Math.min(MAX_MAX_ENTRIES, Math.max(MIN_MAX_ENTRIES, Math.trunc(n)));
}

function parseCursor(since: string): number {
  if (!/^\d+$/.test(since)) throw new CursorError(`Invalid cursor "${since}"`, { since });
  const n = Number(since);
  if (!Number.isSafeInteger(n)) throw new CursorError(`Invalid cursor "${since}"`, { since });
  return n;
}

/**
 * Polling change feed backed by `change_log`: reads log entries with
 * `id > since` (or bootstraps at the current max id when `since` is empty),
 * then returns the latest state of every distinct row touched — live rows
 * hydrated/formula-evaluated/projected, deleted (or missing) rows by id only.
 */
export async function getChanges(
  since: string | undefined,
  ctx: ServerContext,
  deps: WriteDeps,
  options: GetChangesOptions = {},
): Promise<ChangeFeedEntry<GridRow>> {
  const { db, tables, gridId } = deps;
  const maxEntries = clampMaxEntries(options.maxEntries);
  const schemaVersion = ctx.schema.schemaVersion;

  if (since === undefined || since === "") {
    const rows = (await db
      .select({ maxId: max(tables.changeLog.id) })
      .from(tables.changeLog)
      .where(eq(tables.changeLog.gridId, gridId))) as unknown as { maxId: number | string | null }[];
    const maxId = rows[0]?.maxId;
    const cursor = maxId === null || maxId === undefined ? "0" : String(maxId);
    return { cursor, rows: [], deletedRowIds: [], schemaVersion };
  }

  const sinceId = parseCursor(since);

  const entries = (await db
    .select({ id: tables.changeLog.id, rowId: tables.changeLog.rowId })
    .from(tables.changeLog)
    .where(and(eq(tables.changeLog.gridId, gridId), gt(tables.changeLog.id, sinceId)))
    .orderBy(asc(tables.changeLog.id))
    .limit(maxEntries)) as unknown as { id: number; rowId: string }[];

  if (entries.length === 0) {
    return { cursor: since, rows: [], deletedRowIds: [], schemaVersion };
  }

  const cursor = String(entries[entries.length - 1]?.id);
  const rowIds: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!seen.has(e.rowId)) {
      seen.add(e.rowId);
      rowIds.push(e.rowId);
    }
  }

  // Live rows in log order; ids the read skipped were deleted (or never existed).
  const rows = await readRowsById(db, deps, ctx, rowIds, options);
  const live = new Set(rows.map((r) => r.id));
  const deletedRowIds = rowIds.filter((id) => !live.has(id));

  return { cursor, rows, deletedRowIds, schemaVersion };
}

