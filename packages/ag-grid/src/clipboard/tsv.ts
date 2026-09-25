/**
 * TSV (tab-separated values) serialization matching Excel/Sheets clipboard
 * quoting: a field is wrapped in double quotes when it contains a tab,
 * newline, carriage return or double quote, and embedded quotes are doubled.
 */

function needsQuoting(field: string): boolean {
  return field.includes("\t") || field.includes("\n") || field.includes("\r") || field.includes('"');
}

function quoteField(field: string): string {
  if (!needsQuoting(field)) return field;
  return `"${field.replace(/"/g, '""')}"`;
}

/** Serializes a matrix of strings to TSV text using Excel/Sheets quoting rules. */
export function serializeTsv(matrix: string[][]): string {
  return matrix.map((row) => row.map(quoteField).join("\t")).join("\n");
}

/**
 * Parses TSV text into a matrix of strings. Handles quoted fields that may
 * contain tabs, newlines (including CRLF) and doubled quotes. A single
 * trailing newline at the end of the text is ignored.
 */
export function parseTsv(text: string): string[][] {
  let input = text;
  if (input.endsWith("\r\n")) {
    input = input.slice(0, -2);
  } else if (input.endsWith("\n")) {
    input = input.slice(0, -1);
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field.length === 0) {
      // Only a quote that opens a field starts a quoted field; a bare quote
      // mid-field (e.g. `5" screen`) is literal text.
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === "\t") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Skip bare CR; CRLF is handled by the following \n case.
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  row.push(field);
  rows.push(row);

  return rows;
}
