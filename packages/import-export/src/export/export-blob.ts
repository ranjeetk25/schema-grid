/**
 * The runtime-neutral half of the export entry: the Blob builder plus the
 * file-name / MIME helpers. Both `./build-export` (Node + browser) and
 * `./index.browser` (browser only) are built on it, so it must never
 * reference `node:` modules, even as a type. exceljs stays lazy: only an
 * XLSX export evaluates it.
 */
import { assertNoHiddenColumns } from "../internal/access";
import { buildCsvBlob } from "./csv-blob";
import type { ExportFormat, ExportOptions } from "./types";
import { XLSX_MIME } from "./xlsx-shared";

// The XLSX writer (and exceljs behind it) is loaded only when an XLSX export
// is requested, so the CSV path costs no exceljs bytes (v0.3).
const xlsxBlob = async (opts: ExportOptions): Promise<Blob> => (await import("./xlsx-memory")).buildXlsxBlob(opts);

/** Export as a Blob: CSV via `buildCsvBlob`, XLSX via the in-memory writer. */
export async function buildExportBlob(opts: ExportOptions): Promise<Blob> {
  assertNoHiddenColumns(opts.columns, opts.access);
  return opts.format === "csv" ? buildCsvBlob(opts) : xlsxBlob(opts);
}

const EXTENSIONS: Record<ExportFormat, string> = { csv: ".csv", xlsx: ".xlsx" };

/**
 * `fileName` with the extension for `format`: kept when already present (any
 * case), swapped when it carries the other format's extension, else appended.
 * A blank name becomes "export".
 */
export function exportFileName(fileName: string, format: ExportFormat): string {
  const want = EXTENSIONS[format];
  // Path separators, quotes and control characters are unsafe in a
  // Content-Disposition header or a download name.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  let name = fileName.replace(/[\u0000-\u001f\u007f/\\"]+/g, "_").trim();
  const lower = name.toLowerCase();
  if (lower.endsWith(want) && lower.length > want.length) return name;
  for (const ext of Object.values(EXTENSIONS)) {
    if (lower.endsWith(ext)) {
      name = name.slice(0, -ext.length);
      break;
    }
  }
  name = name.replace(/\.+$/, "").trim();
  return `${name === "" ? "export" : name}${want}`;
}

/** MIME type of an export in `format`. */
export function exportMimeType(format: ExportFormat): string {
  return format === "csv" ? "text/csv;charset=utf-8" : XLSX_MIME;
}
