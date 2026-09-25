import type { Access, GridRow, GridSchema, GridUser, PermissionResolver } from "../internal/core";

/**
 * Per-cell edit check: the column must resolve to "edit" at column level, must
 * not be a formula, and the resolver called WITH the row must also say "edit"
 * (row-level override).
 */
export function createCellAccess<Row extends GridRow = GridRow>(
  schema: GridSchema,
  access: Map<string, Access>,
  resolver: PermissionResolver<Row>,
  user: GridUser,
): (row: Row, columnId: string) => boolean {
  const columns = new Map(schema.columns.map((c) => [c.id, c]));
  return (row, columnId) => {
    const column = columns.get(columnId);
    if (!column || column.type === "formula") return false;
    if (access.get(columnId) !== "edit") return false;
    return resolver({ user, column, row }) === "edit";
  };
}
