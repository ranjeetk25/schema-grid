/**
 * exceljs (~950 KB minified) must only be evaluated on the XLSX paths. The
 * mock factory throws when the module is first evaluated, so any CSV code
 * path that touched exceljs would fail here.
 */
import { describe, expect, it, vi } from "vitest";
import { makeRegistry } from "./helpers/registry";
import { makeAccess, makeRow, sampleCells, visibleColumns } from "./helpers/schema";

vi.mock("exceljs", () => {
  throw new Error("exceljs was evaluated on a CSV path");
});

const registry = makeRegistry();

describe("exceljs is lazy", () => {
  it("importing ./export and building a CSV never evaluates exceljs", async () => {
    const io = await import("../src/export/index");
    const blob = await io.buildExportBlob({
      columns: visibleColumns(),
      registry,
      rows: [makeRow(sampleCells(0))],
      format: "csv",
      tz: "Asia/Kolkata",
      fileName: "export.csv",
      access: makeAccess(),
    });
    expect(blob.type).toContain("text/csv");
    expect(io.exportMimeType("xlsx")).toContain("spreadsheetml");
  });

  it("importing ./import and parsing a CSV never evaluates exceljs", async () => {
    const io = await import("../src/import/index");
    const table = await io.parseFile(new TextEncoder().encode("a,b\n1,2\n"), { type: "csv" });
    expect(table.headers).toEqual(["a", "b"]);
  });

  it("the XLSX path does load exceljs (and here hits the throwing mock)", async () => {
    const io = await import("../src/export/index");
    await expect(
      io.buildExportBlob({
        columns: visibleColumns(),
        registry,
        rows: [],
        format: "xlsx",
        tz: "UTC",
        fileName: "export.xlsx",
        access: makeAccess(),
      }),
    ).rejects.toThrow(/error when mocking a module/);
  });
});
