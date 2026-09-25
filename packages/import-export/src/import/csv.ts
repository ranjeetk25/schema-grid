import Papa from "papaparse";
import { shapeTable } from "./table";
import type { ParsedTable } from "./types";

export interface ParseCsvTextOptions {
  /** 1-based row holding the headers. Default 1. */
  headerRow?: number;
  maxRows?: number;
}

/** Parses CSV/TSV text (delimiter auto-detected) into a shaped ParsedTable. */
export function parseCsvText(text: string, opts: ParseCsvTextOptions = {}): ParsedTable {
  const headerRow = opts.headerRow ?? 1;
  const maxRows = opts.maxRows;
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const result = Papa.parse<string[]>(stripped, {
    delimiter: "",
    skipEmptyLines: "greedy",
    preview: maxRows !== undefined ? headerRow + maxRows + 1 : 0,
  });

  const table = shapeTable(result.data, { headerRow, maxRows });
  table.delimiter = result.meta.delimiter;
  return table;
}
