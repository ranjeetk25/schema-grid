import type { GridRow, GridSchema } from "../internal/core";
import { type AccessMap, isReadable } from "./query-access";

/** Final JS guard: drops every cell whose column is not readable (or unknown). */
export function projectRow<Row extends GridRow>(row: Row, schema: GridSchema, access: AccessMap): Row {
  const readableKeys = new Set(schema.columns.filter((c) => isReadable(access, c.id)).map((c) => c.key));
  const cells: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row.cells)) if (readableKeys.has(k)) cells[k] = v;
  return { ...row, cells };
}
