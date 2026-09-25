import { describe, expect, it } from "vitest";
import { createInMemoryDataSource } from "../../src/memory/data-source";
import type { GridQuery } from "../../src/query/types";
import type { GridRow } from "../../src/rows/types";
import type { GridSchema } from "../../src/schema/types";
import { createFixtureRows } from "../../src/testing/rows";
import {
  createFixtureSchema,
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_USERS,
} from "../../src/testing/schema";

const all: GridQuery = { filter: null, sort: [], page: { offset: 0, limit: 100 } };
const TS = "2026-09-01T00:00:00.000Z";
const counsellor = { id: FIXTURE_USERS.counsellor.id, roles: [...FIXTURE_USERS.counsellor.roles] };

function withSchema(mutate: (s: GridSchema) => void, rows: GridRow[] = createFixtureRows(), user = counsellor) {
  const schema = createFixtureSchema();
  mutate(schema);
  return createInMemoryDataSource({ schema, rows, user, now: () => new Date(FIXTURE_NOW) });
}

describe("in-memory reference semantics (edge cases)", () => {
  it("hides formula columns that depend on hidden columns", async () => {
    const ds = withSchema((s) => {
      s.columns.push({
        id: "col_notesEcho",
        key: "notesEcho",
        label: "Notes echo",
        type: "formula",
        config: { resultType: "text" },
        formula: "CONCAT({notes})",
        order: 99,
        createdAt: TS,
        updatedAt: TS,
      });
    });
    const res = await ds.fetch({ ...all, search: "vip applicant" });
    expect(res.rows).toEqual([]);
    const rows = (await ds.fetch(all)).rows;
    expect(rows[0]?.cells).not.toHaveProperty("notesEcho");
    await expect(ds.fetch({ ...all, sort: [{ columnId: "col_notesEcho", dir: "asc" }] })).rejects.toMatchObject({
      code: "unreadableColumn",
    });
  });

  it("groups user values by id regardless of display name", async () => {
    const rows = createFixtureRows();
    const r4 = rows.find((r) => r.id === "r4");
    if (r4) r4.cells.owner = { id: "u1", name: "Anil A." };
    const ds = createInMemoryDataSource({ schema: createFixtureSchema(), rows, now: () => new Date(FIXTURE_NOW) });
    const res = await ds.fetch({ ...all, groupBy: [{ columnId: C.owner }] });
    expect(res.groups?.map((g) => g.count)).toEqual([2, 2, 1]);
  });

  it("breaks sort ties by plain code-unit id order", async () => {
    const rows = ["b", "B", "a10", "a2", "A1"].map((id) => ({ id, version: 1, updatedAt: TS, cells: {} }));
    const ds = createInMemoryDataSource({ schema: createFixtureSchema(), rows });
    expect((await ds.fetch(all)).rows.map((r) => r.id)).toEqual(["A1", "B", "a10", "a2", "b"]);
  });

  it("does not require or reveal hidden columns when creating rows", async () => {
    const ds = withSchema((s) => {
      const notes = s.columns.find((c) => c.id === C.notes);
      if (notes) notes.required = true;
    });
    const [row] = await ds.createRows([{ cells: { name: "Gita" } }]);
    expect(row?.cells).not.toHaveProperty("notes");
    await expect(ds.createRows([{ cells: { notes: "x" } }])).rejects.toThrow(/Column not found/);
  });

  it("reports an invalid value on a stale row as an error, not a conflict", async () => {
    const ds = createInMemoryDataSource({ schema: createFixtureSchema(), rows: createFixtureRows() });
    await ds.applyChanges({ id: "a", changes: [{ rowId: "r1", columnId: C.name, prev: null, next: "x" }], baseVersions: { r1: 1 }, source: "edit" });
    const res = await ds.applyChanges({ id: "b", changes: [{ rowId: "r1", columnId: C.paid, prev: null, next: "abc" }], baseVersions: { r1: 1 }, source: "edit" });
    expect(res.conflicts).toEqual([]);
    expect(res.errors).toHaveLength(1);
  });

  it("hidden formula columns look like missing columns on edit", async () => {
    const ds = withSchema((s) => {
      const balance = s.columns.find((c) => c.id === C.balance);
      if (balance) balance.permissions = { read: { roles: ["admin"] }, edit: "all" };
    });
    const res = await ds.applyChanges({ id: "a", changes: [{ rowId: "r1", columnId: C.balance, prev: null, next: 1 }], baseVersions: { r1: 1 }, source: "edit" });
    expect(res.errors[0]?.message).toBe("Column not found");
  });

  it("computes now-dependent formulas on every read, including snapshot", async () => {
    let now = new Date("2026-09-24T21:00:00.000Z");
    const schema = createFixtureSchema();
    schema.columns.push({
      id: "col_year",
      key: "year",
      label: "Year",
      type: "formula",
      config: { resultType: "number" },
      formula: "YEAR(TODAY())",
      order: 99,
      createdAt: TS,
      updatedAt: TS,
    });
    const ds = createInMemoryDataSource({ schema, rows: createFixtureRows(), now: () => now });
    expect(ds.snapshot()[0]?.cells.year).toBe(2026);
    now = new Date("2030-01-01T00:00:00.000Z");
    expect(ds.snapshot()[0]?.cells.year).toBe(2030);
    expect((await ds.fetch(all)).rows[0]?.cells.year).toBe(2030);
  });

  it("rejects duplicate initial row ids", () => {
    const rows = [...createFixtureRows(), ...createFixtureRows().slice(0, 1)];
    expect(() => createInMemoryDataSource({ schema: createFixtureSchema(), rows })).toThrow(/Duplicate/);
  });

  it("uses typed errors for option operations", async () => {
    const ds = withSchema(() => {});
    await expect(ds.createOption?.(C.status, "Refunded")).rejects.toMatchObject({ code: "unsupportedColumnType" });
    await expect(ds.lookup?.(C.status, "x")).rejects.toMatchObject({ code: "unsupportedColumnType" });
  });
});
