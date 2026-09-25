import type { ServerContext } from "../context";
import {
  type ChangeBatch,
  type ChangeError,
  type ColumnDef,
  type GridRow,
  getColumnValueFieldType,
  isEmptyValue,
} from "../internal/core";

/** Current server state of a row; `deletedAt` set means soft-deleted. */
export type CurrentRow = GridRow & { deletedAt?: string | null };

export interface PlannedSet {
  column: ColumnDef;
  /** Validated value as the client will see it. `null` for empty. */
  next: unknown;
  /** Storage form (field type `serialize`). Ignored when `remove`. */
  serialized: unknown;
  /** Server's current value (not the client's `prev`). */
  prev: unknown;
  /** Empty value: stored by removing the key (JSON_REMOVE) / NULL for physical columns. */
  remove: boolean;
}

export interface RowWritePlan {
  rowId: string;
  baseVersion: number;
  sets: PlannedSet[];
}

export interface ChangePlan {
  rowPlans: RowWritePlan[];
  errors: ChangeError[];
}

export interface ValidatedCell {
  ok: true;
  next: unknown;
  serialized: unknown;
  remove: boolean;
}

/** `ColumnDef.validation` limits copied into the field config before `valueSchema` (as core's in-memory source does). */
function configWithLimits(column: ColumnDef): unknown {
  const v = column.validation;
  if (!v) return column.config;
  const limits: Record<string, number> = {};
  for (const k of ["min", "max", "minLength", "maxLength"] as const) {
    const n = v[k];
    if (typeof n === "number") limits[k] = n;
  }
  return typeof column.config === "object" && column.config !== null
    ? { ...(column.config as Record<string, unknown>), ...limits }
    : limits;
}

/**
 * Validates + serializes one value for a column (shared by applyChanges and createRows).
 * Mirrors core's `validateCellValue`: required, `valueSchema` with validation limits,
 * `validation.pattern`, `validation.message` override.
 */
export function validateCellValue(
  column: ColumnDef,
  value: unknown,
  ctx: ServerContext,
): ValidatedCell | { ok: false; message: string } {
  const ft = getColumnValueFieldType(column, ctx.registry);
  if (!ft) return { ok: false, message: `Unknown field type "${column.type}"` };
  const normalized = isEmptyValue(value) ? null : value;
  if (normalized === null && column.required) return { ok: false, message: "Value is required" };
  const v = column.validation;
  let parsed: ReturnType<ReturnType<typeof ft.valueSchema>["safeParse"]>;
  try {
    parsed = ft.valueSchema(configWithLimits(column)).safeParse(normalized);
  } catch {
    return { ok: false, message: "Invalid value" };
  }
  if (!parsed.success) return { ok: false, message: v?.message ?? parsed.error.issues[0]?.message ?? "Invalid value" };
  if (v?.pattern && typeof normalized === "string") {
    try {
      if (!new RegExp(v.pattern).test(normalized)) {
        return { ok: false, message: v.message ?? "Value does not match the required pattern" };
      }
    } catch {
      // An invalid pattern in the schema is ignored rather than blocking edits (matches core).
    }
  }
  const next = isEmptyValue(parsed.data) ? null : parsed.data;
  if (next === null) return { ok: true, next: null, serialized: null, remove: true };
  const serialized = ft.serialize(next);
  if (isEmptyValue(serialized)) return { ok: true, next: null, serialized: null, remove: true };
  return { ok: true, next, serialized, remove: false };
}

/**
 * Validation phase of `applyChanges` (no DB access). Collapses repeated edits of
 * one cell to the last, rejects per-change (missing/deleted row, missing base
 * version, unknown column, not editable for this user+row, invalid value) and
 * returns one write plan per row with at least one valid change.
 */
export function planChanges(
  batch: ChangeBatch,
  currentRows: ReadonlyMap<string, CurrentRow | undefined>,
  ctx: ServerContext,
): ChangePlan {
  const errors: ChangeError[] = [];
  const byId = new Map(ctx.schema.columns.map((c) => [c.id, c]));

  // Last write wins per (row, column); rows keep first-seen order, a repeated cell moves to its last position.
  const collapsed = new Map<string, Map<string, unknown>>();
  for (const change of batch.changes) {
    let cells = collapsed.get(change.rowId);
    if (!cells) {
      cells = new Map();
      collapsed.set(change.rowId, cells);
    }
    cells.delete(change.columnId);
    cells.set(change.columnId, change.next);
  }

  const rowPlans: RowWritePlan[] = [];
  for (const [rowId, cells] of collapsed) {
    const row = currentRows.get(rowId);
    const fail = (columnId: string, message: string) => errors.push({ rowId, columnId, message });
    if (!row || row.deletedAt) {
      for (const columnId of cells.keys()) fail(columnId, "Row not found");
      continue;
    }
    const baseVersion = batch.baseVersions[rowId];
    if (typeof baseVersion !== "number") {
      for (const columnId of cells.keys()) fail(columnId, "Missing base version for row");
      continue;
    }
    const sets: PlannedSet[] = [];
    for (const [columnId, next] of cells) {
      const column = byId.get(columnId);
      if (!column) {
        fail(columnId, "Unknown column");
        continue;
      }
      const access = ctx.resolver({ user: ctx.user, column, row });
      if (access !== "read" && access !== "edit") {
        // Same message as a missing column: hidden columns must not be detectable.
        fail(columnId, "Unknown column");
        continue;
      }
      if (column.type === "formula") {
        fail(columnId, "Column is read-only (formula)");
        continue;
      }
      if (access !== "edit") {
        fail(columnId, "Column is read-only");
        continue;
      }
      const v = validateCellValue(column, next, ctx);
      if (!v.ok) {
        fail(columnId, v.message);
        continue;
      }
      sets.push({ column, next: v.next, serialized: v.serialized, prev: row.cells[column.key] ?? null, remove: v.remove });
    }
    if (sets.length > 0) rowPlans.push({ rowId, baseVersion, sets });
  }
  return { rowPlans, errors };
}
