import type ExcelJS from "exceljs";
import { SheetNotFoundError } from "../internal/errors";
import { loadExcelJS } from "../internal/exceljs";
import { fromZonedWallClock, isMidnightUtc, toIsoDate } from "../internal/tz";
import { shapeTable } from "./table";
import type { ParseFileOptions, ParsedTable } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * True when an Excel number format displays a time of day. `m` is ambiguous
 * (month or minute) so it is ignored; quoted literals, backslash escapes and
 * bracketed sections (`[$-409]`, `[Red]`) are stripped first, except elapsed
 * time sections like `[h]`.
 */
function formatHasTime(numFmt: string | undefined): boolean {
  if (!numFmt) return false;
  if (/\[(h+|m+|s+)\]/i.test(numFmt)) return true;
  const stripped = numFmt
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /am\/pm|a\/p|[hs]/i.test(stripped);
}

function richTextToString(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.richText)) return undefined;
  return value.richText
    .map((seg: unknown) => (isRecord(seg) && typeof seg.text === "string" ? seg.text : ""))
    .join("");
}

/** Converts an exceljs cell value to the string the import pipeline works with. */
export function cellToString(value: unknown, numFmt: string | undefined, tz: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Number(value.toPrecision(15))) : "";
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    if (!formatHasTime(numFmt) && isMidnightUtc(value)) return toIsoDate(value);
    return fromZonedWallClock(value, tz);
  }
  if (!isRecord(value)) return "";

  if ("formula" in value || "sharedFormula" in value) {
    return cellToString(value.result, numFmt, tz);
  }
  if ("richText" in value) return richTextToString(value) ?? "";
  if ("hyperlink" in value || "text" in value) {
    if (typeof value.hyperlink === "string" && value.hyperlink !== "") return value.hyperlink;
    if (typeof value.text === "string") return value.text;
    return richTextToString(value.text) ?? "";
  }
  // `{ error }` and anything unrecognised.
  return "";
}

type Worksheet = ExcelJS.Worksheet;

function pickSheet(wb: ExcelJS.Workbook, sheet: string | number | undefined): Worksheet {
  const sheets = wb.worksheets;
  const names = sheets.map((ws) => ws.name);
  let ws: Worksheet | undefined;
  if (sheet === undefined) ws = sheets[0];
  else if (typeof sheet === "number") ws = Number.isInteger(sheet) && sheet >= 1 ? sheets[sheet - 1] : undefined;
  else ws = sheets.find((s) => s.name === sheet);
  if (!ws) throw new SheetNotFoundError(sheet ?? 1, names);
  return ws;
}

function readRow(ws: Worksheet, r: number, tz: string): string[] {
  const row = ws.getRow(r);
  const width = row.cellCount;
  const out = new Array<string>(width);
  for (let c = 1; c <= width; c++) {
    const cell = row.getCell(c);
    // Merged non-master cells repeat the master's value; keep them empty.
    if (cell.isMerged && cell.master.address !== cell.address) {
      out[c - 1] = "";
      continue;
    }
    out[c - 1] = cellToString(cell.value, cell.numFmt ?? cell.style?.numFmt, tz);
  }
  return out;
}

/** Parses XLSX bytes (one worksheet) into a shaped ParsedTable. */
export async function parseXlsxBytes(
  bytes: Uint8Array,
  opts: ParseFileOptions = {},
): Promise<ParsedTable> {
  const headerRow = opts.headerRow ?? 1;
  const maxRows = opts.maxRows;
  const tz = opts.tz ?? "UTC";

  // Exact-sized copy: `bytes` may be a view into a larger buffer.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  // exceljs types only declare Buffer, but it accepts an ArrayBuffer at runtime.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const sheetNames = wb.worksheets.map((ws) => ws.name);
  const ws = pickSheet(wb, opts.sheet);

  const lastRow = ws.rowCount;
  const matrix: string[][] = [];
  let dataRows = 0;
  for (let r = 1; r <= lastRow; r++) {
    const cells = readRow(ws, r, tz);
    matrix.push(cells);
    if (r > headerRow && cells.some((v) => v.trim() !== "")) {
      dataRows++;
      // One extra non-blank row is enough for shapeTable to flag truncation.
      if (maxRows !== undefined && dataRows > maxRows) break;
    }
  }

  const table = shapeTable(matrix, { headerRow, maxRows });
  table.sheetNames = sheetNames;
  return table;
}
