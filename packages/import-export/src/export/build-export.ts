/**
 * Export entry points: `buildExport` picks the browser (Blob) or Node
 * (Readable) writer at runtime; `buildExportBlob` / `buildExportStream` force
 * one path. Every builder checks column access before doing any work.
 */
import type { Readable } from "node:stream";
import { assertNoHiddenColumns } from "../internal/access";
import { buildCsvBlob, buildCsvStream } from "./csv";
import type { ExportFormat, ExportOptions } from "./types";
import { buildXlsxBlob } from "./xlsx-memory";
import { XLSX_MIME } from "./xlsx-shared";
import { buildXlsxStream } from "./xlsx-stream";

/**
 * True in a browser-like runtime (a `window` and a `document` exist). A Web
 * Worker has neither and takes the Node stream path, which needs `node:stream`:
 * call `buildExportBlob` explicitly there.
 */
export function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Runtime detection used by `buildExport`, held in an object so tests (and
 * unusual hosts) can override it.
 */
export const runtime = {
  isBrowser: isBrowserRuntime,
};

/** Export as a Blob: CSV via `buildCsvBlob`, XLSX via the in-memory writer. */
export async function buildExportBlob(opts: ExportOptions): Promise<Blob> {
  assertNoHiddenColumns(opts.columns, opts.access);
  return opts.format === "csv" ? buildCsvBlob(opts) : buildXlsxBlob(opts);
}

/** Export as a Node Readable: CSV via `buildCsvStream`, XLSX via the streaming writer. */
export async function buildExportStream(opts: ExportOptions): Promise<Readable> {
  assertNoHiddenColumns(opts.columns, opts.access);
  return opts.format === "csv" ? buildCsvStream(opts) : buildXlsxStream(opts);
}

/** A Blob in a browser, a Node Readable elsewhere. */
export async function buildExport(opts: ExportOptions): Promise<Blob | Readable> {
  assertNoHiddenColumns(opts.columns, opts.access);
  return runtime.isBrowser() ? buildExportBlob(opts) : buildExportStream(opts);
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
