import { describe, expect, it } from "vitest";
import { buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, FIXTURE_IDS } from "../test/fixtures";
import * as io from "./io-contracts";

describe("io-contracts (real @ranjeetk25/schema-grid-io)", () => {
  it("re-exports the import and export functions", () => {
    for (const name of [
      "parseFile",
      "autoMapColumns",
      "validateRows",
      "toChangeBatches",
      "keyOf",
      "createImportJobState",
      "buildErrorReportCsv",
      "buildExport",
      "buildExportBlob",
      "exportFileName",
    ] as const) {
      expect(typeof io[name], name).toBe("function");
    }
    expect(new io.ImportConfigError("x")).toBeInstanceOf(Error);
    expect(new io.HiddenColumnError(["c"]).columnIds).toEqual(["c"]);
  });

  it("parses a CSV and auto-maps it to writable columns only", async () => {
    const schema = buildFixtureSchema();
    const parsed = await io.parseFile(new Blob(["Payment status,Secret,Total\nPaid,x,1\n"]), { type: "csv" });
    expect(parsed.headers).toEqual(["Payment status", "Secret", "Total"]);
    const mapping = io.autoMapColumns(parsed.headers, schema, buildFixtureAccess(schema));
    expect(mapping.map((m) => m.columnId)).toEqual([FIXTURE_IDS.payment, null, null]);
    const report = io.validateRows(parsed, mapping, schema, buildFixtureRegistry(), { mode: "create", unknownOptions: "reject" });
    expect(report.summary.valid).toBe(1);
  });

  it("KEY_COLUMN_TYPES matches what validateRows accepts as a key", async () => {
    const schema = buildFixtureSchema();
    const parsed = await io.parseFile(new Blob(["Payment status\nPaid\n"]), { type: "csv" });
    const mapping = io.autoMapColumns(parsed.headers, schema, buildFixtureAccess(schema));
    expect(io.KEY_COLUMN_TYPES.has("select")).toBe(false);
    expect(() =>
      io.validateRows(parsed, mapping, schema, buildFixtureRegistry(), {
        mode: "upsert",
        keyColumnId: FIXTURE_IDS.payment,
        unknownOptions: "reject",
      }),
    ).toThrow(io.ImportConfigError);
  });
});
