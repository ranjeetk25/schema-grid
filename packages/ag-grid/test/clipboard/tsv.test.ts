import { describe, expect, it } from "vitest";
import { parseTsv, serializeTsv } from "../../src/clipboard/tsv";

describe("serializeTsv / parseTsv", () => {
  it("round-trips a simple matrix", () => {
    const matrix = [
      ["a", "b", "c"],
      ["1", "2", "3"],
    ];
    const text = serializeTsv(matrix);
    expect(text).toBe("a\tb\tc\n1\t2\t3");
    expect(parseTsv(text)).toEqual(matrix);
  });

  it("quotes a field containing a tab", () => {
    const matrix = [["a\tb", "c"]];
    const text = serializeTsv(matrix);
    expect(text).toBe('"a\tb"\tc');
    expect(parseTsv(text)).toEqual(matrix);
  });

  it("quotes a field containing a newline and round-trips multiline content", () => {
    const matrix = [["line1\nline2", "x"]];
    const text = serializeTsv(matrix);
    expect(text).toBe('"line1\nline2"\tx');
    expect(parseTsv(text)).toEqual(matrix);
  });

  it("doubles embedded quotes", () => {
    const matrix = [['he said "hi"']];
    const text = serializeTsv(matrix);
    expect(text).toBe('"he said ""hi"""');
    expect(parseTsv(text)).toEqual(matrix);
  });

  it("handles CRLF row separators", () => {
    const parsed = parseTsv("a\tb\r\nc\td");
    expect(parsed).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("ignores a single trailing newline", () => {
    expect(parseTsv("a\tb\n")).toEqual([["a", "b"]]);
    expect(parseTsv("a\tb\r\n")).toEqual([["a", "b"]]);
  });

  it("parses a single cell", () => {
    expect(parseTsv("hello")).toEqual([["hello"]]);
  });

  it("preserves empty cells", () => {
    expect(parseTsv("a\t\tb\n\t\t")).toEqual([
      ["a", "", "b"],
      ["", "", ""],
    ]);
  });

  it("a quoted field containing CRLF round-trips", () => {
    const matrix = [["a\r\nb", "c"]];
    const text = serializeTsv(matrix);
    expect(parseTsv(text)).toEqual(matrix);
  });

  it("treats a mid-field quote as literal text", () => {
    expect(parseTsv('5" screen\tnext value')).toEqual([['5" screen', "next value"]]);
  });

  it("a trailing tab means an empty last cell", () => {
    expect(parseTsv("a\tb\t")).toEqual([["a", "b", ""]]);
  });

  it("keeps ragged rows", () => {
    expect(parseTsv("a\tb\nc")).toEqual([["a", "b"], ["c"]]);
    expect(parseTsv(serializeTsv([["a", "b"], ["c"]]))).toEqual([["a", "b"], ["c"]]);
  });
});
