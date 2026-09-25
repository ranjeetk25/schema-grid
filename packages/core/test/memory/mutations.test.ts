import { describe, expect, it } from "vitest";
import { createInMemoryDataSource } from "../../src/memory/data-source";
import type { GridQuery } from "../../src/query/types";
import type { CellChange, ChangeBatch } from "../../src/rows/types";
import { createFixtureRows } from "../../src/testing/rows";
import {
  createFixtureSchema,
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_USERS,
} from "../../src/testing/schema";

const actor = { id: "u1", name: "Anil Admin" };
function source(user: keyof typeof FIXTURE_USERS = "admin", mutateSchema?: (s: ReturnType<typeof createFixtureSchema>) => void) {
  const schema = createFixtureSchema();
  mutateSchema?.(schema);
  let n = 0;
  return createInMemoryDataSource({
    schema,
    rows: createFixtureRows(),
    now: () => new Date(FIXTURE_NOW),
    user: { id: FIXTURE_USERS[user].id, roles: [...FIXTURE_USERS[user].roles] },
    actor,
    generateId: () => `new_${++n}`,
  });
}
const all: GridQuery = { filter: null, sort: [], page: { offset: 0, limit: 100 } };
const change = (rowId: string, columnId: string, next: unknown): CellChange => ({ rowId, columnId, prev: null, next });
const batch = (changes: CellChange[], baseVersions: Record<string, number>): ChangeBatch => ({
  id: "b1",
  changes,
  baseVersions,
  source: "edit",
});
async function row(ds: ReturnType<typeof source>, id: string) {
  return (await ds.fetch(all)).rows.find((r) => r.id === id);
}

describe("in-memory applyChanges", () => {
  it("applies a change on a matching base version and bumps the version", async () => {
    const ds = source();
    const res = await ds.applyChanges(batch([change("r1", C.name, "Asha V.")], { r1: 1 }));
    expect(res).toEqual({
      applied: [{ rowId: "r1", columnId: C.name, prev: "Asha Verma", next: "Asha V." }],
      conflicts: [],
      errors: [],
      versions: { r1: 2 },
    });
    const r1 = await row(ds, "r1");
    expect(r1?.version).toBe(2);
    expect(r1?.cells.name).toBe("Asha V.");
    expect(r1?.updatedBy).toEqual(actor);
    expect(r1?.updatedAt).toBe(FIXTURE_NOW);
  });

  it("turns a version mismatch into a conflict, not an error", async () => {
    const ds = source();
    await ds.applyChanges(batch([change("r1", C.name, "Server edit")], { r1: 1 }));
    const res = await ds.applyChanges(batch([change("r1", C.name, "Stale edit")], { r1: 1 }));
    expect(res.applied).toEqual([]);
    expect(res.errors).toEqual([]);
    expect(res.conflicts).toEqual([
      {
        rowId: "r1",
        columnId: C.name,
        serverValue: "Server edit",
        serverVersion: 2,
        updatedBy: actor,
        updatedAt: FIXTURE_NOW,
      },
    ]);
    expect((await row(ds, "r1"))?.cells.name).toBe("Server edit");
  });

  it("applies non-conflicting rows in a mixed batch", async () => {
    const ds = source();
    await ds.applyChanges(batch([change("r1", C.name, "Bumped")], { r1: 1 }));
    const res = await ds.applyChanges(
      batch([change("r1", C.name, "Stale"), change("r2", C.name, "Fresh")], { r1: 1, r2: 1 }),
    );
    expect(res.conflicts.map((c) => c.rowId)).toEqual(["r1"]);
    expect(res.applied.map((c) => c.rowId)).toEqual(["r2"]);
    // Only written rows report a new version.
    expect(res.versions).toEqual({ r2: 2 });
    expect((await row(ds, "r2"))?.cells.name).toBe("Fresh");
  });

  it("bumps the version exactly once for several changes on one row", async () => {
    const ds = source();
    const res = await ds.applyChanges(
      batch(
        [change("r1", C.name, "A"), change("r1", C.paid, 1), change("r1", C.isActive, false)],
        { r1: 1 },
      ),
    );
    expect(res.applied).toHaveLength(3);
    expect(res.versions).toEqual({ r1: 2 });
    expect((await row(ds, "r1"))?.version).toBe(2);
  });

  it("rejects edits to formula, read-only, unknown-row and invalid-value cells as errors", async () => {
    const ds = source("counsellor");
    const res = await ds.applyChanges(
      batch(
        [
          change("r1", C.balance, 1),
          change("r1", C.fee, 1),
          change("nope", C.name, "x"),
          change("r2", C.paid, "abc"),
          change("r3", C.name, "no base"),
        ],
        { r1: 1, r2: 1, nope: 1 },
      ),
    );
    expect(res.applied).toEqual([]);
    expect(res.conflicts).toEqual([]);
    const byCol = (rowId: string, columnId: string) =>
      res.errors.find((e) => e.rowId === rowId && e.columnId === columnId)?.message;
    expect(byCol("r1", C.balance)).toMatch(/read-only/);
    expect(byCol("r1", C.fee)).toMatch(/read-only/);
    expect(byCol("nope", C.name)).toMatch(/not found/i);
    expect(byCol("r2", C.paid)).toBeTruthy();
    expect(byCol("r3", C.name)).toMatch(/base version/);
    const r2 = await row(ds, "r2");
    expect(r2?.cells.paid).toBe(60000);
    expect(r2?.version).toBe(1);
  });

  it("recomputes formulas after an edit", async () => {
    const ds = source();
    await ds.applyChanges(batch([change("r1", C.fee, 55000)], { r1: 1 }));
    expect((await row(ds, "r1"))?.cells.balance).toBe(35000);
    expect(ds.snapshot().find((r) => r.id === "r1")?.cells.balance).toBe(35000);
  });
});

describe("in-memory createRows / deleteRows", () => {
  it("fills type and column defaults and assigns ids and version 1", async () => {
    const ds = source("admin", (s) => {
      const stage = s.columns.find((c) => c.id === C.stage);
      if (stage) stage.defaultValue = "lead";
    });
    const rows = await ds.createRows([{ cells: { name: "Farah", fee: 1000 } }, {}]);
    expect(rows.map((r) => r.id)).toEqual(["new_1", "new_2"]);
    const [first] = rows;
    expect(first?.version).toBe(1);
    expect(first?.cells).toMatchObject({
      name: "Farah",
      fee: 1000,
      isActive: false,
      tags: [],
      stage: "lead",
      balance: 1000,
    });
    expect((await ds.fetch(all)).rows).toHaveLength(7);
  });

  it("rejects invalid partials without inserting anything", async () => {
    const ds = source();
    await expect(ds.createRows([{ cells: { name: "ok" } }, { cells: { paid: "abc" } }])).rejects.toThrow();
    await expect(ds.createRows([{ cells: { balance: 1 } }])).rejects.toThrow(/read-only/);
    expect((await ds.fetch(all)).rows).toHaveLength(5);
  });

  it("deletes rows and ignores unknown ids", async () => {
    const ds = source();
    await ds.deleteRows(["r2", "missing"]);
    const ids = (await ds.fetch(all)).rows.map((r) => r.id);
    expect(ids).toEqual(["r1", "r3", "r4", "r5"]);
  });
});
