/**
 * Browser build of `@ranjeetk25/schema-grid-io/export` (the `browser` export
 * condition, v0.3.1). Same public names as `./index`, but built only from the
 * Blob writers, so nothing on this path mentions `node:stream` and bundlers
 * never warn about externalised Node built-ins. exceljs stays lazy.
 */
import { assertNoHiddenColumns } from "../internal/access";
import { buildExportBlob } from "./export-blob";
import type { ExportOptions } from "./types";

export { HiddenColumnError } from "../internal/errors";
export { buildExportBlob, exportFileName, exportMimeType } from "./export-blob";
export type { ExcelCell, ExportFormat, ExportOptions } from "./types";

/** In the browser an export is always a Blob. */
export async function buildExport(opts: ExportOptions): Promise<Blob> {
  return buildExportBlob(opts);
}

/**
 * Node Readable exports do not exist in the browser. Access is still checked
 * first so a hidden-column request fails the same way on every runtime.
 */
export async function buildExportStream(opts: ExportOptions): Promise<never> {
  assertNoHiddenColumns(opts.columns, opts.access);
  throw new Error("buildExportStream is not available in the browser; use buildExportBlob");
}
