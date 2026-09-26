/**
 * CSV export as a Node Readable. The Blob writer and the shared chunk
 * generator live in `./csv-blob` (no `node:` references, on the browser
 * entry); they are re-exported here so `./csv` keeps its full surface.
 */
import type { Readable } from "node:stream";
import { assertNoHiddenColumns } from "../internal/access";
import { csvChunks } from "./csv-blob";
import type { ExportOptions } from "./types";

export { buildCsvBlob, csvChunks } from "./csv-blob";

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
