import { describe, expect, it } from "vitest";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureSchema } from "../test/fixtures";
import { isReadable, readableColumnIds, readableColumns, writableColumns } from "./access";

describe("access helpers", () => {
  const schema = buildFixtureSchema();
  const access = buildFixtureAccess(schema);
  it("excludes hidden and fails closed on missing entries", () => {
    expect(readableColumns(schema, access).map((c) => c.id)).not.toContain(FIXTURE_IDS.secret);
    expect(isReadable(new Map(), FIXTURE_IDS.payment)).toBe(false);
    expect(readableColumnIds(schema, access).has(FIXTURE_IDS.total)).toBe(true);
  });
  it("writable excludes formula and hidden", () => {
    const ids = writableColumns(schema, access).map((c) => c.id);
    expect(ids).not.toContain(FIXTURE_IDS.total);
    expect(ids).not.toContain(FIXTURE_IDS.secret);
    expect(ids).toContain(FIXTURE_IDS.payment);
  });
  it("writable excludes settable:false even when the access map says edit (v0.2 C1)", () => {
    const unsettable = {
      ...schema,
      columns: schema.columns.map((c) => (c.id === FIXTURE_IDS.notes ? { ...c, settable: false } : c)),
    };
    const ids = writableColumns(unsettable, access).map((c) => c.id);
    expect(access.get(FIXTURE_IDS.notes)).toBe("edit");
    expect(ids).not.toContain(FIXTURE_IDS.notes);
    expect(ids).toContain(FIXTURE_IDS.payment);
  });
});
