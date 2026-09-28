/**
 * v0.4.1: why a cell can't be edited, with the one refusal message per reason
 * that every write path (servers, core's in-memory source, the grid's
 * client-side pre-check) uses. Per-person refusals never list ids or roles.
 */
import type { ColumnDef } from "../schema/types";
import type { Access } from "./types";

/** A formula column: computed, never written. */
export const FORMULA_READ_ONLY_MESSAGE = "Column is read-only (formula)";
/** A `settable: false` column, or edit refused by something other than `permissions.edit`. */
export const COLUMN_READ_ONLY_MESSAGE = "Column is read-only";
/** Edit refused by the column's `permissions.edit` (the user matches neither `roles` nor `users`). */
export const PERMISSION_EDIT_DENIED_MESSAGE = "Only specific people can edit this column";

/**
 * - `formula`: a formula column.
 * - `readOnly`: `settable: false`, or access below "edit" on a column without
 *   `permissions` (a custom resolver said no).
 * - `permission`: access below "edit" on a column whose `permissions.edit` rule
 *   the user doesn't match.
 */
export type CellEditDenialReason = "formula" | "readOnly" | "permission";

export interface CellEditDenial {
  reason: CellEditDenialReason;
  message: string;
}

/**
 * Why `column` isn't editable for a user whose (row-aware) access is
 * `access`, or null when it is. Formula beats `settable: false` beats
 * permissions. Callers answer hidden columns ("hidden" / undefined access)
 * like unknown ones BEFORE calling this, so hidden columns stay undetectable.
 */
export function cellEditDenial(column: ColumnDef, access: Access | undefined): CellEditDenial | null {
  if (column.type === "formula") return { reason: "formula", message: FORMULA_READ_ONLY_MESSAGE };
  if (column.settable === false) return { reason: "readOnly", message: COLUMN_READ_ONLY_MESSAGE };
  if (access === "edit") return null;
  return column.permissions
    ? { reason: "permission", message: PERMISSION_EDIT_DENIED_MESSAGE }
    : { reason: "readOnly", message: COLUMN_READ_ONLY_MESSAGE };
}
