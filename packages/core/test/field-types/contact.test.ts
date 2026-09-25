import { describe, expect, it } from "vitest";
import { emailFieldType } from "../../src/field-types/builtins/email";
import { phoneFieldType } from "../../src/field-types/builtins/phone";
import { urlFieldType } from "../../src/field-types/builtins/url";

describe("url field type", () => {
  const c = urlFieldType.defaultConfig;
  it("prepends https:// when the scheme is missing", () => {
    expect(urlFieldType.parse("example.com", c)).toEqual({ ok: true, value: "https://example.com" });
  });
  it("rejects non-urls and accepts other schemes", () => {
    expect(urlFieldType.parse("not a url", c).ok).toBe(false);
    expect(urlFieldType.parse("ftp://x.org", c)).toEqual({ ok: true, value: "ftp://x.org" });
    expect(urlFieldType.parse("", c)).toEqual({ ok: true, value: null });
  });
  it("valueSchema rejects malformed strings; format/parse round-trips", () => {
    const s = urlFieldType.valueSchema(c);
    expect(s.safeParse("not a url").success).toBe(false);
    expect(s.safeParse("https://example.com/a?b=1").success).toBe(true);
    expect(s.safeParse(null).success).toBe(true);
    const v = "https://example.com/path";
    expect(urlFieldType.parse(urlFieldType.format(v, c), c)).toEqual({ ok: true, value: v });
  });
});

describe("email field type", () => {
  const c = emailFieldType.defaultConfig;
  it("lowercases the domain only", () => {
    expect(emailFieldType.parse("A@Example.COM", c)).toEqual({ ok: true, value: "A@example.com" });
  });
  it("rejects a@b and maps empty to null", () => {
    expect(emailFieldType.parse("a@b", c).ok).toBe(false);
    expect(emailFieldType.parse("", c)).toEqual({ ok: true, value: null });
  });
  it("valueSchema rejects malformed strings; format/parse round-trips", () => {
    const s = emailFieldType.valueSchema(c);
    expect(s.safeParse("nope").success).toBe(false);
    expect(s.safeParse("x@y.io").success).toBe(true);
    const v = "x.y+z@mail.example.org";
    expect(emailFieldType.parse(emailFieldType.format(v, c), c)).toEqual({ ok: true, value: v });
  });
});

describe("phone field type", () => {
  const c = phoneFieldType.defaultConfig;
  it("normalises and adds the default country code", () => {
    expect(phoneFieldType.parse("98765 43210", c)).toEqual({ ok: true, value: "+919876543210" });
    expect(phoneFieldType.parse("+1 (415) 555-0100", c)).toEqual({ ok: true, value: "+14155550100" });
    expect(phoneFieldType.parse("4155550100", { defaultCountryCode: "+1" })).toEqual({
      ok: true,
      value: "+14155550100",
    });
  });
  it("rejects too few digits", () => {
    expect(phoneFieldType.parse("123", c).ok).toBe(false);
    expect(phoneFieldType.parse("98a765", c).ok).toBe(false);
  });
  it("valueSchema rejects malformed strings; format/parse round-trips", () => {
    const s = phoneFieldType.valueSchema(c);
    expect(s.safeParse("12").success).toBe(false);
    expect(s.safeParse("9876543210").success).toBe(false);
    expect(s.safeParse("+919876543210").success).toBe(true);
    const v = "+919876543210";
    expect(phoneFieldType.parse(phoneFieldType.format(v, c), c)).toEqual({ ok: true, value: v });
  });
});

describe("contact types share text behaviour", () => {
  it("use TEXT operators, default null, never throw", () => {
    for (const t of [urlFieldType, emailFieldType, phoneFieldType]) {
      expect(t.operators.map((o) => o.id)).toContain("contains");
      expect(t.defaultValue(t.defaultConfig as never)).toBeNull();
      for (const input of [undefined, null, {}, [], Number.NaN, "x".repeat(10000)]) {
        expect(() => t.parse(input, t.defaultConfig as never)).not.toThrow();
      }
    }
  });
});
