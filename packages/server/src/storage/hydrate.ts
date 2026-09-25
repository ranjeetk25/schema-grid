import { type FieldTypeRegistry, type GridRow, type GridSchema, getColumnFieldType } from "../internal/core";

/** Raw row as selected from the rows table (plus any physical columns). */
export interface DbRow {
  id: string;
  version: number;
  updatedAt: Date | string;
  updatedBy?: string | null;
  deletedAt?: Date | string | null;
  cells: Record<string, unknown> | string | null;
  [physical: string]: unknown;
}

export function toIso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  // MySQL "YYYY-MM-DD HH:MM:SS.fff" (UTC by convention) or ISO
  const s = v.includes("T") ? v : `${v.replace(" ", "T")}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

function parseCells(raw: DbRow["cells"]): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw;
}

function normalizePhysical(value: unknown, type: string): unknown {
  if (value instanceof Date) return type === "date" ? value.toISOString().slice(0, 10) : value.toISOString();
  if (typeof value === "string" && type === "datetime") return toIso(value);
  return value;
}

/**
 * DB row → GridRow: deserializes each stored cell through its field type,
 * copies physical `source.valueField` values into `cells[key]`, and leaves
 * absent keys absent (empty values are never stored).
 */
export function hydrateRow(dbRow: DbRow, schema: GridSchema, registry: FieldTypeRegistry): GridRow {
  const stored = parseCells(dbRow.cells);
  const cells: Record<string, unknown> = {};
  for (const column of schema.columns) {
    let raw: unknown;
    if (column.source) {
      if (!(column.source.valueField in dbRow)) continue;
      raw = normalizePhysical(dbRow[column.source.valueField], column.type);
      if (raw === null || raw === undefined) continue;
    } else {
      if (!(column.key in stored)) continue;
      raw = stored[column.key];
      if (raw === null) continue;
    }
    const ft = column.type === "formula" ? undefined : getColumnFieldType(column, registry);
    cells[column.key] = ft ? ft.deserialize(raw) : raw;
  }
  const row: GridRow = {
    id: dbRow.id,
    version: Number(dbRow.version),
    updatedAt: toIso(dbRow.updatedAt),
    cells,
  };
  if (dbRow.updatedBy) row.updatedBy = { id: dbRow.updatedBy };
  return row;
}
