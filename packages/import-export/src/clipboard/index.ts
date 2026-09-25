// Zero-dependency clipboard helpers (TSV). No exceljs, papaparse or node: imports.
export { formatForClipboard } from "./format";
export type { FormatForClipboardOptions } from "./format";
export { formatMatrixForClipboard, parseClipboard } from "./tsv";
