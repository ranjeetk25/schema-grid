import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectFileType } from "../src/import/detect";
import { decodeUtf8, readInputBytes } from "../src/internal/bytes";
import { parseCsvText } from "../src/import/csv";
import { toArrayBuffer, webStreamOf } from "./helpers/streams";

const fixturesDir = join(__dirname, "fixtures");

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe("parseCsvText via fixtures", () => {
  it("strips the BOM from the first header", () => {
    const bytes = readFixture("bom.csv");
    const text = decodeUtf8(bytes);
    const table = parseCsvText(text);
    expect(table.headers[0]).toBe("name");
    expect(table.headers[0]?.charCodeAt(0)).not.toBe(0xfeff);
    expect(table.headers).toEqual(["name", "email"]);
    expect(table.rows).toEqual([
      ["Alice", "alice@example.com"],
      ["Bob", "bob@example.com"],
    ]);
  });

  it("detects semicolon delimiter and keeps a quoted decimal-comma cell intact", () => {
    const bytes = readFixture("semicolon.csv");
    const text = decodeUtf8(bytes);
    const table = parseCsvText(text);
    expect(table.delimiter).toBe(";");
    expect(table.headers).toEqual(["name", "amount"]);
    expect(table.rows).toEqual([
      ["Alice", "1,5"],
      ["Bob", "2,3"],
    ]);
  });

  it("keeps an embedded newline inside a quoted cell and counts rows correctly", () => {
    const bytes = readFixture("quoted-newline.csv");
    const text = decodeUtf8(bytes);
    const table = parseCsvText(text);
    expect(table.headers).toEqual(["name", "note"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.[1]).toBe('line1\nline2 "quoted"');
    expect(table.rows[1]).toEqual(["Bob", "plain"]);
  });

  it("supports headerRow: 2, ignoring the first line", () => {
    const text = "Title Row\nname,email\nAlice,alice@example.com\n";
    const table = parseCsvText(text, { headerRow: 2 });
    expect(table.headers).toEqual(["name", "email"]);
    expect(table.rows).toEqual([["Alice", "alice@example.com"]]);
    expect(table.headerRow).toBe(2);
  });

  it("renames duplicate and blank headers", () => {
    const text = "name,,name,Name\nAlice,x,y,z\n";
    const table = parseCsvText(text);
    expect(table.headers).toEqual(["name", "Column 2", "name (2)", "Name (3)"]);
  });

  it("truncates at maxRows and reports truncated correctly", () => {
    const lines = ["h1,h2"];
    for (let i = 1; i <= 5; i++) lines.push(`r${i}a,r${i}b`);
    const text = `${lines.join("\n")}\n`;

    const truncated = parseCsvText(text, { maxRows: 2 });
    expect(truncated.rows).toHaveLength(2);
    expect(truncated.truncated).toBe(true);

    const exactLines = ["h1,h2", "r1a,r1b", "r2a,r2b"];
    const exactText = `${exactLines.join("\n")}\n`;
    const exact = parseCsvText(exactText, { maxRows: 2 });
    expect(exact.rows).toHaveLength(2);
    expect(exact.truncated).toBe(false);
  });
});

describe("readInputBytes", () => {
  it("returns identical bytes for ArrayBuffer, Blob and web ReadableStream", async () => {
    const source = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const fromArrayBuffer = await readInputBytes(toArrayBuffer(source));
    expect(Array.from(fromArrayBuffer)).toEqual(Array.from(source));

    const blob = new Blob([toArrayBuffer(source)]);
    const fromBlob = await readInputBytes(blob);
    expect(Array.from(fromBlob)).toEqual(Array.from(source));

    const fromStream = await readInputBytes(webStreamOf(source, 3));
    expect(Array.from(fromStream)).toEqual(Array.from(source));
  });
});

describe("detectFileType", () => {
  it("recognises the zip signature as xlsx", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]);
    expect(detectFileType({}, bytes)).toBe("xlsx");
  });

  it("falls back to csv for non-zip bytes", () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);
    expect(detectFileType({}, bytes)).toBe("csv");
  });

  it("an explicit hint overrides everything", () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(detectFileType({}, zipBytes, "csv")).toBe("csv");
    const csvBytes = new Uint8Array([0x61, 0x62, 0x63]);
    expect(detectFileType({}, csvBytes, "xlsx")).toBe("xlsx");
  });

  it("uses the File name extension when present", () => {
    const file = new File(["a,b"], "x.csv", { type: "text/csv" });
    const bytes = new TextEncoder().encode("a,b");
    expect(detectFileType(file, bytes)).toBe("csv");

    const xlsxFile = new File(["not really xlsx bytes"], "x.xlsx");
    expect(detectFileType(xlsxFile, bytes)).toBe("xlsx");

    const xlsmFile = new File(["x"], "X.XLSM");
    expect(detectFileType(xlsmFile, bytes)).toBe("xlsx");

    const tsvFile = new File(["x"], "x.tsv");
    expect(detectFileType(tsvFile, bytes)).toBe("csv");
  });
});
