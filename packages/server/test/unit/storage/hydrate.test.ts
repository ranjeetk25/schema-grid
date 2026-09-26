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

describe("naive date / datetime driver values (v0.3 #9)", () => {
  it("dateOnlyFromDriver: the DATE column's own day whichever midnight the driver used", async () => {
    const { dateOnlyFromDriver } = await import("../../../src/storage/hydrate");
    // mysql2 `timezone: "Z"`: DATE '2026-09-24' → 00:00Z
    expect(dateOnlyFromDriver(new Date("2026-09-24T00:00:00.000Z"))).toBe("2026-09-24");
    // mysql2 default (local zone): local midnight of the 24th, whatever the process zone is.
    expect(dateOnlyFromDriver(new Date(2026, 8, 24))).toBe("2026-09-24");
    expect(dateOnlyFromDriver("2026-09-24")).toBe("2026-09-24");
    expect(dateOnlyFromDriver("2026-09-24 00:00:00")).toBe("2026-09-24");
    expect(dateOnlyFromDriver(null)).toBeNull();
    expect(dateOnlyFromDriver("nope")).toBeNull();
  });

  it("naiveDatetimeToIso: wall time in the given zone → UTC ISO; instants pass through", async () => {
    const { naiveDatetimeToIso } = await import("../../../src/storage/hydrate");
    expect(naiveDatetimeToIso("2026-09-24 10:30:00", "Asia/Kolkata")).toBe("2026-09-24T05:00:00.000Z");
    expect(naiveDatetimeToIso("2026-09-24 10:30:00.250000", "Asia/Kolkata")).toBe("2026-09-24T05:00:00.250Z");
    expect(naiveDatetimeToIso("2026-09-24 10:30:00", "UTC")).toBe("2026-09-24T10:30:00.000Z");
    // A `Date` from a `timezone: "Z"` pool carries the wall time in its UTC fields.
    expect(naiveDatetimeToIso(new Date("2026-09-24T10:30:00.000Z"), "Asia/Kolkata")).toBe("2026-09-24T05:00:00.000Z");
    expect(naiveDatetimeToIso(new Date("2026-09-24T10:30:00.000Z"), "UTC")).toBe("2026-09-24T10:30:00.000Z");
    expect(naiveDatetimeToIso("2026-09-24T10:30:00+05:30", "UTC")).toBe("2026-09-24T05:00:00.000Z");
    expect(naiveDatetimeToIso(null, "UTC")).toBeNull();
  });

  it("isoToNaiveDatetime: UTC ISO → the zone's wall time, DATETIME(3) literal shape", async () => {
    const { isoToNaiveDatetime } = await import("../../../src/storage/hydrate");
    expect(isoToNaiveDatetime("2026-09-24T05:00:00.000Z", "Asia/Kolkata")).toBe("2026-09-24 10:30:00.000");
    expect(isoToNaiveDatetime("2026-09-24T05:00:00.250Z", "UTC")).toBe("2026-09-24 05:00:00.250");
    expect(isoToNaiveDatetime("2026-09-23T19:00:00.000Z", "Asia/Kolkata")).toBe("2026-09-24 00:30:00.000");
  });

  it("hydrateRow: physical date/datetime columns honour the driver shape and naiveDatetimeZone", () => {
    const registry = createDefaultRegistry();
    const s = {
      id: "g",
      schemaVersion: 1,
      columns: [col("d", "date", { source: { valueField: "d_col" } }), col("t", "datetime", { source: { valueField: "t_col" } })],
    };
    const base = { id: "r1", version: 1, updatedAt: "2026-09-24 10:00:00.000", cells: {} };
    // Local-midnight Date (default mysql2 zone) keeps its day; the naive DATETIME string is read in the zone.
    const ist = hydrateRow({ ...base, d_col: new Date(2026, 8, 24), t_col: "2026-09-24 10:30:00" }, s, registry, {
      naiveDatetimeZone: "Asia/Kolkata",
    });
    expect(ist.cells).toEqual({ d: "2026-09-24", t: "2026-09-24T05:00:00.000Z" });
    // Default zone is UTC (what physicalWriteValue stores).
    const utc = hydrateRow({ ...base, d_col: new Date("2026-09-24T00:00:00.000Z"), t_col: new Date("2026-09-24T10:30:00.000Z") }, s, registry);
    expect(utc.cells).toEqual({ d: "2026-09-24", t: "2026-09-24T10:30:00.000Z" });
  });
});
