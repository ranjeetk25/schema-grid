import { describe, expect, it } from "vitest";
import {
  columnWidthChars,
  excelNumFmtFor,
  sanitizeCsvText,
  toCsvCell,
  toExcelCell,
} from "../src/export/cells";
import { toAsyncIterable } from "../src/export/rows";
import { assertNoHiddenColumns } from "../src/internal/access";
import type { ColumnDef } from "../src/internal/core";
import { HiddenColumnError } from "../src/internal/errors";
import { makeRegistry } from "./helpers/registry";
import {
  getColumn,
  makeAccess,
  makeColumns,
  visibleColumns,
} from "./helpers/schema";

const registry = makeRegistry();
const TZ = "Asia/Kolkata";

function adHoc(type: string, extra: Partial<ColumnDef> = {}): ColumnDef {
  return {
    id: `c_${type}`,
    key: type,
    label: type,
    type,
    config: {},
    order: 99,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  };
}

describe("toExcelCell", () => {
  it("empty values become a null cell", () => {
    for (const v of [null, undefined, "", []]) {
      expect(toExcelCell(v, getColumn("c_name"), registry, TZ)).toEqual({
        value: null,
      });
      expect(toExcelCell(v, getColumn("c_amount"), registry, TZ)).toEqual({
        value: null,
      });
    }
  });

  it("currency becomes a number with a currency numFmt", () => {
    const cell = toExcelCell(1234.5, getColumn("c_amount"), registry, TZ);
    expect(cell.value).toBe(1234.5);
    expect(cell.numFmt).toContain("0.00");
    expect(cell.numFmt).toContain("₹");
  });

  it("numeric strings become numbers", () => {
    const cell = toExcelCell("1234.5", getColumn("c_amount"), registry, TZ);
    expect(cell.value).toBe(1234.5);
  });

  it("number numFmt follows precision", () => {
    expect(excelNumFmtFor(adHoc("number", { config: { precision: 2 } }))).toBe(
      "#,##0.00",
    );
    expect(excelNumFmtFor(adHoc("number", { config: { precision: 0 } }))).toBe(
      "#,##0",
    );
    // No precision: core's default (0); the value itself stays exact.
    expect(excelNumFmtFor(adHoc("number"))).toBe("#,##0");
    expect(toExcelCell(1.2345, adHoc("number"), registry, TZ)).toEqual({
      value: 1.2345,
      numFmt: "#,##0",
    });
  });

  it("date becomes a Date with matching UTC fields", () => {
    const cell = toExcelCell("2026-09-25", getColumn("c_joined"), registry, TZ);
    expect(cell.value).toBeInstanceOf(Date);
    const d = cell.value as Date;
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8);
    expect(d.getUTCDate()).toBe(25);
    expect(cell.numFmt).toBe("yyyy-mm-dd");
  });

  it("unparseable date falls back to a string", () => {
    const cell = toExcelCell("not a date", getColumn("c_joined"), registry, TZ);
    expect(typeof cell.value).toBe("string");
  });

  it("datetime becomes Kolkata wall clock", () => {
    const cell = toExcelCell(
      "2026-09-25T05:00:00Z",
      getColumn("c_call"),
      registry,
      TZ,
    );
    const d = cell.value as Date;
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCHours()).toBe(10);
    expect(d.getUTCMinutes()).toBe(30);
    expect(d.getUTCDate()).toBe(25);
    expect(cell.numFmt).toBe("yyyy-mm-dd hh:mm");
  });

  it("invalid tz throws", () => {
    expect(() =>
      toExcelCell(
        "2026-09-25T05:00:00Z",
        getColumn("c_call"),
        registry,
        "Not/AZone",
      ),
    ).toThrow(RangeError);
  });

  it("boolean becomes a JS boolean", () => {
    expect(toExcelCell(true, getColumn("c_active"), registry, TZ).value).toBe(
      true,
    );
    expect(
      toExcelCell("false", getColumn("c_active"), registry, TZ).value,
    ).toBe(false);
  });

  it("select becomes its label", () => {
    expect(
      toExcelCell("opt_paid", getColumn("c_pay"), registry, TZ).value,
    ).toBe("Paid");
  });

  it("multiSelect joins labels", () => {
    expect(
      toExcelCell(["tag_a", "tag_b"], getColumn("c_tags"), registry, TZ).value,
    ).toBe("A, B");
    expect(
      toExcelCell(["tag_a", "zzz"], getColumn("c_tags"), registry, TZ).value,
    ).toBe("A, zzz");
  });

  it("url becomes a hyperlink object", () => {
    const cell = toExcelCell(
      "https://example.com/a",
      getColumn("c_site"),
      registry,
      TZ,
    );
    expect(cell.value).toEqual({
      text: "https://example.com/a",
      hyperlink: "https://example.com/a",
    });
    const bad = toExcelCell(
      "javascript:alert(1)",
      getColumn("c_site"),
      registry,
      TZ,
    );
    expect(bad.value).toBe("javascript:alert(1)");
  });

  it("formula follows the JS type of its value", () => {
    expect(toExcelCell(42, getColumn("c_score"), registry, TZ).value).toBe(42);
    expect(toExcelCell(true, getColumn("c_score"), registry, TZ).value).toBe(
      true,
    );
    const dt = toExcelCell(
      "2026-09-25T05:00:00Z",
      getColumn("c_score"),
      registry,
      TZ,
    );
    expect((dt.value as Date).getUTCHours()).toBe(10);
    const d = toExcelCell("2026-09-25", getColumn("c_score"), registry, TZ);
    expect((d.value as Date).getUTCDate()).toBe(25);
    expect(toExcelCell("hello", getColumn("c_score"), registry, TZ).value).toBe(
      "hello",
    );
  });

  it("user uses the field type format", () => {
    expect(
      toExcelCell(
        { id: "u1", name: "Ravi" },
        getColumn("c_owner"),
        registry,
        TZ,
      ).value,
    ).toBe("Ravi");
  });

  it("unknown type falls back to String(value)", () => {
    expect(toExcelCell(12, adHoc("mystery"), registry, TZ).value).toBe("12");
  });

  it("a throwing format falls back to String(value)", () => {
    const reg = makeRegistry();
    const text = reg.get("text");
    if (!text) throw new Error("no text type");
    reg.register({
      ...text,
      id: "boom",
      label: "boom",
      defaultConfig: {},
      parse: () => ({ ok: false, error: "x" }),
      format: () => {
        throw new Error("nope");
      },
      serialize: (v: unknown) => v,
      deserialize: () => null,
      compare: () => 0,
      defaultValue: () => null,
    });
    expect(toExcelCell("abc", adHoc("boom"), reg, TZ).value).toBe("abc");
    expect(toCsvCell("abc", adHoc("boom"), reg)).toBe("abc");
  });
});

describe("toCsvCell and sanitizeCsvText", () => {
  it("prefixes formula-like text", () => {
    expect(
      toCsvCell('=HYPERLINK("http://x","y")', getColumn("c_name"), registry),
    ).toBe(`'=HYPERLINK("http://x","y")`);
    expect(toCsvCell("@SUM(A1)", getColumn("c_note"), registry)).toBe(
      "'@SUM(A1)",
    );
  });

  it("leaves numeric and phone columns untouched", () => {
    expect(toCsvCell("-5", adHoc("number"), registry)).toBe("-5");
    expect(toCsvCell("+91 98765 43210", adHoc("phone"), registry)).toBe(
      "+91 98765 43210",
    );
  });

  it("formats select / multiSelect / currency", () => {
    expect(toCsvCell("opt_paid", getColumn("c_pay"), registry)).toBe("Paid");
    expect(toCsvCell(["tag_a", "tag_b"], getColumn("c_tags"), registry)).toBe(
      "A, B",
    );
    expect(toCsvCell(null, getColumn("c_amount"), registry)).toBe("");
  });

  it("formula: numeric strings untouched, text sanitized", () => {
    expect(toCsvCell(-3, getColumn("c_score"), registry)).toBe("-3");
    expect(toCsvCell("-3", getColumn("c_score"), registry)).toBe("-3");
    const textFormula = { ...getColumn("c_score"), config: { resultType: "text" } };
    expect(toCsvCell("=cmd", textFormula, registry)).toBe("'=cmd");
  });

  it("sanitizeCsvText covers every trigger character", () => {
    for (const c of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(sanitizeCsvText(`${c}x`)).toBe(`'${c}x`);
    }
    expect(sanitizeCsvText("plain")).toBe("plain");
    expect(sanitizeCsvText("")).toBe("");
  });
});

describe("columnWidthChars", () => {
  it("converts px to chars with default and clamps", () => {
    expect(columnWidthChars(getColumn("c_name"))).toBe(20);
    expect(columnWidthChars(getColumn("c_email"))).toBe(15);
    expect(columnWidthChars(adHoc("text", { width: 10 }))).toBe(8);
    expect(columnWidthChars(adHoc("text", { width: 5000 }))).toBe(80);
    expect(columnWidthChars(adHoc("text", { width: Number.NaN }))).toBe(15);
  });
});

describe("assertNoHiddenColumns", () => {
  it("throws for c_secret", () => {
    expect(() => assertNoHiddenColumns(makeColumns(), makeAccess())).toThrow(
      HiddenColumnError,
    );
  });

  it("throws for a column missing from the access map", () => {
    const access = makeAccess();
    access.delete("c_email");
    expect(() => assertNoHiddenColumns(visibleColumns(), access)).toThrow(
      HiddenColumnError,
    );
  });

  it("passes for visible columns", () => {
    expect(() =>
      assertNoHiddenColumns(visibleColumns(), makeAccess()),
    ).not.toThrow();
  });
});

describe("toAsyncIterable", () => {
  async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const x of it) out.push(x);
    return out;
  }

  it("wraps an array", async () => {
    expect(await collect(toAsyncIterable([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it("passes through an async generator", async () => {
    async function* gen() {
      yield "a";
      yield "b";
    }
    expect(await collect(toAsyncIterable(gen()))).toEqual(["a", "b"]);
  });
});

describe("review hardening", () => {
  const csv = (v: unknown, c: ColumnDef) => toCsvCell(v, c, registry);
  const PAYLOAD = '=HYPERLINK("http://evil","x")';

  it("guards payloads echoed by any column type in CSV", () => {
    // Whatever a type's format does with an invalid stored value (core's
    // datetime returns "", date echoes it), the CSV text never starts a formula.
    expect(csv(PAYLOAD, getColumn("c_call"))).not.toMatch(/^[=+\-@]/);
    expect(csv(PAYLOAD, getColumn("c_joined"))).not.toMatch(/^[=+\-@]/);
    expect(csv("+cmd|' /C calc'!A0", adHoc("phone"))).toBe("'+cmd|' /C calc'!A0");
    expect(
      csv(["=cmd"], { ...getColumn("c_score"), config: { resultType: "text" } }),
    ).not.toMatch(/^[=+\-@]/);
    expect(csv(PAYLOAD, adHoc("number"))).not.toMatch(/^=/);
  });

  it("leaves safe shapes untouched", () => {
    expect(csv("+91 98765 43210", adHoc("phone"))).toBe("+91 98765 43210");
    expect(csv(-5, adHoc("number"))).toBe("-5");
    expect(csv(-1234.5, getColumn("c_amount"))).toMatch(/^-?₹?-?1,234\.50$/);
    expect(csv("2026-09-25T05:00:00.000Z", getColumn("c_call"))).toBe(
      "2026-09-25T05:00:00.000Z",
    );
    expect(csv(true, getColumn("c_active"))).toBe("true");
  });

  it("guards leading whitespace, LF and full-width triggers", () => {
    expect(sanitizeCsvText(" =1+1")).toBe("' =1+1");
    expect(sanitizeCsvText("\n=1")).toBe("'\n=1");
    expect(sanitizeCsvText("＝1+1")).toBe("'＝1+1");
    expect(sanitizeCsvText("hello")).toBe("hello");
  });

  it("whitespace-only is empty, not zero", () => {
    expect(toExcelCell("  ", adHoc("number"), registry, TZ)).toEqual({ value: null });
    expect(csv("  ", adHoc("number"))).toBe("");
  });

  it("keeps >15-digit ids as text", () => {
    const cell = toExcelCell("98765432101234567", adHoc("number"), registry, TZ);
    expect(cell.value).toBeTypeOf("string");
    expect(toExcelCell(2 ** 60, adHoc("number"), registry, TZ).value).toBeTypeOf(
      "string",
    );
  });

  it("reads zone-less datetimes as UTC, not host-local", () => {
    const cell = toExcelCell("2026-09-25T05:00:00", getColumn("c_call"), registry, TZ);
    expect((cell.value as Date).toISOString()).toBe("2026-09-25T10:30:00.000Z");
  });

  it("date edge cases", () => {
    expect(
      toExcelCell("2026-09-25garbage", getColumn("c_joined"), registry, TZ).value,
    ).not.toBeInstanceOf(Date);
    const fromDate = toExcelCell(
      new Date(Date.UTC(2026, 8, 25)),
      getColumn("c_joined"),
      registry,
      TZ,
    );
    expect((fromDate.value as Date).toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(
      toExcelCell("1850-01-01", getColumn("c_joined"), registry, TZ).value,
    ).toBeTypeOf("string");
  });

  it("datetime in a DST zone uses that day's offset", () => {
    const col = getColumn("c_call");
    const summer = toExcelCell("2026-07-01T16:00:00.000Z", col, registry, "America/New_York");
    const winter = toExcelCell("2026-12-01T17:00:00.000Z", col, registry, "America/New_York");
    expect((summer.value as Date).toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect((winter.value as Date).toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });

  it("booleans accept 0/1/yes/no; junk stays visible text", () => {
    const col = getColumn("c_active");
    expect(toExcelCell("0", col, registry, TZ).value).toBe(false);
    expect(toExcelCell(1, col, registry, TZ).value).toBe(true);
    expect(toExcelCell("yes", col, registry, TZ).value).toBe(true);
    expect(toExcelCell("maybe", col, registry, TZ).value).toBe("maybe");
  });

  it("url hyperlinks are safe and trimmed", () => {
    const col = getColumn("c_site");
    expect(toExcelCell("javascript:alert(1)", col, registry, TZ).value).toBeTypeOf(
      "string",
    );
    expect(toExcelCell("data:text/html,x", col, registry, TZ).value).toBeTypeOf("string");
    expect(toExcelCell("  https://a.io  ", col, registry, TZ).value).toEqual({
      text: "https://a.io",
      hyperlink: "https://a.io",
    });
    const long = `https://a.io/${"x".repeat(2100)}`;
    expect(toExcelCell(long, col, registry, TZ).value).toBeTypeOf("string");
  });

  it("negative currency format has a two-section numFmt", () => {
    expect(toExcelCell(-5, getColumn("c_amount"), registry, TZ).numFmt).toBe(
      '"₹"#,##0.00;-"₹"#,##0.00',
    );
  });

  it("non-finite formula numbers become empty; -0 becomes 0", () => {
    expect(toExcelCell(Number.NaN, getColumn("c_score"), registry, TZ).value).toBeNull();
    expect(toExcelCell(-0, adHoc("number"), registry, TZ).value).toBe(0);
  });
});
