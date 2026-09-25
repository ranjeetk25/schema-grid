/**
 * CSV export as a browser Blob or a Node Readable, sharing one chunked
 * generator so both paths produce byte-identical output.
 */
import type { Readable } from "node:stream";
import Papa from "papaparse";
import { assertNoHiddenColumns } from "../internal/access";
import { sanitizeCsvText, toCsvCell } from "./cells";
import { toAsyncIterable } from "./rows";
import type { ExportOptions } from "./types";

const CHUNK_ROWS = 500;
const BOM = "\uFEFF";

/**
 * Yields the BOM, then CSV text chunks: the header first (labels, sanitised
 * against formula injection), then up to 500 rows at a time. Every chunk
 * after the first is prefixed with "\r\n" so the concatenation is one valid
 * CSV document. Callers must run `assertNoHiddenColumns` before consuming
 * this so the check happens eagerly, not on first pull.
 */
export async function* csvChunks(opts: ExportOptions): AsyncGenerator<string> {
  assertNoHiddenColumns(opts.columns, opts.access);

  const { columns, registry, rows } = opts;
  yield BOM;

  const fields = columns.map((c) => sanitizeCsvText(c.label));
  let buffer: string[][] = [];
  let wroteAny = false;

  const flush = (isFirst: boolean): string => {
    const csv = Papa.unparse(
      { fields, data: buffer },
      { newline: "\r\n", header: isFirst },
    );
    buffer = [];
    return isFirst ? csv : `\r\n${csv}`;
  };

  for await (const row of toAsyncIterable(rows)) {
    buffer.push(columns.map((c) => toCsvCell(row.cells[c.key], c, registry)));
    if (buffer.length >= CHUNK_ROWS) {
      yield flush(!wroteAny);
      wroteAny = true;
    }
  }

  if (buffer.length > 0 || !wroteAny) {
    yield flush(!wroteAny);
    wroteAny = true;
  }
}

/** CSV export as a browser Blob (`text/csv;charset=utf-8`). */
export async function buildCsvBlob(opts: ExportOptions): Promise<Blob> {
  assertNoHiddenColumns(opts.columns, opts.access);
  const parts: string[] = [];
  for await (const chunk of csvChunks(opts)) parts.push(chunk);
  return new Blob(parts, { type: "text/csv;charset=utf-8" });
}

/**
 * CSV export as a Node Readable, pulling rows lazily from `opts.rows`.
 * `node:stream` is dynamically imported so browser bundles never include it.
 */
export async function buildCsvStream(opts: ExportOptions): Promise<Readable> {
  assertNoHiddenColumns(opts.columns, opts.access);
  const { Readable } = await import("node:stream");

  async function* toBytes(): AsyncGenerator<Buffer> {
    for await (const chunk of csvChunks(opts)) {
      yield Buffer.from(chunk, "utf-8");
    }
  }

  return Readable.from(toBytes());
}
