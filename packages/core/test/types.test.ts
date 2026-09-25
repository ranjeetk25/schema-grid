import { describe, expect, expectTypeOf, it } from "vitest";
import {
  BUILTIN_FIELD_TYPE_IDS,
  type ColumnDef,
  type FieldTypeId,
  type FilterValue,
  type GridRow,
  type PageRequest,
  type QueryResult,
} from "../src/index";

describe("foundation types", () => {
  it("has the 16 built-in field type ids in spec order", () => {
    expect(BUILTIN_FIELD_TYPE_IDS).toEqual([
      "text",
      "longText",
      "number",
      "currency",
      "boolean",
      "date",
      "datetime",
      "select",
      "multiSelect",
      "creatableSelect",
      "user",
      "url",
      "email",
      "phone",
      "link",
      "formula",
    ]);
    expect(BUILTIN_FIELD_TYPE_IDS).toHaveLength(16);
  });

  it("FieldTypeId accepts built-in and custom strings", () => {
    expectTypeOf<"text">().toMatchTypeOf<FieldTypeId>();
    const custom: FieldTypeId = "rating";
    expect(custom).toBe("rating");
  });

  it("FilterValue accepts all documented shapes", () => {
    const values: FilterValue[] = [
      "a",
      1,
      true,
      null,
      ["a", "b"],
      { from: 1, to: 2 },
      { relative: "lastNDays", n: 7 },
      { me: true },
    ];
    expect(values).toHaveLength(8);
    // @ts-expect-error me must be true
    const bad: FilterValue = { me: false };
    expect(bad).toBeDefined();
  });

  it("PageRequest rejects offset + cursor together", () => {
    const a: PageRequest = { offset: 0, limit: 10 };
    const b: PageRequest = { cursor: "x", limit: 10 };
    // @ts-expect-error both offset and cursor
    const c: PageRequest = { offset: 0, cursor: "x", limit: 10 };
    expect([a, b, c]).toHaveLength(3);
  });

  it("QueryResult is generic over GridRow", () => {
    interface MyRow extends GridRow {
      extra: string;
    }
    expectTypeOf<QueryResult<MyRow>["rows"]>().toEqualTypeOf<MyRow[]>();
    // @ts-expect-error not a GridRow
    type Bad = QueryResult<{ foo: string }>;
    expectTypeOf<Bad>().not.toBeNever();
  });

  it("ColumnDef formula is optional string and pinned accepts null", () => {
    expectTypeOf<ColumnDef["formula"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<null>().toMatchTypeOf<ColumnDef["pinned"]>();
  });
});
