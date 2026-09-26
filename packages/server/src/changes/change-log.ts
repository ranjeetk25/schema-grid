import type { ChangeMeta } from "../internal/core";
import type { GridDb } from "./db";
import { type GridTables, legacyChangeLogTableFor } from "../storage/tables";

export type ChangeLogKind = "cell" | "create" | "delete";

export interface ChangeLogEntry {
  rowId: string;
  columnId: string | null;
  kind: ChangeLogKind;
  prev: unknown;
  next: unknown;
  /** v0.3: the change's input-only side data, stored as JSON in `meta` (NULL when absent). */
  meta?: ChangeMeta;
}

/** MySQL `ER_BAD_FIELD_ERROR`: the change_log table predates the `meta` column. */
const ER_BAD_FIELD_ERROR = 1054;

/** Change-log tables (by name) known to lack the `meta` column; inserts skip it from then on. */
const legacyTables = new Set<string>();

function isUnknownColumnError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const e = current as { errno?: unknown; code?: unknown; cause?: unknown };
    if (e.errno === ER_BAD_FIELD_ERROR || e.code === "ER_BAD_FIELD_ERROR") return true;
    current = e.cause;
  }
  return false;
}

/** Forgets which tables were detected as legacy (tests). */
export function resetChangeLogLegacyDetection(): void {
  legacyTables.clear();
}

/**
 * Bulk-inserts change_log rows (no-op for an empty list). Runs on the caller's
 * transaction. The `meta` column (v0.3) is written when the table has it; on a
 * table created before v0.3 (`ER_BAD_FIELD_ERROR`) the insert is retried
 * without the column and the table is remembered as legacy for the process
 * lifetime — writes never fail because of the missing column, `meta` is simply
 * not logged. Add it with `alterChangeLogTableMetaDDL` (`ALTER TABLE … ADD COLUMN meta JSON NULL`).
 */
export async function insertChangeLog(
  tx: GridDb,
  tables: GridTables,
  meta: { gridId: string; actor: string; at: Date; batchId: string | null },
  entries: ChangeLogEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const base = entries.map((e) => ({
    gridId: meta.gridId,
    rowId: e.rowId,
    columnId: e.columnId,
    kind: e.kind,
    prev: e.prev ?? null,
    next: e.next ?? null,
    actor: meta.actor,
    at: meta.at,
    batchId: meta.batchId,
  }));
  const legacy = () => tx.insert(legacyChangeLogTableFor(tables.changeLogTableName)).values(base);
  if (legacyTables.has(tables.changeLogTableName)) {
    await legacy();
    return;
  }
  try {
    await tx.insert(tables.changeLog).values(base.map((row, i) => ({ ...row, meta: entries[i]?.meta ?? null })));
  } catch (err) {
    if (!isUnknownColumnError(err)) throw err;
    legacyTables.add(tables.changeLogTableName);
    await legacy();
  }
}
