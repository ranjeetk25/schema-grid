import { describe, expect, it } from "vitest";
import { buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import { KEY_PATTERN, slugifyKey, uniqueKey } from "./keys";
import { buildColumnDef, columnDraftReducer, createColumnDraft, validateColumnDraft } from "./model";

describe("slugifyKey / uniqueKey", () => {
  it("slugs labels to snake_case keys", () => {
    expect(slugifyKey("Payment Status!")).toBe("payment_status");
    expect(slugifyKey("2024 Revenue")).toBe("col_2024_revenue");
    expect(slugifyKey("  Café  Crème ")).toBe("cafe_creme");
    expect(slugifyKey("!!!")).toBe("col");
    for (const k of ["payment_status", "col_2024_revenue", "cafe_creme", "col"]) expect(k).toMatch(KEY_PATTERN);
  });

  it("appends _2, _3 for duplicates", () => {
    expect(uniqueKey("payment_status", ["payment_status"])).toBe("payment_status_2");
    expect(uniqueKey("payment_status", ["payment_status", "payment_status_2"])).toBe("payment_status_3");
    expect(uniqueKey("fresh", ["payment_status"])).toBe("fresh");
  });
});

describe("column draft model", () => {
  const schema = buildFixtureSchema();
  const registry = buildFixtureRegistry();
  const now = "2026-09-25T12:00:00.000Z";

  it("label drives the key until the key is touched, and dedupes against the schema", () => {
    let d = createColumnDraft({ schema, registry });
    d = columnDraftReducer(d, { type: "setType", fieldType: "select", registry });
    d = columnDraftReducer(d, { type: "setLabel", label: "Payment Status" });
    expect(d.key).toBe("payment_status_2");
    d = columnDraftReducer(d, { type: "setKey", key: "pay" });
    d = columnDraftReducer(d, { type: "setLabel", label: "Payment state" });
    expect(d.key).toBe("pay");
    expect(d.keyTouched).toBe(true);
  });

  it("buildColumnDef fills timestamps, id, order and config defaults on create", () => {
    let d = createColumnDraft({ schema, registry });
    d = columnDraftReducer(d, { type: "setType", fieldType: "currency", registry });
    d = columnDraftReducer(d, { type: "setLabel", label: "Fee" });
    d = columnDraftReducer(d, { type: "setConfig", config: {} });
    const col = buildColumnDef(d, { schema, registry, now, generateId: () => "col_new" });
    expect(col).toMatchObject({
      id: "col_new",
      key: "fee",
      label: "Fee",
      type: "currency",
      config: { currencyCode: "INR", locale: "en-IN", precision: 2 },
      permissions: { read: "all", edit: "all" },
      order: 8,
      createdAt: now,
      updatedAt: now,
    });
    expect(col.formula).toBeUndefined();
  });

  it("keeps id, key, order and createdAt on edit, and sets formula only for formula columns", () => {
    const original = schema.columns.find((c) => c.key === "total");
    if (!original) throw new Error("fixture");
    let d = createColumnDraft({ schema, registry, column: original });
    expect(d.mode).toBe("edit");
    d = columnDraftReducer(d, { type: "setLabel", label: "Grand total" });
    d = columnDraftReducer(d, { type: "setFormula", formula: "{amount} * 3" });
    const col = buildColumnDef(d, { schema, registry, now, generateId: () => "nope" });
    expect(col).toMatchObject({ id: original.id, key: "total", order: original.order, createdAt: original.createdAt, updatedAt: now });
    expect(col.formula).toBe("{amount} * 3");
    expect(col.config).toEqual({ resultType: "number" });
    expect(col.label).toBe("Grand total");
  });

  it("validates label, key and config", () => {
    let d = createColumnDraft({ schema, registry });
    d = columnDraftReducer(d, { type: "setType", fieldType: "text", registry });
    expect(validateColumnDraft(d, { schema, registry }).label).toBeTruthy();
    d = columnDraftReducer(d, { type: "setLabel", label: "Ok" });
    d = columnDraftReducer(d, { type: "setKey", key: "amount" });
    expect(validateColumnDraft(d, { schema, registry }).key).toMatch(/already/);
    d = columnDraftReducer(d, { type: "setKey", key: "9bad" });
    expect(validateColumnDraft(d, { schema, registry }).key).toBeTruthy();
    d = columnDraftReducer(d, { type: "setKey", key: "ok_key" });
    expect(validateColumnDraft(d, { schema, registry })).toEqual({});
  });
});
