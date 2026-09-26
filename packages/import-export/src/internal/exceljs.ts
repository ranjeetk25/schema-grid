/**
 * exceljs is ~950 KB minified, so it is loaded on demand: only the XLSX
 * writers/reader call `loadExcelJS()`. CSV and clipboard paths never touch it,
 * and bundlers put it in its own chunk (see docs/bundle.md).
 */
import type ExcelJSNamespace from "exceljs";

export type ExcelJSModule = typeof ExcelJSNamespace;

let cached: Promise<ExcelJSModule> | undefined;

/** The exceljs module (memoised); works with ESM default and CJS namespace shapes. */
export function loadExcelJS(): Promise<ExcelJSModule> {
  if (!cached) {
    cached = import("exceljs").then((mod) => {
      const m = mod as unknown as { default?: ExcelJSModule } & ExcelJSModule;
      return m.default && typeof m.default === "object" && "Workbook" in m.default ? m.default : m;
    });
    // A failed load must not be cached forever (e.g. a transient chunk fetch error).
    cached.catch(() => {
      cached = undefined;
    });
  }
  return cached;
}
