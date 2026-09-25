import { describe, expect, it } from "vitest";
import { toCsvCell } from "../src/export/cells";
import { buildCsvBlob, buildCsvStream } from "../src/export/csv";
import { HiddenColumnError } from "../src/internal/errors";
import { collectNodeStream } from "./helpers/streams";
import { makeRegistry } from "./helpers/registry";
import {
  makeAccess,
  makeRow,
  sampleCells,
  visibleColumns,
} from "./helpers/schema";
import { parseCsvText } from "../src/import/csv";

const registry = makeRegistry();
const TZ = "Asia/Kolkata";

function happyOpts(rows = [makeRow(sampleCells(0)), makeRow(sampleCells(1))]) {
  return {
    columns: visibleColumns(),
    registry,
    rows,
    format: "csv" as const,
    tz: TZ,
    fileName: "export.csv",
    access: makeAccess(),
  };
}

describe("buildCsvBlob", () => {
  it("starts with a BOM (bytes) and its header equals the column labels", async () => {
    const opts = happyOpts();
    const blob = await buildCsvBlob(opts);
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    // parseCsvText strips the BOM itself, so decode via .text() for parsing.
    const text = await blob.text();
    const labels = opts.columns.map((c) => c.label);
    const parsedHeader = parseCsvText(text).headers;
    expect(parsedHeader).toEqual(labels);
  });

  it("zero rows produces just BOM + header line", async () => {
    const opts = happyOpts([]);
    const blob = await buildCsvBlob(opts);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await blob.text();
    const table = parseCsvText(text);
    expect(table.headers).toEqual(opts.columns.map((c) => c.label));
    expect(table.rows).toEqual([]);
  });

  it("quotes a cell with a newline and round-trips via parseCsvText", async () => {
    const columns = visibleColumns();
    const noteColumn = columns.find((c) => c.id === "c_note")!;
    const cells = sampleCells(0);
    cells.note = "line one\nline two";
    const row = makeRow(cells);
    const opts = { ...happyOpts([row]) };
    const blob = await buildCsvBlob(opts);
    const text = await blob.text();

    expect(text).toContain('"line one\nline two"');

    const table = parseCsvText(text);
    const noteIdx = table.headers.indexOf(noteColumn.label);
    expect(table.rows[0]?.[noteIdx]).toBe(toCsvCell(cells.note, noteColumn, registry));

    // Every visible column's exported text matches toCsvCell for this row.
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]!;
      const expected = toCsvCell(cells[col.key], col, registry);
      expect(table.rows[0]?.[i]).toBe(expected);
    }
  });

  it("a column missing from access rejects with HiddenColumnError before producing output", async () => {
    const access = makeAccess();
    access.delete("c_name");
    const opts = { ...happyOpts(), access };
    await expect(buildCsvBlob(opts)).rejects.toBeInstanceOf(HiddenColumnError);
  });

  it("a hidden column rejects with HiddenColumnError and never pulls the source iterator", async () => {
    let pulled = false;
    const rows: AsyncIterable<ReturnType<typeof makeRow>> = {
      async *[Symbol.asyncIterator]() {
        pulled = true;
        yield makeRow(sampleCells(0));
      },
    };
    const allColumns = [...visibleColumns()];
    // Sneak in the hidden column by reading from makeColumns via access map's own hidden entry.
    const access = makeAccess(); // c_secret is "hidden"
    const opts = {
      columns: [
        ...allColumns,
        { ...allColumns[0]!, id: "c_secret", key: "secret", label: "Secret" },
      ],
      registry,
      rows,
      format: "csv" as const,
      tz: TZ,
      fileName: "export.csv",
      access,
    };
    await expect(buildCsvBlob(opts)).rejects.toBeInstanceOf(HiddenColumnError);
    expect(pulled).toBe(false);
  });
});

describe("buildCsvStream", () => {
  it("produces bytes identical to the Blob for the same input", async () => {
    const opts = happyOpts();
    const blob = await buildCsvBlob(opts);
    const blobBytes = new Uint8Array(await blob.arrayBuffer());

    const stream = await buildCsvStream(opts);
    const streamBytes = await collectNodeStream(stream);

    expect(streamBytes).toEqual(blobBytes);
  });

  it("a hidden column rejects with HiddenColumnError before returning a stream", async () => {
    const access = makeAccess();
    access.delete("c_name");
    const opts = { ...happyOpts(), access };
    await expect(buildCsvStream(opts)).rejects.toBeInstanceOf(HiddenColumnError);
  });

  it("pulls rows lazily: not all 1200 rows are produced before the first chunk arrives", async () => {
    const TOTAL = 1200;
    let yielded = 0;
    const rows: AsyncIterable<ReturnType<typeof makeRow>> = {
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < TOTAL; i++) {
          yielded++;
          yield makeRow(sampleCells(i));
        }
      },
    };
    const opts = {
      columns: visibleColumns(),
      registry,
      rows,
      format: "csv" as const,
      tz: TZ,
      fileName: "export.csv",
      access: makeAccess(),
    };
    const stream = await buildCsvStream(opts);
    const iterator = stream[Symbol.asyncIterator]();
    // First chunk is the BOM; second is the first flushed batch of rows.
    await iterator.next();
    const { done } = await iterator.next();
    expect(done).not.toBe(true);
    expect(yielded).toBeLessThan(TOTAL);
    // Drain the rest so the test doesn't leave a dangling stream.
    // eslint-disable-next-line no-empty
    for await (const _ of stream) {
      /* drain */
    }
  });
});
