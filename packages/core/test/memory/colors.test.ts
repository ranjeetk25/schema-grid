import { describe, expect, it } from "vitest";
import type { CellColorChange, ColorRule } from "../../src/colors/types";
import { createInMemoryDataSource } from "../../src/memory/data-source";
import type { GridQuery } from "../../src/query/types";
import type { GridRow } from "../../src/rows/types";
import { createFixtureRows } from "../../src/testing/rows";
import { createFixtureSchema, FIXTURE_COLUMN_IDS as C, FIXTURE_NOW, FIXTURE_USERS } from "../../src/testing/schema";

function source(user: keyof typeof FIXTURE_USERS | null = "admin", rows: GridRow[] = createFixtureRows()) {
  return createInMemoryDataSource({
    schema: createFixtureSchema(),
    rows,
    now: () => new Date(FIXTURE_NOW),
    ...(user ? { user: { id: FIXTURE_USERS[user].id, roles: [...FIXTURE_USERS[user].roles] } } : {}),
  });
}
const q = (over: Partial<GridQuery> = {}): GridQuery => ({ filter: null, sort: [], page: { offset: 0, limit: 100 }, ...over });
const paint = (rowId: string, columnId: string, color: CellColorChange["color"]): CellColorChange => ({
  rowId,
  columnId,
  color,
});
async function byId(ds: ReturnType<typeof source>, id: string) {
  return (await ds.fetch(q())).rows.find((r) => r.id === id);
}
const ids = (rows: GridRow[]) => rows.map((r) => r.id);

describe("in-memory cell colors", () => {
  it("reports cellColors capabilities all true", async () => {
    expect((await source().capabilities?.())?.cellColors).toEqual({ read: true, write: true, filter: true });
  });

  it("rows carry no colors until painted", async () => {
    const rows = (await source().fetch(q())).rows;
    expect(rows.every((r) => r.colors === undefined)).toBe(true);
  });

  it("setCellColors stores colors without bumping version / updatedAt and clears with null", async () => {
    const ds = source();
    const before = await byId(ds, "r1");
    const res = await ds.setCellColors?.({ id: "p1", changes: [paint("r1", C.name, "red"), paint("r1", C.fee, "blue")] });
    expect(res?.applied).toEqual([paint("r1", C.name, "red"), paint("r1", C.fee, "blue")]);
    expect(res?.rejected).toEqual([]);
    expect(res?.rows?.map((r) => [r.id, r.colors])).toEqual([["r1", { [C.name]: "red", [C.fee]: "blue" }]]);
    const after = await byId(ds, "r1");
    expect(after?.colors).toEqual({ [C.name]: "red", [C.fee]: "blue" });
    expect(after?.version).toBe(before?.version);
    expect(after?.updatedAt).toBe(before?.updatedAt);

    await ds.setCellColors?.({ id: "p2", changes: [paint("r1", C.name, "green"), paint("r1", C.fee, null)] });
    expect((await byId(ds, "r1"))?.colors).toEqual({ [C.name]: "green" });
    await ds.setCellColors?.({ id: "p3", changes: [paint("r1", C.name, null)] });
    expect((await byId(ds, "r1"))?.colors).toBeUndefined();
  });

  it("colors survive data edits and do not conflict with them", async () => {
    const ds = source();
    await ds.setCellColors?.({ id: "p", changes: [paint("r1", C.name, "red")] });
    const res = await ds.applyChanges({
      id: "b",
      changes: [{ rowId: "r1", columnId: C.name, prev: null, next: "X" }],
      baseVersions: { r1: 1 },
      source: "edit",
    });
    expect(res.conflicts).toEqual([]);
    expect(res.rows?.[0]?.colors).toEqual({ [C.name]: "red" });
  });

  it("rejects cells the user cannot edit, unknown rows / columns and invalid colors", async () => {
    const ds = source("counsellor");
    const res = await ds.setCellColors?.({
      id: "p",
      changes: [
        paint("r1", C.name, "red"),
        paint("r1", C.fee, "red"), // read-only for the counsellor
        paint("r1", C.notes, "red"), // hidden
        paint("r1", C.balance, "red"), // formula
        paint("nope", C.name, "red"),
        paint("r1", "col_nope", "red"),
        paint("r1", C.paid, "magenta" as never),
      ],
    });
    expect(res?.applied).toEqual([paint("r1", C.name, "red")]);
    expect(res?.rejected).toEqual([
      { rowId: "r1", columnId: C.fee, message: "Read-only" },
      { rowId: "r1", columnId: C.notes, message: "Column not found" },
      { rowId: "r1", columnId: C.balance, message: "Read-only" },
      { rowId: "nope", columnId: C.name, message: "Row not found" },
      { rowId: "r1", columnId: "col_nope", message: "Column not found" },
      { rowId: "r1", columnId: C.paid, message: "Invalid color" },
    ]);
  });

  it("never returns colors of columns the user cannot read", async () => {
    const rows = createFixtureRows();
    rows[0] = { ...(rows[0] as GridRow), colors: { [C.notes]: "red", [C.name]: "blue" } };
    const counsellor = source("counsellor", rows);
    expect((await byId(counsellor, "r1"))?.colors).toEqual({ [C.name]: "blue" });
    expect((await counsellor.getRows(["r1"]))[0]?.colors).toEqual({ [C.name]: "blue" });
    const admin = source("admin", rows);
    expect((await byId(admin, "r1"))?.colors).toEqual({ [C.notes]: "red", [C.name]: "blue" });
  });

  it("drops invalid colors from initial rows", async () => {
    const rows = createFixtureRows();
    rows[0] = { ...(rows[0] as GridRow), colors: { [C.name]: "magenta" as never, [C.fee]: "teal" } };
    expect((await byId(source("admin", rows), "r1"))?.colors).toEqual({ [C.fee]: "teal" });
  });

  it("a color change puts the row in the next getChanges", async () => {
    const ds = source();
    const start = await ds.getChanges?.("");
    await ds.setCellColors?.({ id: "p", changes: [paint("r2", C.name, "purple"), paint("r2", C.paid, "pink")] });
    const feed = await ds.getChanges?.(start?.cursor ?? "");
    expect(ids(feed?.rows ?? [])).toEqual(["r2"]);
    expect(feed?.rows[0]?.colors).toEqual({ [C.name]: "purple", [C.paid]: "pink" });
    // A batch that applies nothing does not advance the feed.
    await ds.setCellColors?.({ id: "p", changes: [paint("nope", C.name, "red")] });
    expect((await ds.getChanges?.(feed?.cursor ?? ""))?.rows).toEqual([]);
  });

  it("filters colorIs / colorIsNone by the shown color using query.colorRules", async () => {
    const ds = source();
    await ds.setCellColors?.({ id: "p", changes: [paint("r2", C.status, "red")] });
    const rules: ColorRule[] = [
      { id: "a", color: "green", target: { kind: "cells", columnIds: [C.status] }, when: { columnId: C.status, operator: "is", value: "paid" } },
      { id: "b", color: "yellow", target: { kind: "row" }, when: { columnId: C.name, operator: "startsWith", value: "Dev" } },
    ];
    const green = await ds.fetch(q({ filter: { columnId: C.status, operator: "colorIs", value: ["green"] }, colorRules: rules }));
    expect(ids(green.rows)).toEqual(["r1", "r5"]);
    const red = await ds.fetch(q({ filter: { columnId: C.status, operator: "colorIs", value: ["red"] }, colorRules: rules }));
    expect(ids(red.rows)).toEqual(["r2"]);
    const yellow = await ds.fetch(q({ filter: { columnId: C.status, operator: "colorIs", value: ["yellow"] }, colorRules: rules }));
    expect(ids(yellow.rows)).toEqual(["r4"]);
    const none = await ds.fetch(q({ filter: { columnId: C.status, operator: "colorIsNone" }, colorRules: rules }));
    expect(ids(none.rows)).toEqual(["r3"]);
    // Without rules only manual colors count.
    expect(ids((await ds.fetch(q({ filter: { columnId: C.status, operator: "colorIs", value: ["green"] } }))).rows)).toEqual([]);
  });

  it("rejects invalid color rules only when the filter uses colors", async () => {
    const ds = source();
    const bad = [{ id: "x", color: "magenta" }] as unknown as ColorRule[];
    await expect(ds.fetch(q({ colorRules: bad }))).resolves.toBeDefined();
    await expect(
      ds.fetch(q({ filter: { columnId: C.name, operator: "colorIsNone" }, colorRules: bad })),
    ).rejects.toMatchObject({ name: "InMemoryQueryError", code: "invalidColorRule" });
  });

  it("rejects color rules that reference unreadable columns", async () => {
    const ds = source("counsellor");
    const rules: ColorRule[] = [
      { id: "a", color: "red", target: { kind: "row" }, when: { columnId: C.notes, operator: "isNotEmpty" } },
    ];
    await expect(
      ds.fetch(q({ filter: { columnId: C.name, operator: "colorIs", value: ["red"] }, colorRules: rules })),
    ).rejects.toMatchObject({ code: "unreadableColumn" });
  });

  it("filters colorIs on filterable:false columns", async () => {
    const base = createFixtureSchema();
    const schema = { ...base, columns: base.columns.map((c) => (c.id === C.website ? { ...c, filterable: false } : c)) };
    const ds = createInMemoryDataSource({ schema, rows: createFixtureRows(), now: () => new Date(FIXTURE_NOW) });
    await ds.setCellColors?.({ id: "p", changes: [paint("r3", C.website, "gray")] });
    const res = await ds.fetch(q({ filter: { columnId: C.website, operator: "colorIs", value: ["gray"] } }));
    expect(ids(res.rows)).toEqual(["r3"]);
  });
});
