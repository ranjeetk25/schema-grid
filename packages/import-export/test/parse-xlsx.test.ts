import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFile } from "../src/import/parse-file";
import { cellToString, parseXlsxBytes } from "../src/import/xlsx";
import { SheetNotFoundError } from "../src/internal/errors";
import { SAMPLE_XLSX } from "./fixtures/generate";
import { toArrayBuffer } from "./helpers/streams";

function sampleBytes(): Uint8Array {
  return new Uint8Array(readFileSync(SAMPLE_XLSX));
}

async function leadsRow(tz?: string): Promise<Record<string, string>> {
  const table = await parseXlsxBytes(sampleBytes(), tz ? { tz } : {});
  const row = table.rows[0] ?? [];
  return Object.fromEntries(table.headers.map((h, i) => [h, row[i] ?? ""]));
}

describe("parseXlsxBytes: cell conversion", () => {
  it("reads a date-only cell as an ISO date", async () => {
    expect((await leadsRow()).Date).toBe("2026-09-25");
  });

  it("reads a datetime as wall clock in the given tz", async () => {
    expect((await leadsRow("Asia/Kolkata")).DateTime).toBe("2026-09-25T05:00:00.000Z");
  });

  it("reads a datetime as UTC by default", async () => {
    expect((await leadsRow()).DateTime).toBe("2026-09-25T10:30:00.000Z");
  });

  it("uses the raw number, not the display format", async () => {
    expect((await leadsRow()).Amount).toBe("1234.5");
  });

  it("removes floating point noise", async () => {
    expect((await leadsRow()).Float).toBe("0.3");
  });

  it("reads booleans as TRUE/FALSE", async () => {
    expect((await leadsRow()).Flag).toBe("TRUE");
  });

  it("reads a formula as its saved result", async () => {
    expect((await leadsRow()).Formula).toBe("2469");
  });

  it("reads hyperlink, rich text, error and blank cells", async () => {
    const row = await leadsRow();
    expect(row.Link).toBe("https://masaischool.com");
    expect(row.Rich).toBe("Hello World");
    expect(row.Error).toBe("");
    expect(row.Blank).toBe("");
  });
});

describe("parseXlsxBytes: sheets and rows", () => {
  it("lists every sheet name", async () => {
    const table = await parseXlsxBytes(sampleBytes());
    expect(table.sheetNames).toEqual(["Leads", "Offset"]);
    expect(table.headers[0]).toBe("Amount");
    expect(table.rows).toHaveLength(5);
  });

  it("selects a sheet by name with an offset header row", async () => {
    const table = await parseXlsxBytes(sampleBytes(), { sheet: "Offset", headerRow: 2 });
    expect(table.headers).toEqual(["Name", "Email", "Score"]);
    expect(table.rows).toEqual([
      ["Asha", "asha@example.com", "91"],
      ["Ravi", "ravi@example.com", "78"],
    ]);
    expect(table.headerRow).toBe(2);
  });

  it("selects a sheet by 1-based index", async () => {
    const table = await parseXlsxBytes(sampleBytes(), { sheet: 2, headerRow: 2 });
    expect(table.headers).toEqual(["Name", "Email", "Score"]);
  });

  it("throws SheetNotFoundError for an unknown sheet", async () => {
    await expect(parseXlsxBytes(sampleBytes(), { sheet: "Nope" })).rejects.toBeInstanceOf(
      SheetNotFoundError,
    );
    await expect(parseXlsxBytes(sampleBytes(), { sheet: "Nope" })).rejects.toMatchObject({
      sheetNames: ["Leads", "Offset"],
    });
    await expect(parseXlsxBytes(sampleBytes(), { sheet: 3 })).rejects.toBeInstanceOf(
      SheetNotFoundError,
    );
  });

  it("truncates to maxRows", async () => {
    const table = await parseXlsxBytes(sampleBytes(), { maxRows: 2 });
    expect(table.rows).toHaveLength(2);
    expect(table.truncated).toBe(true);
    expect(table.rows[1]?.[0]).toBe("300");
  });

  it("is not truncated when maxRows equals the row count", async () => {
    const table = await parseXlsxBytes(sampleBytes(), { maxRows: 5 });
    expect(table.rows).toHaveLength(5);
    expect(table.truncated).toBe(false);
  });
});

describe("parseFile", () => {
  it("routes a .csv File to the CSV parser", async () => {
    const file = new File(["name;age\nAsha;30\n"], "x.csv");
    const table = await parseFile(file);
    expect(table.delimiter).toBe(";");
    expect(table.headers).toEqual(["name", "age"]);
    expect(table.rows).toEqual([["Asha", "30"]]);
    expect(table.sheetNames).toBeUndefined();
  });

  it("routes an XLSX ArrayBuffer to the XLSX parser", async () => {
    const table = await parseFile(toArrayBuffer(sampleBytes()), { tz: "Asia/Kolkata" });
    expect(table.sheetNames).toEqual(["Leads", "Offset"]);
    expect(table.delimiter).toBeUndefined();
    expect(table.rows[0]?.[3]).toBe("2026-09-25T05:00:00.000Z");
  });

  it("passes maxRows and headerRow through", async () => {
    const xlsx = await parseFile(toArrayBuffer(sampleBytes()), { maxRows: 1 });
    expect(xlsx.truncated).toBe(true);
    expect(xlsx.rows).toHaveLength(1);

    const csv = await parseFile(new File(["title\na,b\n1,2\n3,4\n"], "x.csv"), {
      headerRow: 2,
      maxRows: 1,
    });
    expect(csv.headers).toEqual(["a", "b"]);
    expect(csv.rows).toEqual([["1", "2"]]);
    expect(csv.truncated).toBe(true);
  });
});

describe("cellToString", () => {
  it("handles empty values", () => {
    expect(cellToString(null, undefined, "UTC")).toBe("");
    expect(cellToString(undefined, undefined, "UTC")).toBe("");
  });

  it("strips toPrecision noise", () => {
    expect(cellToString(1.0000000000000002, undefined, "UTC")).toBe("1");
    expect(cellToString(-0.30000000000000004, undefined, "UTC")).toBe("-0.3");
  });

  it("reads booleans", () => {
    expect(cellToString(false, undefined, "UTC")).toBe("FALSE");
  });

  it("recurses into shared formula results", () => {
    expect(cellToString({ sharedFormula: "A2", result: 42 }, undefined, "UTC")).toBe("42");
    expect(cellToString({ formula: "A1", result: "x" }, undefined, "UTC")).toBe("x");
    expect(cellToString({ formula: "A1" }, undefined, "UTC")).toBe("");
    expect(cellToString({ formula: "NA()", result: { error: "#N/A" } }, undefined, "UTC")).toBe("");
    expect(
      cellToString({ formula: "TODAY()", result: new Date(Date.UTC(2026, 0, 2)) }, "d/m/yyyy", "UTC"),
    ).toBe("2026-01-02");
  });

  it("falls back to hyperlink text when there is no url", () => {
    expect(cellToString({ text: "Masai" }, undefined, "UTC")).toBe("Masai");
    expect(
      cellToString(
        { text: { richText: [{ text: "A" }, { text: "B" }] }, hyperlink: "" },
        undefined,
        "UTC",
      ),
    ).toBe("AB");
  });

  it("treats an AM/PM format with a locale prefix as a time", () => {
    const midnight = new Date(Date.UTC(2026, 8, 25));
    expect(cellToString(midnight, "[$-409]h:mm AM/PM", "UTC")).toBe("2026-09-25T00:00:00.000Z");
    expect(cellToString(midnight, "[$-409]mmmm d, yyyy", "UTC")).toBe("2026-09-25");
    expect(cellToString(midnight, 'yyyy "h" mm', "UTC")).toBe("2026-09-25");
    expect(cellToString(midnight, undefined, "UTC")).toBe("2026-09-25");
    expect(cellToString(midnight, "yyyy-mm-dd hh:mm", "UTC")).toBe("2026-09-25T00:00:00.000Z");
  });

  it("reads non-midnight dates as instants even with a date-only format", () => {
    const d = new Date(Date.UTC(2026, 8, 25, 10, 30));
    expect(cellToString(d, "yyyy-mm-dd", "UTC")).toBe("2026-09-25T10:30:00.000Z");
  });

  it("returns strings unchanged and unknown objects as empty", () => {
    expect(cellToString("  hi ", undefined, "UTC")).toBe("  hi ");
    expect(cellToString({ foo: 1 }, undefined, "UTC")).toBe("");
    expect(cellToString({ error: "#DIV/0!" }, undefined, "UTC")).toBe("");
  });
});
