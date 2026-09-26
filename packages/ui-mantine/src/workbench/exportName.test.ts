import { createFixtureSchema } from "@ranjeetk25/schema-grid-core/testing";
import { describe, expect, it } from "vitest";
import { defaultExportFileName, isoDate, resolveExportFileName, slugify, withExtension } from "./exportName";

const now = new Date(2026, 8, 26, 10, 0, 0);

describe("defaultExportFileName", () => {
  it("is grid-view-date.format, slugified", () => {
    expect(defaultExportFileName({ gridId: "Leads Grid", schemaId: "x", viewName: "Unpaid, called yesterday", format: "csv", now })).toBe(
      "leads-grid-unpaid-called-yesterday-2026-09-26.csv",
    );
  });

  it("falls back to the schema id and 'all'", () => {
    expect(defaultExportFileName({ schemaId: "admissions", format: "xlsx", now })).toBe("admissions-all-2026-09-26.xlsx");
    expect(defaultExportFileName({ gridId: "", schemaId: "admissions", viewName: "", format: "csv", now })).toBe(
      "admissions-all-2026-09-26.csv",
    );
    expect(defaultExportFileName({ schemaId: "***", format: "csv", now })).toBe("export-all-2026-09-26.csv");
  });
});

describe("helpers", () => {
  it("slugify / isoDate / withExtension", () => {
    expect(slugify("  Hello, World!! ")).toBe("hello-world");
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(withExtension("report", "csv")).toBe("report.csv");
    expect(withExtension("report.CSV", "csv")).toBe("report.CSV");
  });
});

describe("resolveExportFileName", () => {
  const ctx = { gridId: "leads", schema: createFixtureSchema(), view: null, format: "csv" as const, date: now };
  it("uses a string verbatim (plus extension), calls a function, else the default", () => {
    expect(resolveExportFileName("My Export", ctx)).toBe("My Export.csv");
    expect(resolveExportFileName((c) => `${c.gridId}-${c.format}`, ctx)).toBe("leads-csv.csv");
    expect(resolveExportFileName(undefined, ctx)).toBe("leads-all-2026-09-26.csv");
  });
});
