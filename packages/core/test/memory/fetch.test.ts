import { describe, expect, it } from "vitest";
import type { FilterNode } from "../../src/filter/types";
import { createInMemoryDataSource } from "../../src/memory/data-source";
import { InMemoryQueryError } from "../../src/memory/types";
import type { GridQuery } from "../../src/query/types";
import type { GridRow } from "../../src/rows/types";
import type { GridSchema } from "../../src/schema/types";
import { createFixtureRows } from "../../src/testing/rows";
import {
  createFixtureSchema,
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_USERS,
} from "../../src/testing/schema";

const q = (over: Partial<GridQuery> = {}): GridQuery => ({
  filter: null,
  sort: [],
  page: { offset: 0, limit: 100 },
  ...over,
});
const ids = (rows: GridRow[]) => rows.map((r) => r.id);

function makeSource(opts: { user?: keyof typeof FIXTURE_USERS; now?: string; tz?: string; schema?: GridSchema; rows?: GridRow[] } = {}) {
  return createInMemoryDataSource({
    schema: opts.schema ?? createFixtureSchema(),
    rows: opts.rows ?? createFixtureRows(),
    now: () => new Date(opts.now ?? FIXTURE_NOW),
    timeZone: opts.tz ?? FIXTURE_TIME_ZONE,
    ...(opts.user ? { user: { ...FIXTURE_USERS[opts.user], roles: [...FIXTURE_USERS[opts.user].roles] } } : {}),
  });
}

const spec8: FilterNode = {
  op: "and",
  children: [
    { columnId: C.status, operator: "isNot", value: "paid" },
    { columnId: C.callDate, operator: "isWithin", value: { relative: "yesterday" } },
  ],
};

describe("in-memory fetch", () => {
  it("returns all rows sorted by id with no hidden cells", async () => {
    const res = await makeSource({ user: "counsellor" }).fetch(q());
    expect(ids(res.rows)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    for (const row of res.rows) expect(row.cells).not.toHaveProperty("notes");
    const admin = await makeSource({ user: "admin" }).fetch(q());
    expect(admin.rows[0]?.cells.notes).toBe("VIP applicant");
  });

  it("applies the spec §8 filter: empty status is included, Paid excluded", async () => {
    const res = await makeSource().fetch(q({ filter: spec8 }));
    expect(ids(res.rows)).toEqual(["r2", "r3"]);
  });

  it("rejects a filter on an unreadable column", async () => {
    const p = makeSource({ user: "counsellor" }).fetch(
      q({ filter: { columnId: C.notes, operator: "contains", value: "vip" } }),
    );
    await expect(p).rejects.toBeInstanceOf(InMemoryQueryError);
    await expect(p).rejects.toMatchObject({ code: "unreadableColumn" });
  });

  it("rejects sort on an unreadable column", async () => {
    await expect(
      makeSource({ user: "counsellor" }).fetch(q({ sort: [{ columnId: C.notes, dir: "asc" }] })),
    ).rejects.toMatchObject({ code: "unreadableColumn" });
  });

  it("sorts by fee desc then name asc, with empty fee last in both directions", async () => {
    const ds = makeSource();
    const desc = await ds.fetch(q({ sort: [{ columnId: C.fee, dir: "desc" }, { columnId: C.name, dir: "asc" }] }));
    expect(ids(desc.rows)).toEqual(["r5", "r2", "r1", "r3", "r4"]);
    const asc = await ds.fetch(q({ sort: [{ columnId: C.fee, dir: "asc" }] }));
    expect(ids(asc.rows)).toEqual(["r3", "r1", "r2", "r5", "r4"]);
  });

  it("sorts by the materialised balance formula", async () => {
    const res = await makeSource().fetch(q({ sort: [{ columnId: C.balance, dir: "asc" }] }));
    expect(ids(res.rows)).toEqual(["r2", "r4", "r1", "r3", "r5"]);
    expect(res.rows.map((r) => r.cells.balance)).toEqual([0, 0, 30000, 45000, 60000]);
  });

  it("searches formatted readable cells, including select labels, but not hidden columns", async () => {
    const schema = createFixtureSchema();
    const stage = schema.columns.find((c) => c.id === C.stage);
    if (!stage) throw new Error("fixture");
    stage.config = { options: [{ id: "lead", label: "Ashapura Campus" }, { id: "applied", label: "Applied" }] };
    const rows = createFixtureRows().map((r) => (r.id === "r4" || r.id === "r2" ? { ...r, cells: { ...r.cells, stage: r.id === "r4" ? "lead" : "applied" } } : r));
    const r5 = rows.find((r) => r.id === "r5");
    if (r5) r5.cells.notes = "call asha later";
    const res = await makeSource({ user: "counsellor", schema, rows }).fetch(q({ search: "asha" }));
    expect(ids(res.rows)).toEqual(["r1", "r4"]);
  });

  it("pages by offset and reports the filtered total", async () => {
    const res = await makeSource().fetch(q({ page: { offset: 2, limit: 2 }, includeTotal: true }));
    expect(ids(res.rows)).toEqual(["r3", "r4"]);
    expect(res.total).toBe(5);
    const filtered = await makeSource().fetch(q({ filter: spec8, page: { offset: 0, limit: 1 }, includeTotal: true }));
    expect(filtered.total).toBe(2);
    const noTotal = await makeSource().fetch(q());
    expect(noTotal.total).toBeUndefined();
  });

  it("walks all pages by cursor without duplicates", async () => {
    const ds = makeSource();
    const seen: string[] = [];
    let res = await ds.fetch(q({ page: { offset: 0, limit: 2 } }));
    seen.push(...ids(res.rows));
    while (res.nextCursor) {
      res = await ds.fetch(q({ page: { cursor: res.nextCursor, limit: 2 } }));
      seen.push(...ids(res.rows));
    }
    expect(seen).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(res.nextCursor).toBeUndefined();
    await expect(ds.fetch(q({ page: { cursor: "garbage", limit: 2 } }))).rejects.toMatchObject({
      code: "invalidCursor",
    });
  });

  it("returns copies that do not alias the store", async () => {
    const ds = makeSource();
    const first = await ds.fetch(q());
    const row = first.rows[0];
    if (!row) throw new Error("no rows");
    row.cells.name = "Mutated";
    (row.cells.tags as string[]).push("vip");
    const again = await ds.fetch(q());
    expect(again.rows[0]?.cells.name).toBe("Asha Verma");
    expect(again.rows[0]?.cells.tags).toEqual(["scholar"]);
  });

  it("resolves relative dates with the injected now and time zone", async () => {
    const yesterday: FilterNode = { columnId: C.callDate, operator: "isWithin", value: { relative: "yesterday" } };
    const shifted = await makeSource({ now: "2026-09-20T21:00:00.000Z" }).fetch(q({ filter: yesterday }));
    expect(ids(shifted.rows)).toEqual(["r4"]);
    const utc = await makeSource({ tz: "UTC" }).fetch(
      q({ filter: { columnId: C.calledAt, operator: "isWithin", value: { relative: "yesterday" } } }),
    );
    expect(ids(utc.rows)).toEqual(["r3"]);
  });
});
