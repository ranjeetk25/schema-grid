import type { ParsedTable } from "./types";

export interface ShapeTableOptions {
  /** 1-based row holding the headers. Default 1. */
  headerRow?: number;
  maxRows?: number;
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

function buildHeaders(rawHeaders: string[]): string[] {
  const used = new Set<string>();
  const headers: string[] = [];

  for (let i = 0; i < rawHeaders.length; i++) {
    const trimmed = (rawHeaders[i] ?? "").trim();
    const base = trimmed === "" ? `Column ${i + 1}` : trimmed;
    const normBase = base.toLowerCase();

    let final = base;
    if (used.has(normBase)) {
      let n = 2;
      for (;;) {
        const candidate = `${base} (${n})`;
        if (!used.has(candidate.toLowerCase())) {
          final = candidate;
          break;
        }
        n++;
      }
    }

    used.add(final.toLowerCase());
    headers.push(final);
  }

  return headers;
}

function shapeRow(row: string[], width: number): string[] {
  const out = new Array<string>(width);
  for (let i = 0; i < width; i++) out[i] = row[i] ?? "";
  return out;
}

/** Shapes a raw matrix of strings into a ParsedTable: headers, padded rows, blank-row skipping and truncation. */
export function shapeTable(matrix: string[][], opts: ShapeTableOptions = {}): ParsedTable {
  const headerRow = opts.headerRow ?? 1;
  const maxRows = opts.maxRows;

  if (matrix.length < headerRow) {
    return { headers: [], rows: [], truncated: false, headerRow };
  }

  const rawHeaders = matrix[headerRow - 1] ?? [];
  const headers = buildHeaders(rawHeaders);
  const width = headers.length;

  const dataRows = matrix
    .slice(headerRow)
    .filter((row) => !isBlankRow(row))
    .map((row) => shapeRow(row, width));

  let truncated = false;
  let rows = dataRows;
  if (maxRows !== undefined && dataRows.length > maxRows) {
    truncated = true;
    rows = dataRows.slice(0, maxRows);
  }

  return { headers, rows, truncated, headerRow };
}
