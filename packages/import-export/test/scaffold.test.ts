import { describe, expect, it } from "vitest";
import { assertNoHiddenColumns, isImportable } from "../src/internal/access";
import {
  columnsOf,
  getNumericConfig,
  getSelectOptions,
  unwrapParse,
} from "../src/internal/core";
import { HiddenColumnError } from "../src/internal/errors";
import { makeRegistry } from "./helpers/registry";
import { getColumn, makeAccess, makeColumns, makeSchema } from "./helpers/schema";

describe("scaffold", () => {
  it("imports every entry barrel", async () => {
    const mods = await Promise.all([
      import("../src/index"),
      import("../src/import/index"),
      import("../src/export/index"),
      import("../src/clipboard/index"),
    ]);
    for (const m of mods) expect(m).toBeTypeOf("object");
    expect(mods[0].HiddenColumnError).toBe(HiddenColumnError);
  });

  it("unwrapParse normalises success and failure", () => {
    const number = makeRegistry().get("number");
    expect(number).toBeDefined();
    expect(unwrapParse(number?.parse("12.5", {}))).toEqual({ ok: true, value: 12.5 });
    const bad = unwrapParse(number?.parse("abc", {}));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/number/i);
  });

  it("unwrapParse tolerates alternate shapes", () => {
    expect(unwrapParse({ success: true, data: 1 })).toEqual({ ok: true, value: 1 });
    expect(unwrapParse({ ok: false, error: { message: "nope" } })).toEqual({
      ok: false,
      error: "nope",
    });
    expect(unwrapParse(undefined).ok).toBe(false);
    expect(
      unwrapParse({ ok: true, value: "X", pendingOptions: ["X"] }),
    ).toEqual({ ok: true, value: "X", pendingOptions: ["X"] });
  });

  it("getSelectOptions reads options defensively", () => {
    expect(getSelectOptions(getColumn("c_pay")).map((o) => o.label)).toEqual([
      "Paid",
      "Pending",
    ]);
    expect(getSelectOptions(getColumn("c_pay"))[0]?.value).toBe("opt_paid");
    expect(getSelectOptions(getColumn("c_name"))).toEqual([]);
  });

  it("getNumericConfig reads currency config", () => {
    expect(getNumericConfig(getColumn("c_amount"))).toEqual({
      precision: 2,
      currencyCode: "INR",
    });
    expect(getNumericConfig(getColumn("c_name"))).toEqual({});
  });

  it("fixture schema has hidden + formula columns", () => {
    const schema = makeSchema();
    expect(columnsOf(schema).map((c) => c.id)).toContain("c_secret");
    expect(columnsOf(makeColumns()).find((c) => c.id === "c_score")?.type).toBe(
      "formula",
    );
    expect(makeAccess().get("c_secret")).toBe("hidden");
    expect(makeAccess().get("c_note")).toBe("read");
    expect(makeAccess().get("c_pay")).toBe("edit");
  });

  it("assertNoHiddenColumns fails closed", () => {
    const access = makeAccess();
    expect(() => assertNoHiddenColumns([getColumn("c_name")], access)).not.toThrow();
    try {
      assertNoHiddenColumns([getColumn("c_name"), getColumn("c_secret")], access);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HiddenColumnError);
      expect((e as HiddenColumnError).columnIds).toEqual(["c_secret"]);
    }
    expect(() =>
      assertNoHiddenColumns([getColumn("c_name")], new Map()),
    ).toThrow(HiddenColumnError);
  });

  it("isImportable requires edit access and non-formula", () => {
    const access = makeAccess();
    expect(isImportable(getColumn("c_pay"), access)).toBe(true);
    expect(isImportable(getColumn("c_note"), access)).toBe(false);
    expect(isImportable(getColumn("c_secret"), access)).toBe(false);
    expect(isImportable(getColumn("c_score"), access)).toBe(false);
  });

  it("fake registry covers the fixture types", () => {
    const reg = makeRegistry();
    for (const c of makeColumns()) expect(reg.has(c.type)).toBe(true);
    const pay = getColumn("c_pay");
    expect(reg.get("select")?.format("opt_paid", pay.config)).toBe("Paid");
    expect(unwrapParse(reg.get("select")?.parse("paid", pay.config))).toEqual({
      ok: true,
      value: "opt_paid",
    });
    const call = getColumn("c_call");
    expect(
      unwrapParse(reg.get("datetime")?.parse("2026-09-25 10:30", call.config)),
    ).toEqual({ ok: true, value: "2026-09-25T05:00:00.000Z" });
  });
});
