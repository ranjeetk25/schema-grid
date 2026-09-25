// @vitest-environment jsdom
/**
 * `@masai/schema-grid-io/export`'s `buildExportBlob` is the browser entry the
 * grid's `exportCurrentView` calls: it must work in a DOM runtime without
 * ever loading `node:stream`, and must type XLSX cells from raw values.
 */
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:stream", () => {
  throw new Error("node:stream must not be loaded on the browser export path");
});

import * as exportEntry from "../src/export/index";
import { makeRegistry } from "./helpers/registry";
import { makeAccess, makeRow, sampleCells, visibleColumns } from "./helpers/schema";

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  // jsdom's Blob lacks arrayBuffer()/text(); FileReader is the browser way.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const baseOptions = (format: "csv" | "xlsx") => ({
  columns: visibleColumns(),
  registry: makeRegistry(),
  rows: [makeRow(sampleCells(0))],
  format,
  tz: "Asia/Kolkata",
  fileName: `leads.${format}`,
  access: makeAccess(),
});

describe("./export in a browser runtime", () => {
  it("exports buildExportBlob", () => {
    expect(typeof exportEntry.buildExportBlob).toBe("function");
  });

  it("builds a CSV Blob without node:stream", async () => {
    const blob = await exportEntry.buildExportBlob(baseOptions("csv"));
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const text = new TextDecoder().decode(await readBlob(blob));
    expect(text).toContain("Asha 0");
  });

  it("builds an XLSX Blob with typed (numeric) cells from raw values", async () => {
    const blob = await exportEntry.buildExportBlob(baseOptions("xlsx"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await readBlob(blob));
    const sheet = wb.worksheets[0];
    const header = (sheet?.getRow(1).values as unknown[]) ?? [];
    const amountCol = header.indexOf("Amount");
    expect(amountCol).toBeGreaterThan(0);
    expect(sheet?.getRow(2).getCell(amountCol).value).toBe(1234.5);
  });
});
