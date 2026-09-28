import type { CellColor, GridRow, GridSchema } from "../internal/core";
import { type AccessMap, isReadable } from "./query-access";

/**
 * Final JS guard: drops every cell whose column is not readable (or unknown),
 * and (v0.4) every manual color whose column is not readable; a row left with
 * no colors carries no `colors` key.
 */
export function projectRow<Row extends GridRow>(row: Row, schema: GridSchema, access: AccessMap): Row {
  const readable = schema.columns.filter((c) => isReadable(access, c.id));
  const readableKeys = new Set(readable.map((c) => c.key));
  const cells: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row.cells)) if (readableKeys.has(k)) cells[k] = v;
  const { colors: rawColors, ...rest } = row;
  const out = { ...rest, cells } as Row;
  if (rawColors && typeof rawColors === "object") {
    const readableIds = new Set(readable.map((c) => c.id));
    const colors: Record<string, CellColor> = {};
    for (const [id, color] of Object.entries(rawColors)) if (readableIds.has(id)) colors[id] = color;
    if (Object.keys(colors).length > 0) out.colors = colors;
  }
  return out;
}
