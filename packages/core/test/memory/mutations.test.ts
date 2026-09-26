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

describe("in-memory applyChanges: option rules and meta (v0.3)", () => {
  const restrict = (schema: ReturnType<typeof createFixtureSchema>) => {
    const status = schema.columns.find((c) => c.id === C.status);
    const tags = schema.columns.find((c) => c.id === C.tags);
    if (!status || !tags) throw new Error("fixture columns");
    status.config = {
      options: [
        { id: "paid", label: "Paid", settableBy: { roles: ["admin"] } },
        { id: "pending", label: "Pending" },
        { id: "partial", label: "Partial" },
      ],
    };
    tags.config = {
      options: [
        { id: "scholar", label: "Scholarship" },
        { id: "referral", label: "Referral" },
        { id: "vip", label: "VIP", settableBy: { roles: ["admin"] } },
      ],
      allowCreate: true,
    };
  };

  it("rejects an option the user cannot set, with the option message", async () => {
    const ds = source("counsellor", restrict);
    const res = await ds.applyChanges(batch([change("r2", C.status, "paid")], { r2: 1 }));
    expect(res.applied).toEqual([]);
    expect(res.errors).toEqual([{ rowId: "r2", columnId: C.status, message: "Option “Paid” can only be set by Admin" }]);
  });

  it("lets an allowed role set it and keeps existing restricted values on other edits", async () => {
    const admin = source("admin", restrict);
    expect((await admin.applyChanges(batch([change("r2", C.status, "paid")], { r2: 1 }))).applied).toHaveLength(1);

    const ds = source("counsellor", restrict);
    const before = await row(ds, "r1");
    const tags = (before?.cells.tags as string[] | undefined) ?? [];
    const res = await ds.applyChanges(batch([change("r1", C.tags, [...tags, "vip"])], { r1: 1 }));
    expect(res.errors[0]?.message).toBe("Option “VIP” can only be set by Admin");
    // A row already holding "vip" may gain another tag without re-checking "vip".
    await admin.applyChanges(batch([change("r1", C.tags, ["vip"])], { r1: 1 }));
    const other = createInMemoryDataSource({
      schema: admin.getSchema(),
      rows: admin.snapshot(),
      user: { id: FIXTURE_USERS.counsellor.id, roles: [...FIXTURE_USERS.counsellor.roles] },
    });
    const keep = await other.applyChanges(batch([change("r1", C.tags, ["vip", "referral"])], { r1: 2 }));
    expect(keep.errors).toEqual([]);
    expect(keep.applied[0]?.next).toEqual(["vip", "referral"]);
  });

  it("echoes change meta on applied and conflict entries and ignores batch meta", async () => {
    const ds = source();
    const ok = await ds.applyChanges({
      ...batch([{ rowId: "r1", columnId: C.name, prev: null, next: "Meta", meta: { decisionMessage: "why" } }], { r1: 1 }),
      meta: { reuploadDeadline: "2026-10-01" },
    });
    expect(ok.applied[0]).toMatchObject({ next: "Meta", meta: { decisionMessage: "why" } });
    const stale = await ds.applyChanges(
      batch([{ rowId: "r1", columnId: C.name, prev: null, next: "Stale", meta: { decisionMessage: "again" } }], { r1: 1 }),
    );
    expect(stale.conflicts[0]).toMatchObject({ rowId: "r1", meta: { decisionMessage: "again" } });
  });
});
