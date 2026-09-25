import type { GridDb } from "./db";
import type { GridTables } from "../storage/tables";

export type ChangeLogKind = "cell" | "create" | "delete";

export interface ChangeLogEntry {
  rowId: string;
  columnId: string | null;
  kind: ChangeLogKind;
  prev: unknown;
  next: unknown;
}

/** Bulk-inserts change_log rows (no-op for an empty list). Runs on the caller's transaction. */
export async function insertChangeLog(
  tx: GridDb,
  tables: GridTables,
  meta: { gridId: string; actor: string; at: Date; batchId: string | null },
  entries: ChangeLogEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await tx.insert(tables.changeLog).values(
    entries.map((e) => ({
      gridId: meta.gridId,
      rowId: e.rowId,
      columnId: e.columnId,
      kind: e.kind,
      prev: e.prev ?? null,
      next: e.next ?? null,
      actor: meta.actor,
      at: meta.at,
      batchId: meta.batchId,
    })),
  );
}
