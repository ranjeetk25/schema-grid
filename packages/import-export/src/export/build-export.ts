/**
 * Export entry points: `buildExport` picks the browser (Blob) or Node
 * (Readable) writer at runtime; `buildExportBlob` / `buildExportStream` force
 * one path. Every builder checks column access before doing any work.
 * exceljs is loaded lazily (XLSX only); CSV exports never evaluate it.
 *
 * The Blob builder and the name / MIME helpers live in `./export-blob` so the
 * browser entry (`./index.browser`) can share them without this file's
 * `node:stream` references.
 */
import type { Readable } from "node:stream";
import { assertNoHiddenColumns } from "../internal/access";
import { buildCsvStream } from "./csv";
import { buildExportBlob } from "./export-blob";
import type { ExportOptions } from "./types";

export { buildExportBlob, exportFileName, exportMimeType } from "./export-blob";

// The streaming XLSX writer (and exceljs behind it) is loaded only when an
// XLSX export is requested, so the CSV path costs no exceljs bytes (v0.3).
const xlsxStream = async (opts: ExportOptions): Promise<Readable> => (await import("./xlsx-stream")).buildXlsxStream(opts);

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

/** Export as a Node Readable: CSV via `buildCsvStream`, XLSX via the streaming writer. */
export async function buildExportStream(opts: ExportOptions): Promise<Readable> {
  assertNoHiddenColumns(opts.columns, opts.access);
  return opts.format === "csv" ? buildCsvStream(opts) : xlsxStream(opts);
}

/** A Blob in a browser, a Node Readable elsewhere. */
export async function buildExport(opts: ExportOptions): Promise<Blob | Readable> {
  assertNoHiddenColumns(opts.columns, opts.access);
  return runtime.isBrowser() ? buildExportBlob(opts) : buildExportStream(opts);
}
