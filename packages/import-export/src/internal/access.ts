import type { Access, ColumnDef } from "./core";
import { HiddenColumnError } from "./errors";

/**
 * Fail-closed guard: throws HiddenColumnError when any column is "hidden" or
 * absent from the access map. Zero runtime deps (used by ./clipboard).
 */
export function assertNoHiddenColumns(
  columns: readonly ColumnDef[],
  access: ReadonlyMap<string, Access>,
): void {
  const offending = columns
    .filter((c) => {
      const a = access.get(c.id);
      return a === undefined || a === "hidden";
    })
    .map((c) => c.id);
  if (offending.length > 0) throw new HiddenColumnError(offending);
}

/** A column can receive imported values: editable and not a formula. */
export function isImportable(
  column: ColumnDef,
  access: ReadonlyMap<string, Access>,
): boolean {
  return access.get(column.id) === "edit" && column.type !== "formula";
}
