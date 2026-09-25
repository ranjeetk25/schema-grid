/**
 * Pure conversion from a stored cell value to an Excel cell or CSV text.
 * Every per-type export rule lives here.
 *
 * XLSX note: exceljs writes JS strings as string cells (never as formulas), so
 * text cells need no formula-injection prefix in XLSX. CSV has no cell types,
 * so text-like CSV output goes through `sanitizeCsvText`.
 */
import {
  type ColumnDef,
  type FieldTypeRegistry,
  getColumnFieldType,
  getNumericConfig,
  getSelectOptions,
} from "../internal/core";
import { sanitizeCsvText } from "../internal/csv-guard";
import { toIsoDate, toZonedWallClock } from "../internal/tz";
import type { ExcelCell } from "./types";

const DATE_FMT = "yyyy-mm-dd";
const DATETIME_FMT = "yyyy-mm-dd hh:mm";
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const HAS_ZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const HYPERLINK_RE = /^(https?:\/\/|mailto:)/i;
/** Excel refuses (and "repairs") hyperlinks longer than this. */
const MAX_HYPERLINK = 2079;
const NUMERIC_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

/**
 * CSV output shapes that cannot carry a formula payload, so they are written
 * unguarded whatever the column type: plain/currency numbers (incl. a leading
 * sign), phone-like digit strings, dates/datetimes and booleans. Everything
 * else goes through `sanitizeCsvText` — keyed on the OUTPUT, not the column
 * type, because a type's `format` can echo stored text for invalid values.
 */
const SAFE_CSV_SHAPES = [
  /^[-+]?\p{Sc}?\s?[-+]?\d[\d.,\s]*%?$/u,
  /^\+?[\d\s().-]{4,}$/,
  /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i,
  /^(?:true|false)$/i,
];

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Field type `format`, falling back to String(value) for unknown types or a throwing format. */
function formatValue(
  value: unknown,
  column: ColumnDef,
  registry: FieldTypeRegistry,
): string {
  const type = getColumnFieldType(column, registry);
  if (!type) return String(value);
  try {
    return type.format(value, column.config);
  } catch {
    return String(value);
  }
}

/**
 * A JS number safe to hand to Excel, or null to write the value as text:
 * non-finite values, and anything beyond Excel's 15 significant digits
 * (phone-like ids in a number column would otherwise be silently rounded).
 */
function toFiniteNumber(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string") {
    const t = value.trim();
    if (!NUMERIC_RE.test(t)) return null;
    const digits = t.replace(/^[-+]/, "").replace(/e.*$/i, "").replace(".", "").replace(/^0+/, "");
    if (digits.replace(/0+$/, "").length > 15) return null;
    n = Number(t);
  } else return null;
  if (!Number.isFinite(n)) return null;
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) return null;
  return Object.is(n, -0) ? 0 : n;
}

function decimalsFmt(precision: number): string {
  return precision > 0 ? `#,##0.${"0".repeat(precision)}` : "#,##0";
}

function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? `${code} `;
}

/**
 * Excel number format for a number, currency or formula column
 * (undefined for other types, or a formula without a configured precision).
 */
export function excelNumFmtFor(
  column: ColumnDef,
  value?: number,
): string | undefined {
  const { precision, currencyCode } = getNumericConfig(column);
  switch (column.type) {
    case "number":
      if (precision !== undefined) return decimalsFmt(precision);
      // Without a precision, pick per value: `#,##0.##` would show "1,234." for
      // whole numbers and hide digits past the second decimal.
      return value === undefined || Number.isInteger(value)
        ? "#,##0"
        : "#,##0.##########";
    case "currency": {
      // TODO(core): config shape from core plan: { currencyCode, precision }.
      const symbol = `"${currencySymbol(currencyCode ?? "INR").replace(/"/g, '""')}"`;
      const body = decimalsFmt(precision ?? 2);
      return `${symbol}${body};-${symbol}${body}`;
    }
    case "formula":
      return precision === undefined ? undefined : decimalsFmt(precision);
    default:
      return undefined;
  }
}

function dateCell(value: string): Date | null {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Excel cannot show dates before 1900; keep those as text.
  if (y < 1900) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/** Wall clock in `tz`, or null for an unparseable instant. An invalid tz throws. */
function datetimeCell(value: unknown, tz: string): Date | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  let d: Date;
  if (value instanceof Date) d = value;
  else {
    const t = value.trim();
    if (!ISO_DATETIME_RE.test(t) && !/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
    // Stored datetimes are UTC ISO; a zone-less string must not be read in
    // the host's local zone.
    d = new Date(HAS_ZONE_RE.test(t) || !t.includes("T") ? t : `${t}Z`);
  }
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900) return null;
  return toZonedWallClock(d, tz);
}

function multiSelectText(value: unknown, column: ColumnDef): string {
  const items = Array.isArray(value) ? value : [value];
  const options = getSelectOptions(column);
  return items
    .map((x) => options.find((o) => o.value === String(x))?.label ?? String(x))
    .join(", ");
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1") return true;
    if (s === "false" || s === "no" || s === "0") return false;
  }
  return null;
}

export function toExcelCell(
  value: unknown,
  column: ColumnDef,
  registry: FieldTypeRegistry,
  tz: string,
): ExcelCell {
  if (isEmpty(value)) return { value: null };

  switch (column.type) {
    case "number":
    case "currency": {
      const n = toFiniteNumber(value);
      if (n === null) return { value: formatValue(value, column, registry) };
      const numFmt = excelNumFmtFor(column, n);
      return numFmt ? { value: n, numFmt } : { value: n };
    }
    case "date": {
      const d =
        typeof value === "string"
          ? dateCell(value.trim())
          : value instanceof Date && !Number.isNaN(value.getTime())
            ? dateCell(toIsoDate(value))
            : null;
      return d
        ? { value: d, numFmt: DATE_FMT }
        : { value: formatValue(value, column, registry) };
    }
    case "datetime": {
      const d = datetimeCell(value, tz);
      return d
        ? { value: d, numFmt: DATETIME_FMT }
        : { value: formatValue(value, column, registry) };
    }
    case "boolean": {
      const b = toBoolean(value);
      return { value: b ?? String(value) };
    }
    case "multiSelect":
      return { value: multiSelectText(value, column) };
    case "url": {
      const text = formatValue(value, column, registry).trim();
      const href = typeof value === "string" ? value.trim() : "";
      return HYPERLINK_RE.test(href) && href.length <= MAX_HYPERLINK
        ? { value: { text: text || href, hyperlink: href } }
        : { value: text };
    }
    case "formula":
      return formulaExcelCell(value, column, registry, tz);
    default:
      return { value: formatValue(value, column, registry) };
  }
}

function formulaExcelCell(
  value: unknown,
  column: ColumnDef,
  registry: FieldTypeRegistry,
  tz: string,
): ExcelCell {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { value: null };
    const numFmt = excelNumFmtFor(column, value);
    return numFmt ? { value, numFmt } : { value };
  }
  if (typeof value === "boolean") return { value };
  if (typeof value === "string") {
    if (ISO_DATETIME_RE.test(value)) {
      const d = datetimeCell(value, tz);
      if (d) return { value: d, numFmt: DATETIME_FMT };
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const d = dateCell(value);
      if (d) return { value: d, numFmt: DATE_FMT };
    }
    return { value };
  }
  return { value: formatValue(value, column, registry) };
}

export { sanitizeCsvText };

export function toCsvCell(
  value: unknown,
  column: ColumnDef,
  registry: FieldTypeRegistry,
): string {
  if (isEmpty(value)) return "";
  const text =
    column.type === "multiSelect"
      ? multiSelectText(value, column)
      : formatValue(value, column, registry);
  if (SAFE_CSV_SHAPES.some((re) => re.test(text))) return text;
  return sanitizeCsvText(text);
}

/** Excel column width in characters from ColumnDef.width (px). */
export function columnWidthChars(column: ColumnDef): number {
  const w = column.width;
  if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) return 15;
  return Math.min(80, Math.max(8, Math.round(w / 7)));
}
