/**
 * Grid-only columns that are not schema columns:
 * - `__sg_draft__`: the GHOST column previewing a column being created in the
 *   host's column builder (`SchemaGrid.draftColumn`, mode "create").
 * - `__sg_add__`: the trailing "+" column (`SchemaGrid.onAddColumn`).
 *
 * They are never captured into views, exported, copied/pasted, part of a
 * range/fill, or keyboard-navigable (`isSyntheticColumnId` is the filter).
 */
import type { ColumnDef } from "../internal/core";

export const DRAFT_COLUMN_ID = "__sg_draft__";
export const ADD_COLUMN_ID = "__sg_add__";
const SYNTHETIC_PREFIX = "__sg_";

export function isSyntheticColumnId(colId: string | null | undefined): boolean {
  return typeof colId === "string" && colId.startsWith(SYNTHETIC_PREFIX);
}

/** Where a created column goes: an index into the displayed schema columns, or next to a column. */
export type DraftColumnInsertAt = number | { afterColumnId?: string; beforeColumnId?: string };

/**
 * A column being built in the host's column builder.
 * - "create": previewed as a ghost column (`__sg_draft__`) at `insertAt`
 *   (default: the end), read-only, showing `defaultValue` or the live formula result.
 * - "edit": the real column with the same id renders with the draft's label/config live.
 * Pass `null` to revert.
 */
export interface DraftColumn {
  column: ColumnDef;
  insertAt?: DraftColumnInsertAt;
  mode: "create" | "edit";
}

/** What `onAddColumn` receives from the "+" header. */
export interface AddColumnPosition {
  /** The last displayed schema column (the new one goes after it). */
  afterColumnId?: string;
  /** Index among the displayed schema columns (= their count). */
  index: number;
}

/** Resolves an `insertAt` to an index into `ids` (clamped; default end). */
export function resolveInsertIndex(ids: readonly string[], insertAt: DraftColumnInsertAt | undefined): number {
  if (insertAt === undefined) return ids.length;
  if (typeof insertAt === "number") return Math.max(0, Math.min(ids.length, Math.trunc(insertAt)));
  if (insertAt.afterColumnId !== undefined) {
    const i = ids.indexOf(insertAt.afterColumnId);
    if (i >= 0) return i + 1;
  }
  if (insertAt.beforeColumnId !== undefined) {
    const i = ids.indexOf(insertAt.beforeColumnId);
    if (i >= 0) return i;
  }
  return ids.length;
}

/**
 * Where the ghost column belongs in AG Grid's full column order. With
 * `maintainColumnOrder` AG Grid appends new columns at the end, so the grid
 * moves the ghost there explicitly (`api.moveColumns`).
 * - `allIds`: every grid column in order, WITHOUT the ghost;
 * - `displayedIds`: displayed schema columns (what numeric `insertAt` counts).
 * Default / out of range: the end, just before the "+" column.
 */
export function ghostTargetIndex(
  allIds: readonly string[],
  displayedIds: readonly string[],
  insertAt: DraftColumnInsertAt | undefined,
): number {
  const addIdx = allIds.indexOf(ADD_COLUMN_ID);
  const end = addIdx >= 0 ? addIdx : allIds.length;
  if (insertAt === undefined) return end;
  if (typeof insertAt === "number") {
    const n = Math.max(0, Math.trunc(insertAt));
    const anchor = displayedIds[n];
    const i = anchor === undefined ? -1 : allIds.indexOf(anchor);
    return i >= 0 ? i : end;
  }
  if (insertAt.afterColumnId !== undefined) {
    const i = allIds.indexOf(insertAt.afterColumnId);
    if (i >= 0) return i + 1;
  }
  if (insertAt.beforeColumnId !== undefined) {
    const i = allIds.indexOf(insertAt.beforeColumnId);
    if (i >= 0) return i;
  }
  return end;
}
