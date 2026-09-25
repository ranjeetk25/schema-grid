/**
 * Clipboard TSV format/parse. Zero runtime dependencies — a hand-written
 * state machine, no papaparse/exceljs/node built-ins.
 *
 * Rules (plan §Task 2):
 * - Cells separated by `\t`, rows by `\r\n`, no trailing newline on output.
 * - A cell is quoted only if it contains a tab, `\r`, `\n` or `"`; an inner
 *   `"` is doubled.
 * - Parsing accepts `\r\n`, `\n` or `\r` as row breaks. A quote only opens a
 *   quoted cell as the very first character of the cell. `""` inside a quoted
 *   cell is a literal quote; any trailing characters after the closing quote
 *   up to the next delimiter are appended literally (lenient). An opening
 *   quote that is never closed anywhere in the remaining input is re-read as
 *   plain text, so it can't swallow the rest of the input. Exactly one
 *   trailing row break is dropped. Ragged rows are padded with "" to the
 *   width of the widest row.
 */

const NEEDS_QUOTING = /[\t\r\n"]/;

/** Formats a matrix of already-stringified cells as clipboard TSV. */
export function formatMatrixForClipboard(matrix: string[][]): string {
  return matrix.map((row) => row.map(formatCell).join("\t")).join("\r\n");
}

function formatCell(cell: string): string {
  if (!NEEDS_QUOTING.test(cell)) return cell;
  return `"${cell.replace(/"/g, '""')}"`;
}

/**
 * Parses clipboard TSV/CSV-ish text into a rectangular matrix of strings.
 * See module doc for the exact rules this hand-written state machine follows.
 */
export function parseClipboard(text: string): string[][] {
  if (text === "") return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  let endedWithRowBreak = false;

  while (i < n) {
    let field = "";

    const closeAt = text[i] === '"' ? findClosingQuoteEnd(text, i) : -1;
    if (closeAt !== -1) {
      field = unescapeQuoted(text.slice(i + 1, closeAt - 1));
      i = closeAt;
      // Lenient: append any trailing literal chars up to the next delimiter.
      while (i < n) {
        const ch = text[i];
        if (ch === undefined || isDelimiter(ch)) break;
        field += ch;
        i++;
      }
    } else {
      // Unquoted field (also covers an unclosed opening quote, which is
      // simply treated as a literal character here).
      while (i < n) {
        const ch = text[i];
        if (ch === undefined || isDelimiter(ch)) break;
        field += ch;
        i++;
      }
    }

    row.push(field);

    if (i >= n) {
      endedWithRowBreak = false;
      break;
    }
    if (text[i] === "\t") {
      i++;
      endedWithRowBreak = false;
      continue;
    }
    // Row break.
    rows.push(row);
    row = [];
    i += consumeRowBreak(text, i);
    endedWithRowBreak = true;
  }

  if (!endedWithRowBreak) {
    rows.push(row);
  }

  return padToRectangle(rows);
}

function isDelimiter(ch: string): boolean {
  return ch === "\t" || ch === "\r" || ch === "\n";
}

/** Number of characters consumed by the row break starting at index i. */
function consumeRowBreak(text: string, i: number): number {
  if (text[i] === "\r" && text[i + 1] === "\n") return 2;
  return 1;
}

/**
 * Given the index of an opening quote, returns the index just past the
 * matching closing quote (skipping `""` escaped quotes along the way), or
 * -1 if no closing quote exists anywhere in the rest of the input.
 */
function findClosingQuoteEnd(text: string, openAt: number): number {
  let i = openAt + 1;
  const n = text.length;
  while (i < n) {
    if (text[i] === '"') {
      if (text[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return -1;
}

function unescapeQuoted(inner: string): string {
  return inner.replace(/""/g, '"');
}

function padToRectangle(rows: string[][]): string[][] {
  if (rows.length === 0) return rows;
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return rows.map((r) =>
    r.length === width ? r : [...r, ...Array(width - r.length).fill("")],
  );
}
