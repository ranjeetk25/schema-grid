import type { Access, ColumnDef, GridSchema } from "./core-contracts";

export type AccessMap = ReadonlyMap<string, Access>;

/** A column is readable only when the access map says read/edit. Missing = hidden (fail closed). */
export function isReadable(access: AccessMap, columnId: string): boolean {
  const a = access.get(columnId);
  return a === "read" || a === "edit";
}

export function isWritable(access: AccessMap, column: ColumnDef): boolean {
  return access.get(column.id) === "edit" && column.type !== "formula";
}

/** Non-hidden columns in schema order (by `order`, then declaration). Use for every picker. */
export function readableColumns(schema: GridSchema, access: AccessMap): ColumnDef[] {
  return [...schema.columns].filter((c) => isReadable(access, c.id)).sort((a, b) => a.order - b.order);
}

/** Editable, non-formula, non-hidden columns (import targets, etc.). */
export function writableColumns(schema: GridSchema, access: AccessMap): ColumnDef[] {
  return readableColumns(schema, access).filter((c) => isWritable(access, c));
}

export function readableColumnIds(schema: GridSchema, access: AccessMap): Set<string> {
  return new Set(readableColumns(schema, access).map((c) => c.id));
}
