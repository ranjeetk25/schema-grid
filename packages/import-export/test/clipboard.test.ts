import { describe, expect, it } from "vitest";
import { HiddenColumnError } from "../src/internal/errors";
import { formatForClipboard } from "../src/clipboard/format";
import { formatMatrixForClipboard, parseClipboard } from "../src/clipboard/tsv";
import { makeAccess, makeRow, makeSchema, visibleColumns } from "./helpers/schema";
import { makeRegistry } from "./helpers/registry";

describe("formatMatrixForClipboard", () => {
  it("joins cells with tabs and rows with CRLF, no trailing newline", () => {
    const out = formatMatrixForClipboard([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(out).toBe("a\tb\r\nc\td");
  });

  it("quotes a cell containing an embedded quote and newline, and round-trips", () => {
    const cell = 'line1\nline2 "quoted"';
    const out = formatMatrixForClipboard([[cell, "plain"]]);
    expect(out).toBe(`"line1\nline2 ""quoted"""\tplain`);
    const parsed = parseClipboard(out);
    expect(parsed).toEqual([[cell, "plain"]]);
  });

  it("quotes a cell containing a tab", () => {
    const out = formatMatrixForClipboard([["a\tb", "c"]]);
    expect(out).toBe(`"a\tb"\tc`);
  });

  it("quotes a cell containing a carriage return", () => {
    const out = formatMatrixForClipboard([["a\rb"]]);
    expect(out).toBe(`"a\rb"`);
  });

  it("does not quote plain cells", () => {
    const out = formatMatrixForClipboard([["hello", "world"]]);
    expect(out).toBe("hello\tworld");
  });

  it("handles empty matrix", () => {
    expect(formatMatrixForClipboard([])).toBe("");
  });
});

describe("parseClipboard", () => {
  it("empty string input yields empty array", () => {
    expect(parseClipboard("")).toEqual([]);
  });

  it("parses a simple TSV grid", () => {
    expect(parseClipboard("a\tb\r\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops exactly one trailing row break (Excel style)", () => {
    expect(parseClipboard("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops only one trailing row break, keeping a genuine blank last row", () => {
    // The blank last row is padded to the width of the widest row.
    expect(parseClipboard("a\tb\r\n\r\n")).toEqual([
      ["a", "b"],
      ["", ""],
    ]);
  });

  it("accepts bare \\n and bare \\r as row breaks", () => {
    expect(parseClipboard("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseClipboard("a\tb\rc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a tab inside a quoted cell as literal content", () => {
    expect(parseClipboard('"a\tb"\tc')).toEqual([["a\tb", "c"]]);
  });

  it("keeps a newline inside a quoted cell, only breaking rows on unquoted breaks", () => {
    expect(parseClipboard('"line1\nline2"\tc\r\nnext\trow')).toEqual([
      ["line1\nline2", "c"],
      ["next", "row"],
    ]);
  });

  it("treats a quote in the middle of a cell literally (not RFC-strict)", () => {
    expect(parseClipboard('a"b\tc')).toEqual([['a"b', "c"]]);
  });

  it("unescapes doubled quotes inside a quoted cell", () => {
    expect(parseClipboard('"say ""hi"""\tc')).toEqual([['say "hi"', "c"]]);
  });

  it("re-reads an unclosed quote as plain text instead of swallowing later rows", () => {
    const input = '"unterminated\tb\r\nnext\trow';
    expect(parseClipboard(input)).toEqual([
      ['"unterminated', "b"],
      ["next", "row"],
    ]);
  });

  it("pads ragged rows to the widest row width", () => {
    expect(parseClipboard("a\tb\tc\r\nd")).toEqual([
      ["a", "b", "c"],
      ["d", "", ""],
    ]);
  });

  it("handles a single empty-quoted cell", () => {
    expect(parseClipboard('""')).toEqual([[""]]);
  });

  it("round-trips formatMatrixForClipboard output through parseClipboard", () => {
    const matrix = [
      ["plain", 'has "quote"', "line1\nline2", "tab\there"],
      ["", "x", "y\r z", "last"],
    ];
    const formatted = formatMatrixForClipboard(matrix);
    expect(parseClipboard(formatted)).toEqual(matrix);
  });
});

describe("formatForClipboard", () => {
  const registry = makeRegistry();
  const columns = visibleColumns();

  it("uses each field type's format (select label, boolean text)", () => {
    const row = makeRow({
      name: "Asha",
      email: "asha@example.com",
      paymentStatus: "opt_paid",
      tags: ["tag_a"],
      stage: "stage_new",
      amount: 100,
      joinedOn: "2026-09-25",
      lastCall: "2026-09-25T05:00:00.000Z",
      active: true,
      website: "https://example.com",
      owner: { id: "u1", name: "Ravi" },
      score: 200,
      note: "hi",
    });
    const out = formatForClipboard([row], columns, registry);
    const lines = out.split("\r\n");
    expect(lines).toHaveLength(1);
    const cells = lines[0]!.split("\t");
    const payIndex = columns.findIndex((c) => c.id === "c_pay");
    const activeIndex = columns.findIndex((c) => c.id === "c_active");
    expect(cells[payIndex]).toBe("Paid");
    expect(cells[activeIndex]).toBe("true");
  });

  it("formats missing/null cell values as empty string", () => {
    const row = makeRow({});
    const out = formatForClipboard([row], columns, registry);
    const cells = out.split("\t");
    expect(cells.every((c) => c === "")).toBe(true);
  });

  it("falls back to String(value) for an unknown field type", () => {
    const weirdColumns = [
      {
        id: "c_weird",
        key: "weird",
        label: "Weird",
        type: "totallyUnknownType",
        config: {},
        order: 0,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const row = makeRow({ weird: 42 });
    const out = formatForClipboard([row], weirdColumns, registry);
    expect(out).toBe("42");
    const rowNullish = makeRow({});
    expect(formatForClipboard([rowNullish], weirdColumns, registry)).toBe("");
  });

  it("prepends a header row of column labels when includeHeaders is set", () => {
    const row = makeRow({ name: "Asha" });
    const out = formatForClipboard([row], columns, registry, {
      includeHeaders: true,
    });
    const lines = out.split("\r\n");
    expect(lines[0]).toBe(columns.map((c) => c.label).join("\t"));
    expect(lines).toHaveLength(2);
  });

  it("throws HiddenColumnError when access includes a hidden/unauthorized column", () => {
    const row = makeRow({ name: "Asha" });
    expect(() =>
      formatForClipboard([row], makeSchema().columns, registry, {
        access: makeAccess(),
      }),
    ).toThrow(HiddenColumnError);
  });

  it("does not throw when access is provided and covers all columns as visible", () => {
    const row = makeRow({ name: "Asha" });
    const access = makeAccess();
    // visibleColumns already excludes the hidden c_secret column
    expect(() =>
      formatForClipboard([row], columns, registry, { access }),
    ).not.toThrow();
  });
});
