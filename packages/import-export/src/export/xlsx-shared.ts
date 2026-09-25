/**
 * Helpers shared by the in-memory (Blob) and streaming XLSX writers.
 */
import type ExcelJS from "exceljs";
import type { ExcelCell } from "./types";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const DEFAULT_SHEET_NAME = "Export";

const MAX_SHEET_NAME = 31;
const FORBIDDEN_SHEET_CHARS = /[[\]:*?/\\]/g;

/**
 * Makes a worksheet name Excel accepts: forbidden characters (`[]:*?/\`)
 * become spaces, surrounding whitespace and apostrophes are trimmed, the
 * result is capped at 31 characters, and a blank result falls back to "Export".
 */
export function sanitizeSheetName(name: string | undefined): string {
  if (name === undefined) return DEFAULT_SHEET_NAME;
  const cleaned = name
    .replace(FORBIDDEN_SHEET_CHARS, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, MAX_SHEET_NAME)
    .trimEnd()
    .replace(/'+$/, "");
  return cleaned === "" ? DEFAULT_SHEET_NAME : cleaned;
}

const HYPERLINK_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FF0563C1" },
  underline: true,
};

/** Makes every cell of the header row bold. */
export function applyHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.font = { bold: true };
  });
}

/** Writes a converted cell's value, number format and (for links) link styling. */
export function writeExcelCell(cell: ExcelJS.Cell, excelCell: ExcelCell): void {
  const { value, numFmt } = excelCell;
  cell.value = value;
  if (numFmt) cell.numFmt = numFmt;
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    cell.font = HYPERLINK_FONT;
  }
}
