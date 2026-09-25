import { describe, expect, it } from "vitest";
import { createInMemoryDataSource } from "../../src/memory/data-source";
import type { ChangeBatch } from "../../src/rows/types";
import { createFixtureLinkTargets, createFixtureRows } from "../../src/testing/rows";
import {
  createFixtureSchema,
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_USERS,
} from "../../src/testing/schema";

function source(user: keyof typeof FIXTURE_USERS = "admin") {
  return createInMemoryDataSource({
    schema: createFixtureSchema(),
    rows: createFixtureRows(),
    now: () => new Date(FIXTURE_NOW),
    user: { id: FIXTURE_USERS[user].id, roles: [...FIXTURE_USERS[user].roles] },
    linkTargets: createFixtureLinkTargets(),
  });
}
async function edit(ds: ReturnType<typeof source>, rowId: string, columnId: string, next: unknown) {
  const row = ds.snapshot().find((r) => r.id === rowId);
  const b: ChangeBatch = {
    id: `b-${rowId}-${String(next)}`,
    changes: [{ rowId, columnId, prev: null, next }],
    baseVersions: { [rowId]: row?.version ?? 0 },
    source: "edit",
  };
  const res = await ds.applyChanges(b);
  expect(res.applied).toHaveLength(1);
}

describe("in-memory change feed", () => {
  it("returns edited rows once in their latest state plus deleted ids", async () => {
    const ds = source();
    await edit(ds, "r1", C.name, "First");
    await edit(ds, "r1", C.name, "Second");
    await edit(ds, "r2", C.paid, 1);
    await ds.deleteRows(["r3"]);
    const feed = await ds.getChanges?.("0");
    expect(feed?.rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(feed?.rows[0]?.cells.name).toBe("Second");
    expect(feed?.rows[0]?.version).toBe(3);
    expect(feed?.deletedRowIds).toEqual(["r3"]);
    expect(typeof feed?.cursor).toBe("string");
  });

  it("returns nothing new when polled again without activity", async () => {
    const ds = source();
    await edit(ds, "r1", C.name, "x");
    const first = await ds.getChanges?.("");
    const second = await ds.getChanges?.(first?.cursor ?? "");
    expect(second).toEqual({ cursor: first?.cursor, rows: [], deletedRowIds: [], schemaVersion: 1 });
  });

  it("reports changes made between polls exactly once", async () => {
    const ds = source();
    const start = await ds.getChanges?.("0");
    await edit(ds, "r4", C.name, "Between");
    const next = await ds.getChanges?.(start?.cursor ?? "");
    expect(next?.rows.map((r) => r.id)).toEqual(["r4"]);
    const after = await ds.getChanges?.(next?.cursor ?? "");
    expect(after?.rows).toEqual([]);
  });

  it("lists a row created and deleted in the window only as deleted", async () => {
    const ds = source();
    const [created] = await ds.createRows([{ cells: { name: "Temp" } }]);
    await ds.deleteRows([created?.id ?? ""]);
    const feed = await ds.getChanges?.("0");
    expect(feed?.rows).toEqual([]);
    expect(feed?.deletedRowIds).toEqual([created?.id]);
  });

  it("does not expose hidden cells", async () => {
    const ds = source("counsellor");
    await edit(ds, "r1", C.name, "x");
    const feed = await ds.getChanges?.("0");
    expect(feed?.rows[0]?.cells).not.toHaveProperty("notes");
    expect(feed?.rows[0]?.cells.balance).toBe(30000);
  });

  it("reflects setSchema in schemaVersion", async () => {
    const ds = source();
    const before = await ds.getChanges?.("0");
    ds.setSchema({ ...ds.getSchema(), schemaVersion: 2 });
    const after = await ds.getChanges?.(before?.cursor ?? "");
    expect(after?.schemaVersion).toBe(2);
    expect(after?.cursor).not.toBe(before?.cursor);
  });

  it("rejects an invalid cursor", async () => {
    const ds = source();
    await expect(ds.getChanges?.("abc")).rejects.toMatchObject({ code: "invalidCursor" });
    await expect(ds.getChanges?.("999")).rejects.toMatchObject({ code: "invalidCursor" });
  });
});

describe("in-memory options and lookup", () => {
  it("filters options by label", async () => {
    const options = await source().getOptions?.(C.status, "pa");
    expect(options?.map((o) => o.label)).toEqual(["Paid", "Partial"]);
  });

  it("creates options on creatableSelect and shows them in the schema", async () => {
    const ds = source();
    const option = await ds.createOption?.(C.stage, "Enrolled");
    expect(option?.label).toBe("Enrolled");
    const stage = ds.getSchema().columns.find((c) => c.id === C.stage);
    expect((stage?.config as { options: { id: string }[] }).options.map((o) => o.id)).toContain(option?.id);
    const feed = await ds.getChanges?.("0");
    expect(feed?.schemaVersion).toBe(2);
  });

  it("creates options on multiSelect with allowCreate", async () => {
    const option = await source().createOption?.(C.tags, "Alumni");
    expect(option?.label).toBe("Alumni");
  });

  it("rejects createOption on a plain select", async () => {
    await expect(source().createOption?.(C.status, "Refunded")).rejects.toThrow();
  });

  it("returns the existing option for a duplicate label", async () => {
    const option = await source().createOption?.(C.stage, "  lead ");
    expect(option?.id).toBe("lead");
  });

  it("filters link targets by label", async () => {
    const refs = await source().lookup?.(C.programs, "data");
    expect(refs).toEqual([{ id: "p2", label: "Data Analytics" }]);
  });
});
