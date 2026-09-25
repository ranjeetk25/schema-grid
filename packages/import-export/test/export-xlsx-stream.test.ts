import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ExportOptions } from "../src/export/types";
import { buildXlsxStream } from "../src/export/xlsx-stream";
import type { GridRow } from "../src/internal/core";
import { HiddenColumnError } from "../src/internal/errors";
import { makeRegistry } from "./helpers/registry";
import { makeAccess, makeColumns, makeRow, sampleCells, visibleColumns } from "./helpers/schema";
import { collectNodeStream, toArrayBuffer } from "./helpers/streams";

const registry = makeRegistry();
const TZ = "Asia/Kolkata";

function opts(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    columns: visibleColumns(),
    registry,
    rows: [makeRow(sampleCells(0)), makeRow(sampleCells(1))],
    format: "xlsx",
    tz: TZ,
    fileName: "leads.xlsx",
    access: makeAccess(),
    ...overrides,
  };
}

async function loadSheet(bytes: Uint8Array): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(toArrayBuffer(bytes) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("no worksheet");
  return ws;
}

function colIndex(id: string): number {
  return visibleColumns().findIndex((c) => c.id === id) + 1;
}

async function* generate(n: number): AsyncGenerator<GridRow> {
  for (let i = 0; i < n; i++) yield makeRow(sampleCells(i));
}

describe("buildXlsxStream (node)", () => {
  it("streams 5000 async rows with a frozen bold header and typed cells", async () => {
    const stream = await buildXlsxStream(opts({ rows: generate(5000), sheetName: "Leads" }));
    expect(stream).toBeInstanceOf(Readable);

    const ws = await loadSheet(await collectNodeStream(stream));
    expect(ws.name).toBe("Leads");
    expect(ws.rowCount).toBe(5001);
    expect(ws.actualRowCount).toBe(5001);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });

    const header = ws.getRow(1);
    expect(header.getCell(1).value).toBe("Name");
    expect(header.getCell(1).font?.bold).toBe(true);
    expect(header.getCell(colIndex("c_note")).font?.bold).toBe(true);
    expect(ws.getColumn(1).width).toBe(20);

    const row = ws.getRow(2);
    const amount = row.getCell(colIndex("c_amount"));
    expect(amount.value).toBe(1234.5);
    expect(amount.numFmt).toContain("0.00");
    expect(row.getCell(colIndex("c_joined")).value).toEqual(new Date(Date.UTC(2026, 8, 25)));
    // 05:00Z is 10:30 wall clock in Kolkata.
    expect(row.getCell(colIndex("c_call")).value).toEqual(new Date(Date.UTC(2026, 8, 25, 10, 30)));
    expect(row.getCell(colIndex("c_active")).value).toBe(true);
    expect(ws.getRow(3).getCell(colIndex("c_active")).value).toBe(false);
    expect(row.getCell(colIndex("c_site")).value).toMatchObject({
      hyperlink: "https://example.com/a",
    });
    expect(row.getCell(colIndex("c_tags")).value).toBe("A, C");

    const last = ws.getRow(5001);
    expect(last.getCell(1).value).toBe("Asha 4999");
    expect(last.getCell(colIndex("c_amount")).value).toBe(1234.5 + 4999);
  }, 60_000);

  it("accepts a plain array of rows and the default sheet name", async () => {
    const ws = await loadSheet(await collectNodeStream(await buildXlsxStream(opts())));
    expect(ws.name).toBe("Export");
    expect(ws.rowCount).toBe(3);
    expect(ws.getRow(3).getCell(1).value).toBe("Asha 1");
  });

  it("writes only a header for zero rows", async () => {
    const ws = await loadSheet(await collectNodeStream(await buildXlsxStream(opts({ rows: [] }))));
    expect(ws.rowCount).toBe(1);
    expect(ws.getRow(1).getCell(2).value).toBe("Email");
  });

  it("emits an error instead of hanging when the row source throws midway", async () => {
    async function* failing(): AsyncGenerator<GridRow> {
      for (let i = 0; i < 10; i++) yield makeRow(sampleCells(i));
      throw new Error("source broke");
    }
    const stream = await buildXlsxStream(opts({ rows: failing() }));
    await expect(collectNodeStream(stream)).rejects.toThrow("source broke");
  }, 10_000);

  it("rejects a hidden column before pulling any row", async () => {
    let pulled = false;
    async function* gen(): AsyncGenerator<GridRow> {
      pulled = true;
      yield makeRow(sampleCells(0));
    }
    await expect(buildXlsxStream(opts({ columns: makeColumns(), rows: gen() }))).rejects.toBeInstanceOf(
      HiddenColumnError,
    );
    expect(pulled).toBe(false);
  });
});

describe("buildXlsxStream backpressure and early failure", () => {
  it("does not read an endless source ahead of an absent consumer", async () => {
    let pulled = 0;
    let finalized = false;
    async function* endless(): AsyncGenerator<GridRow> {
      try {
        for (let i = 0; ; i++) {
          pulled += 1;
          yield makeRow(sampleCells(i));
        }
      } finally {
        finalized = true;
      }
    }
    const stream = await buildXlsxStream(opts({ rows: endless() }));
    await new Promise((r) => setTimeout(r, 300));
    const afterWait = pulled;
    await new Promise((r) => setTimeout(r, 200));
    // Stalled on backpressure: bounded, and no longer advancing.
    expect(afterWait).toBeLessThan(50_000);
    expect(pulled).toBe(afterWait);
    stream.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(finalized).toBe(true);
  }, 20_000);

  it("rejects an invalid tz before returning a stream", async () => {
    await expect(buildXlsxStream(opts({ rows: [], tz: "Not/AZone" }))).rejects.toThrow(
      RangeError,
    );
  });
});
