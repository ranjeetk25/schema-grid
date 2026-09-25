import { SchemaValidationError } from "../errors";
import type { ColumnDef } from "../internal/core";
import type { GridTables } from "../storage/tables";

/**
 * Driver value for a physical (`source.valueField`) column write. Throws when the
 * valueField is not a declared physical column (drizzle would silently drop it).
 * Datetimes: `Date` for drizzle datetime/timestamp columns (their mapper writes
 * UTC), otherwise a UTC `YYYY-MM-DD HH:MM:SS.fff` string (never mysql2's local-time Date formatting).
 */
export function physicalWriteValue(column: ColumnDef, value: unknown, tables: GridTables): { field: string; value: unknown } {
  const field = (column.source as { valueField: string }).valueField;
  const physical = tables.physical[field];
  if (!physical) {
    throw new SchemaValidationError([
      {
        code: "unknownValueField",
        columnId: column.id,
        path: ["source", "valueField"],
        message: `Physical column "${field}" is not defined on the rows table`,
      },
    ]);
  }
  if (value === null || value === undefined) return { field, value: null };
  if (column.type === "datetime" && typeof value === "string") {
    const d = new Date(value);
    const t = physical.columnType;
    return t === "MySqlDateTime" || t === "MySqlTimestamp"
      ? { field, value: d }
      : { field, value: d.toISOString().replace("T", " ").replace("Z", "") };
  }
  return { field, value };
}
