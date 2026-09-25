import { describe, expect, it } from "vitest";
import { mergeDeferred, planRemotePatch } from "../../src/sync/planRemotePatch";
import type { ChangeFeedEntry, ColumnDef, GridRow, GridSchema } from "../../src/internal/core";

const TS = "2026-01-01T00:00:00.000Z";

function col(id: string): ColumnDef {
  return {
    id,
    key: id,
    label: id,
    type: "text",
    config: {},
    order: 0,
    createdAt: TS,
    updatedAt: TS,
  };
}

const schema: GridSchema = {
  id: "s1",
  schemaVersion: 1,
  columns: [col("name"), col("stage")],
};

function row(id: string, cells: Record<string, unknown>, version: number): GridRow {
  return { id, version, updatedAt: TS, cells };
}

function makeRowStore(rows: GridRow[]): { getRow(id: string): GridRow | undefined } {
  const map = new Map(rows.map((r) => [r.id, r]));
  return { getRow: (id) => map.get(id) };
}

function feedEntry(
  rows: GridRow[],
  deletedRowIds: string[] = [],
  schemaVersion = 1,
): ChangeFeedEntry<GridRow> {
  return { cursor: "c1", rows, deletedRowIds, schemaVersion };
}

describe("planRemotePatch", () => {
  it("a newer version produces updates and changedCells", () => {
    const local = row("r1", { name: "A", stage: "new" }, 1);
    const remote = row("r1", { name: "A2", stage: "new" }, 2);

    const plan = planRemotePatch({
      entry: feedEntry([remote]),
      rowStore: makeRowStore([local]),
      schema,
      pendingCells: new Set<string>(),
      matchesView: () => true,
      currentSchemaVersion: 1,
    });

    expect(plan.updates).toEqual([remote]);
    expect(plan.changedCells).toEqual([{ rowId: "r1", columnId: "name" }]);
    expect(plan.deferred).toEqual([]);
    expect(plan.adds).toEqual([]);
    expect(plan.removes).toEqual([]);
    expect(plan.schemaChanged).toBe(false);
  });

  it("an older or equal version is ignored (our own echo)", () => {
    const local = row("r1", { name: "A" }, 3);
    const remoteOlder = row("r1", { name: "B" }, 2);
    const remoteEqual = row("r1", { name: "C" }, 3);

    const plan = planRemotePatch({
      entry: feedEntry([remoteOlder, remoteEqual]),
      rowStore: makeRowStore([local]),
      schema,
      pendingCells: new Set<string>(),
      matchesView: () => true,
      currentSchemaVersion: 1,
    });

    expect(plan.updates).toEqual([]);
    expect(plan.changedCells).toEqual([]);
    expect(plan.deferred).toEqual([]);
  });

  it("rows unknown locally become adds only when they match the view", () => {
    const remoteMatching = row("new1", { name: "X" }, 1);
    const remoteNotMatching = row("new2", { name: "Y" }, 1);

    const plan = planRemotePatch({
      entry: feedEntry([remoteMatching, remoteNotMatching]),
      rowStore: makeRowStore([]),
      schema,
      pendingCells: new Set<string>(),
      matchesView: (r) => r.id === "new1",
      currentSchemaVersion: 1,
    });

    expect(plan.adds).toEqual([remoteMatching]);
    expect(plan.updates).toEqual([]);
  });

  it("the editing cell becomes remoteChanged and its row is deferred, not updated", () => {
    const local = row("r1", { name: "A", stage: "new" }, 1);
    const remote = row("r1", { name: "A2", stage: "new" }, 2);

    const plan = planRemotePatch({
      entry: feedEntry([remote]),
      rowStore: makeRowStore([local]),
      schema,
      editingCell: { rowId: "r1", columnId: "name" },
      pendingCells: new Set<string>(),
      matchesView: () => true,
      currentSchemaVersion: 1,
    });

    expect(plan.updates).toEqual([]);
    expect(plan.deferred).toEqual([remote]);
    expect(plan.remoteChangedCells).toEqual([{ rowId: "r1", columnId: "name" }]);
    expect(plan.changedCells).toEqual([]);
  });

  it("a pending cell also defers the row (Set form)", () => {
    const local = row("r1", { name: "A" }, 1);
    const remote = row("r1", { name: "A2" }, 2);

    const plan = planRemotePatch({
      entry: feedEntry([remote]),
      rowStore: makeRowStore([local]),
      schema,
      pendingCells: new Set(["r1\u0000name"]),
      matchesView: () => true,
      currentSchemaVersion: 1,
    });

    expect(plan.deferred).toEqual([remote]);
    expect(plan.remoteChangedCells).toEqual([{ rowId: "r1", columnId: "name" }]);
  });

  it("a pending cell predicate function form also defers the row", () => {
    const local = row("r1", { name: "A" }, 1);
    const remote = row("r1", { name: "A2" }, 2);

    const plan = planRemotePatch({
      entry: feedEntry([remote]),
      rowStore: makeRowStore([local]),
      schema,
      pendingCells: (cell) => cell.rowId === "r1" && cell.columnId === "name",
      matchesView: () => true,
      currentSchemaVersion: 1,
    });

    expect(plan.deferred).toEqual([remote]);
    expect(plan.remoteChangedCells).toEqual([{ rowId: "r1", columnId: "name" }]);
  });

  it("an update that no longer matches the view is still applied but flagged notInView", () => {
    const local = row("r1", { name: "A" }, 1);
    const remote = row("r1", { name: "A2" }, 2);

    const plan = planRemotePatch({
      entry: feedEntry([remote]),
      rowStore: makeRowStore([local]),
      schema,
      pendingCells: new Set<string>(),
      matchesView: () => false,
      currentSchemaVersion: 1,
    });

    expect(plan.updates).toEqual([remote]);
    expect(plan.notInViewRowIds).toEqual(["r1"]);
  });

  it("deleted ids that exist locally are removed; unknown deleted ids are ignored", () => {
    const local = row("r1", {}, 1);

    const plan = planRemotePatch({
      entry: feedEntry([], ["r1", "unknown"]),
      rowStore: makeRowStore([local]),
      schema,
      pendingCells: new Set<string>(),
      matchesView: () => true,
      currentSchemaVersion: 1,
    });

    expect(plan.removes).toEqual(["r1"]);
  });

  it("schemaChanged is true when the feed's schemaVersion differs", () => {
    const plan = planRemotePatch({
      entry: feedEntry([], [], 2),
      rowStore: makeRowStore([]),
      schema,
      pendingCells: new Set<string>(),
      matchesView: () => true,
      currentSchemaVersion: 1,
    });

    expect(plan.schemaChanged).toBe(true);
  });

  it("uses deep-equal for array/object cells, so unchanged arrays aren't reported as changed", () => {
    const local = row("r1", { name: "A", stage: ["a", "b"] }, 1);
    const remote = row("r1", { name: "A", stage: ["a", "b"] }, 2);

    const plan = planRemotePatch({
      entry: feedEntry([remote]),
      rowStore: makeRowStore([local]),
      schema,
      pendingCells: new Set<string>(),
      matchesView: () => true,
      currentSchemaVersion: 1,
    });

    expect(plan.changedCells).toEqual([]);
    expect(plan.updates).toEqual([remote]);
  });

  it("schemaChanged and updates are independent: a schema bump doesn't suppress row updates", () => {
    const local = row("r1", { name: "A" }, 1);
    const remote = row("r1", { name: "A2" }, 2);

    const plan = planRemotePatch({
      entry: feedEntry([remote], [], 2),
      rowStore: makeRowStore([local]),
      schema,
      pendingCells: new Set<string>(),
      matchesView: () => true,
      currentSchemaVersion: 1,
    });

    expect(plan.schemaChanged).toBe(true);
    expect(plan.updates).toEqual([remote]);
    expect(plan.changedCells).toEqual([{ rowId: "r1", columnId: "name" }]);
  });
});

describe("mergeDeferred", () => {
  it("adds new rows and keeps the higher version on a repeat, without mutating the input map", () => {
    const r1v2 = row("r1", { name: "A2" }, 2);
    const existing = new Map([["r1", row("r1", { name: "A" }, 1)]]);

    const afterFirst = mergeDeferred(existing, [r1v2]);
    expect(afterFirst.get("r1")).toEqual(r1v2);
    expect(existing.get("r1")?.version).toBe(1); // input untouched

    const staleRetry = row("r1", { name: "A-stale" }, 1);
    const afterStale = mergeDeferred(afterFirst, [staleRetry]);
    expect(afterStale.get("r1")).toEqual(r1v2); // stale (lower version) is ignored

    const r2 = row("r2", { name: "B" }, 1);
    const afterAdd = mergeDeferred(afterStale, [r2]);
    expect(afterAdd.get("r2")).toEqual(r2);
    expect(afterAdd.get("r1")).toEqual(r1v2);
  });
});
