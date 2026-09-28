import type { PermissionResolver, PermissionUser } from "../permissions/types";
import type { GridRow } from "../rows/types";
import type { ColumnDef } from "../schema/types";

/**
 * Who may paint a cell (manual color): exactly those whose effective access to
 * it is "edit" — the resolver says edit for this row, the column is not a
 * formula and not `settable: false`. No separate permission. Without a user
 * (no-user sources such as a bare in-memory grid) every settable, non-formula
 * cell is paintable.
 */
export function canColorCell(
  row: GridRow | undefined,
  column: ColumnDef,
  user: PermissionUser | undefined,
  resolver: PermissionResolver,
): boolean {
  if (column.type === "formula" || column.settable === false) return false;
  if (!user) return true;
  return resolver(row ? { user, column, row } : { user, column }) === "edit";
}
