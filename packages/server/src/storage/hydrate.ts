import { type FieldTypeRegistry, type GridRow, type GridSchema, getColumnValueFieldType } from "../internal/core";
import { ISO_INSTANT_RE, YMD_RE, formatYmd, parseNaiveDatetime, utcIsoToWallTime, wallTimeToUtcIso } from "../sql/dates";

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

export interface HydrateOptions {
  /**
   * IANA zone that naive (zone-less) DATETIME values of physical `datetime`
   * columns are wall times in. Default `"UTC"` — the zone `physicalWriteValue`
   * writes, and what a mysql2 pool with `timezone: "Z"` hands back unchanged.
   */
  naiveDatetimeZone?: string;
}

const UTC = "UTC";
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * `YYYY-MM-DD` of a DATE column value as the driver returned it, without a zone
 * shift. mysql2 builds a `Date` at LOCAL or UTC midnight (its `timezone`
 * option), so the calendar fields are read in whichever of the two carries the
 * midnight; `dateStrings: true` / `DATE_FORMAT` strings are taken as-is.
 */
export function dateOnlyFromDriver(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    if (v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0) {
      return formatYmd({ year: v.getUTCFullYear(), month: v.getUTCMonth() + 1, day: v.getUTCDate() });
    }
    return formatYmd({ year: v.getFullYear(), month: v.getMonth() + 1, day: v.getDate() });
  }
  const s = String(v).trim();
  const head = s.slice(0, 10);
  return YMD_RE.test(head) ? head : null;
}

/**
 * A DATETIME column value as the driver returned it → UTC ISO. Strings are wall
 * times (`YYYY-MM-DD HH:MM:SS[.fff]`, from `dateStrings: true` / `DATE_FORMAT`)
 * in `zone`; a `Date` carries the wall time in its UTC fields (mysql2
 * `timezone: "Z"`, the documented setting) and is re-read in `zone`; an ISO
 * string with `Z`/offset is an instant already.
 */
export function naiveDatetimeToIso(v: unknown, zone: string): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    if (zone === UTC) return v.toISOString();
    return wallTimeToUtcIso(
      {
        year: v.getUTCFullYear(),
        month: v.getUTCMonth() + 1,
        day: v.getUTCDate(),
        hour: v.getUTCHours(),
        minute: v.getUTCMinutes(),
        second: v.getUTCSeconds(),
        millisecond: v.getUTCMilliseconds(),
      },
      zone,
    );
  }
  const s = String(v).trim();
  if (ISO_INSTANT_RE.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const wall = parseNaiveDatetime(s);
  if (wall) return wallTimeToUtcIso(wall, zone);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** UTC ISO → the naive `YYYY-MM-DD HH:MM:SS.fff` wall time in `zone` (what a DATETIME column stores). */
export function isoToNaiveDatetime(iso: string, zone: string): string {
  if (zone === UTC) {
    const d = new Date(iso);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, "0")}`;
  }
  return utcIsoToWallTime(iso, zone);
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

function normalizePhysical(value: unknown, type: string, zone: string): unknown {
  if (type === "date") return value instanceof Date || typeof value === "string" ? dateOnlyFromDriver(value) : value;
  if (type === "datetime") return value instanceof Date || typeof value === "string" ? naiveDatetimeToIso(value, zone) : value;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * DB row → GridRow: deserializes each stored cell through its field type,
 * copies physical `source.valueField` values into `cells[key]`, and leaves
 * absent keys absent (empty values are never stored).
 */
export function hydrateRow(
  dbRow: DbRow,
  schema: GridSchema,
  registry: FieldTypeRegistry,
  options: HydrateOptions = {},
): GridRow {
  const zone = options.naiveDatetimeZone ?? UTC;
  const stored = parseCells(dbRow.cells);
  const cells: Record<string, unknown> = {};
  for (const column of schema.columns) {
    let raw: unknown;
    if (column.source) {
      if (!(column.source.valueField in dbRow)) continue;
      raw = normalizePhysical(dbRow[column.source.valueField], column.type, zone);
      if (raw === null || raw === undefined) continue;
    } else {
      if (!(column.key in stored)) continue;
      raw = stored[column.key];
      if (raw === null) continue;
    }
    const ft = column.type === "formula" ? undefined : getColumnValueFieldType(column, registry);
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
