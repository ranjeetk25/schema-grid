import { describe, expect, it } from "vitest";
import { type ColumnDef, createDefaultRegistry } from "../../../src/internal/core";
import { hydrateRow } from "../../../src/storage/hydrate";

const col = (id: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef => ({
  id,
  key: id,
  label: id,
  type,
  config: {},
  order: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const schema = {
  id: "g",
  schemaVersion: 1,
  columns: [col("callDate", "date"), col("email", "email", { source: { valueField: "email_addr" } }), col("fee", "number")],
};

describe("hydrateRow", () => {
  it("deserializes cells, merges physical columns, leaves missing keys absent", () => {
    const row = hydrateRow(
      {
        id: "r1",
        version: 3,
        updatedAt: new Date("2026-09-24T10:00:00.000Z"),
        updatedBy: "u1",
        cells: { callDate: "2026-09-24" },
        email_addr: "a@b.co",
      },
      schema,
      createDefaultRegistry(),
    );
    expect(row).toEqual({
      id: "r1",
      version: 3,
      updatedAt: "2026-09-24T10:00:00.000Z",
      updatedBy: { id: "u1" },
      cells: { callDate: "2026-09-24", email: "a@b.co" },
    });
    expect("fee" in row.cells).toBe(false);
  });

  it("accepts JSON-string cells and MySQL datetime strings; treats JSON null as absent", () => {
    const row = hydrateRow(
      { id: "r1", version: 1, updatedAt: "2026-09-24 10:00:00.000", cells: '{"fee":12,"callDate":null}' },
      schema,
      createDefaultRegistry(),
    );
    expect(row.updatedAt).toBe("2026-09-24T10:00:00.000Z");
    expect(row.cells).toEqual({ fee: 12 });
    expect(row.updatedBy).toBeUndefined();
  });
});
