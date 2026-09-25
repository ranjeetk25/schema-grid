import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExport,
  buildExportBlob,
  buildExportStream,
  exportFileName,
  exportMimeType,
  isBrowserRuntime,
  runtime,
} from "../src/export/build-export";
import type { ExportFormat, ExportOptions } from "../src/export/types";
import { XLSX_MIME } from "../src/export/xlsx-shared";
import type { GridRow } from "../src/internal/core";
import { HiddenColumnError } from "../src/internal/errors";
import { makeRegistry } from "./helpers/registry";
import { makeAccess, makeColumns, makeRow, sampleCells, visibleColumns } from "./helpers/schema";
import { collectNodeStream } from "./helpers/streams";

const registry = makeRegistry();
const FORMATS: ExportFormat[] = ["csv", "xlsx"];

function opts(format: ExportFormat, overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    columns: visibleColumns(),
    registry,
    rows: [makeRow(sampleCells(0))],
    format,
    tz: "Asia/Kolkata",
    fileName: `leads.${format}`,
    access: makeAccess(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildExport dispatch", () => {
  it("is not a browser runtime under the node test env", () => {
    expect(isBrowserRuntime()).toBe(false);
  });

  for (const format of FORMATS) {
    it(`returns a Readable (not a Blob) in node for ${format}`, async () => {
      const out = await buildExport(opts(format));
      expect(out).toBeInstanceOf(Readable);
      expect(out).not.toBeInstanceOf(Blob);
      const bytes = await collectNodeStream(out as Readable);
      expect(bytes.byteLength).toBeGreaterThan(0);
    });

    it(`returns a Blob when the runtime is a browser for ${format}`, async () => {
      vi.spyOn(runtime, "isBrowser").mockReturnValue(true);
      const out = await buildExport(opts(format));
      expect(out).toBeInstanceOf(Blob);
      expect((out as Blob).type).toBe(exportMimeType(format));
    });

    it(`buildExportBlob / buildExportStream force their path for ${format}`, async () => {
      expect(await buildExportBlob(opts(format))).toBeInstanceOf(Blob);
      const stream = await buildExportStream(opts(format));
      expect(stream).toBeInstanceOf(Readable);
      await collectNodeStream(stream);
    });

    it(`rejects a hidden column with HiddenColumnError for ${format} before pulling rows`, async () => {
      let pulled = false;
      const rows = (): AsyncIterable<GridRow> => ({
        async *[Symbol.asyncIterator]() {
          pulled = true;
          yield makeRow(sampleCells(0));
        },
      });
      const bad = (): ExportOptions => opts(format, { columns: makeColumns(), rows: rows() });
      await expect(buildExport(bad())).rejects.toBeInstanceOf(HiddenColumnError);
      await expect(buildExportBlob(bad())).rejects.toBeInstanceOf(HiddenColumnError);
      await expect(buildExportStream(bad())).rejects.toBeInstanceOf(HiddenColumnError);
      vi.spyOn(runtime, "isBrowser").mockReturnValue(true);
      await expect(buildExport(bad())).rejects.toBeInstanceOf(HiddenColumnError);
      expect(pulled).toBe(false);
    });
  }

  it("rejects a column missing from the access map", async () => {
    const access = makeAccess();
    access.delete("c_name");
    await expect(buildExport(opts("csv", { access }))).rejects.toMatchObject({
      name: "HiddenColumnError",
      columnIds: ["c_name"],
    });
  });
});

describe("exportFileName", () => {
  it.each([
    ["leads", "csv", "leads.csv"],
    ["leads", "xlsx", "leads.xlsx"],
    ["leads.csv", "csv", "leads.csv"],
    ["Leads.CSV", "csv", "Leads.CSV"],
    ["Leads.XLSX", "xlsx", "Leads.XLSX"],
    ["leads.csv", "xlsx", "leads.xlsx"],
    ["leads.XLSX", "csv", "leads.csv"],
    ["report.2026.09", "csv", "report.2026.09.csv"],
    ["notes.txt", "xlsx", "notes.txt.xlsx"],
    ["  leads  ", "csv", "leads.csv"],
    ["", "xlsx", "export.xlsx"],
    ["leads.", "csv", "leads.csv"],
    [".csv", "xlsx", "export.xlsx"],
    [".csv", "csv", "export.csv"],
    ['a/b\\c"d\ne', "csv", "a_b_c_d_e.csv"],
  ] as const)("%j as %s → %j", (name, format, expected) => {
    expect(exportFileName(name, format)).toBe(expected);
  });
});

describe("exportMimeType", () => {
  it("maps each format to its MIME type", () => {
    expect(exportMimeType("csv")).toBe("text/csv;charset=utf-8");
    expect(exportMimeType("xlsx")).toBe(XLSX_MIME);
  });
});
