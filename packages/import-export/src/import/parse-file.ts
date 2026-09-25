import { type ImportInput, decodeUtf8, readInputBytes } from "../internal/bytes";
import { parseCsvText } from "./csv";
import { detectFileType } from "./detect";
import type { ParseFileOptions, ParsedTable } from "./types";
import { parseXlsxBytes } from "./xlsx";

/** Reads a CSV/TSV or XLSX input (type detected from name, signature or `opts.type`). */
export async function parseFile(
  input: ImportInput,
  opts: ParseFileOptions = {},
): Promise<ParsedTable> {
  const bytes = await readInputBytes(input);
  const type = detectFileType(input, bytes, opts.type);
  if (type === "csv") {
    return parseCsvText(decodeUtf8(bytes), { headerRow: opts.headerRow, maxRows: opts.maxRows });
  }
  return parseXlsxBytes(bytes, { ...opts, tz: opts.tz ?? "UTC" });
}
