// @vitest-environment jsdom
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { columnWidthChars } from "../src/export/cells";
import type { ExportOptions } from "../src/export/types";
import { buildXlsxBlob } from "../src/export/xlsx-memory";
import { XLSX_MIME, sanitizeSheetName } from "../src/export/xlsx-shared";
import type { GridRow } from "../src/internal/core";
import { HiddenColumnError } from "../src/internal/errors";
import { makeRegistry } from "./helpers/registry";
import {
  makeAccess,
  makeColumns,
  makeRow,
  sampleCells,
  visibleColumns,
} from "./helpers/schema";

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

/** jsdom's Blob lacks arrayBuffer(); FileReader is the portable fallback. */
function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function loadSheet(blob: Blob): Promise<ExcelJS.Worksheet> {
  const bytes = await readBlob(blob);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("no worksheet");
  return ws;
}

function colIndex(id: string): number {
  return visibleColumns().findIndex((c) => c.id === id) + 1;
}

describe("buildXlsxBlob (jsdom)", () => {
  it("returns a global Blob with the XLSX MIME type", async () => {
    const blob = await buildXlsxBlob(opts());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(XLSX_MIME).toBe(blob.type);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("writes a bold, frozen header row with column widths", async () => {
    const ws = await loadSheet(await buildXlsxBlob(opts()));
    expect(ws.name).toBe("Export");
    const header = ws.getRow(1);
    expect(header.getCell(1).value).toBe("Name");
    expect(header.getCell(1).font?.bold).toBe(true);
    expect(header.getCell(colIndex("c_amount")).font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    const first = visibleColumns()[0];
    if (!first) throw new Error("no columns");
    expect(columnWidthChars(first)).toBe(20);
    expect(ws.getColumn(1).width).toBe(columnWidthChars(first));
    expect(ws.rowCount).toBe(3);
  });

  it("writes typed cells", async () => {
    const ws = await loadSheet(await buildXlsxBlob(opts()));
    const row = ws.getRow(2);

    const amount = row.getCell(colIndex("c_amount"));
    expect(typeof amount.value).toBe("number");
    expect(amount.value).toBe(1234.5);
    expect(amount.numFmt).toContain("0.00");

    expect(row.getCell(colIndex("c_joined")).value).toBeInstanceOf(Date);
    expect(row.getCell(colIndex("c_call")).value).toBeInstanceOf(Date);
    expect(row.getCell(colIndex("c_active")).value).toBe(true);
    expect(ws.getRow(3).getCell(colIndex("c_active")).value).toBe(false);

    const site = row.getCell(colIndex("c_site")).value;
    expect(site).toMatchObject({ hyperlink: "https://example.com/a" });

    expect(row.getCell(colIndex("c_tags")).value).toBe("A, C");
    expect(row.getCell(colIndex("c_name")).value).toBe("Asha 0");
  });

  it("accepts an async-iterable rows input", async () => {
    async function* gen(): AsyncGenerator<GridRow> {
      for (let i = 0; i < 3; i++) yield makeRow(sampleCells(i));
    }
    const ws = await loadSheet(
      await buildXlsxBlob(opts({ rows: gen(), sheetName: "Leads" })),
    );
    expect(ws.name).toBe("Leads");
    expect(ws.rowCount).toBe(4);
    expect(ws.getRow(4).getCell(1).value).toBe("Asha 2");
  });

  it("rejects a hidden column before doing any work", async () => {
    let pulled = false;
    async function* gen(): AsyncGenerator<GridRow> {
      pulled = true;
      yield makeRow(sampleCells(0));
    }
    await expect(
      buildXlsxBlob(opts({ columns: makeColumns(), rows: gen() })),
    ).rejects.toBeInstanceOf(HiddenColumnError);
    expect(pulled).toBe(false);
  });
});

describe("sanitizeSheetName", () => {
  it("defaults blank or missing names to Export", () => {
    expect(sanitizeSheetName(undefined)).toBe("Export");
    expect(sanitizeSheetName("")).toBe("Export");
    expect(sanitizeSheetName("   ")).toBe("Export");
    expect(sanitizeSheetName("[]:*?/\\")).toBe("Export");
  });

  it("replaces forbidden characters and trims", () => {
    expect(sanitizeSheetName(" Q1/Q2 [draft]: a*b?c\\d ")).toBe(
      "Q1 Q2  draft   a b c d",
    );
  });

  it("strips leading/trailing apostrophes", () => {
    expect(sanitizeSheetName("'Leads'")).toBe("Leads");
  });

  it("truncates to 31 characters", () => {
    const name = sanitizeSheetName("x".repeat(40));
    expect(name).toBe("x".repeat(31));
  });
});
