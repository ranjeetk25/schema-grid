import { describe, expect, it, vi } from "vitest";
import type { ChangeFeedEntry, ColumnDef, GridRow, GridSchema } from "../../src/internal/core";
import { createCellStatusStore } from "../../src/state/cellStatusStore";
import { createRowStore } from "../../src/state/rowStore";
import { applyDeferredRows, applyRemotePatch } from "../../src/sync/applyRemotePatch";
import { planRemotePatch, type RemotePatchPlan } from "../../src/sync/planRemotePatch";
import { createFakeGridApi } from "../fixtures/fakeGridApi";

const TS = "2026-01-01T00:00:00.000Z";

function col(id: string): ColumnDef {
  return { id, key: id, label: id, type: "text", config: {}, order: 0, createdAt: TS, updatedAt: TS };
}

const schema: GridSchema = { id: "s", schemaVersion: 1, columns: [col("name"), col("stage")] };

function row(id: string, cells: Record<string, unknown>, version: number): GridRow {
  return { id, version, updatedAt: TS, cells };
}

function entry(rows: GridRow[], deletedRowIds: string[] = [], schemaVersion = 1): ChangeFeedEntry<GridRow> {
  return { cursor: "c", rows, deletedRowIds, schemaVersion };
}

function emptyPlan(over: Partial<RemotePatchPlan<GridRow>> = {}): RemotePatchPlan<GridRow> {
  return {
    updates: [],
    adds: [],
    removes: [],
    changedCells: [],
    remoteChangedCells: [],
    deferred: [],
    notInViewRowIds: [],
    schemaChanged: false,
    ...over,
  };
}

function setup(local: GridRow[]) {
  const rows = createRowStore<GridRow>();
  rows.upsert(local);
  const cellStatus = createCellStatusStore();
  const fake = createFakeGridApi<GridRow>({ rows: local });
  return { stores: { rows, cellStatus }, fake };
}

describe("applyRemotePatch — client mode", () => {
  it("mutates the row store (upserts updates + adds, removes) and never calls applyTransaction", () => {
    const { stores, fake } = setup([row("a", { name: "A" }, 1), row("b", { name: "B" }, 1)]);
    const plan = emptyPlan({
      updates: [row("a", { name: "A2" }, 2)],
      adds: [row("c", { name: "C" }, 1)],
      removes: ["b"],
      changedCells: [{ rowId: "a", columnId: "name" }],
    });
    applyRemotePatch(fake.api, plan, "client", stores);
    expect(stores.rows.getRow("a")?.cells.name).toBe("A2");
    expect(stores.rows.getRow("c")).toBeDefined();
    expect(stores.rows.getRow("b")).toBeUndefined();
    expect(fake.spies.applyTransaction).not.toHaveBeenCalled();
  });

  it("flags notInView rows instead of removing them", () => {
    const { stores, fake } = setup([row("a", { name: "A" }, 1)]);
    const plan = emptyPlan({ updates: [row("a", { name: "gone" }, 2)], notInViewRowIds: ["a"] });
    applyRemotePatch(fake.api, plan, "client", stores);
    expect(stores.rows.getRow("a")?.cells.name).toBe("gone");
    expect(stores.rows.isNotInView("a")).toBe(true);
  });

  it("clears a stale notInView flag when an updated row matches the view again", () => {
    const { stores, fake } = setup([row("a", { name: "A" }, 1)]);
    stores.rows.setNotInView(["a"], true);
    applyRemotePatch(fake.api, emptyPlan({ updates: [row("a", { name: "back" }, 2)] }), "client", stores);
    expect(stores.rows.isNotInView("a")).toBe(false);
  });

  it("flashes exactly the changed cells, per row, after the grid update hook runs", () => {
    const { stores, fake } = setup([row("a", { name: "A", stage: "x" }, 1), row("b", { name: "B", stage: "y" }, 1)]);
    const plan = emptyPlan({
      updates: [row("a", { name: "A2", stage: "x" }, 2), row("b", { name: "B", stage: "z" }, 2)],
      changedCells: [
        { rowId: "a", columnId: "name" },
        { rowId: "b", columnId: "stage" },
      ],
    });
    let run: (() => void) | undefined;
    applyRemotePatch(fake.api, plan, "client", stores, { afterGridUpdate: (fn) => (run = fn) });
    expect(fake.spies.flashCells).not.toHaveBeenCalled();
    run?.();
    expect(fake.spies.flashCells).toHaveBeenCalledTimes(2);
    const calls = (fake.spies.flashCells as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as { rowNodes: { id: string }[]; columns: string[] },
    );
    expect(calls.map((c) => [c.rowNodes.map((n) => n.id), c.columns])).toEqual([
      [["a"], ["name"]],
      [["b"], ["stage"]],
    ]);
  });

  it("marks remoteChangedCells and keeps deferred rows (merged, last-write-wins) without applying them", () => {
    const { stores, fake } = setup([row("a", { name: "A" }, 1)]);
    const deferred = { current: new Map<string, GridRow>() };
    applyRemotePatch(
      fake.api,
      emptyPlan({ deferred: [row("a", { name: "theirs" }, 3)], remoteChangedCells: [{ rowId: "a", columnId: "name" }] }),
      "client",
      stores,
      { deferred },
    );
    applyRemotePatch(fake.api, emptyPlan({ deferred: [row("a", { name: "older" }, 2)] }), "client", stores, { deferred });
    expect(stores.cellStatus.get("a", "name").remoteChanged).toBe(true);
    expect(stores.rows.getRow("a")?.cells.name).toBe("A");
    expect(deferred.current.get("a")?.version).toBe(3);
  });

  it("emits onRemoteChanges(entry) and onSchemaChanged(version) when the schema changed", () => {
    const { stores, fake } = setup([]);
    const onRemoteChanges = vi.fn();
    const onSchemaChanged = vi.fn();
    const e = entry([], [], 4);
    applyRemotePatch(fake.api, emptyPlan({ schemaChanged: true }), "client", stores, {
      entry: e,
      events: { onRemoteChanges, onSchemaChanged },
    });
    expect(onRemoteChanges).toHaveBeenCalledWith(e);
    expect(onSchemaChanged).toHaveBeenCalledWith(4);
    applyRemotePatch(fake.api, emptyPlan(), "client", stores, { entry: e, events: { onRemoteChanges, onSchemaChanged } });
    expect(onSchemaChanged).toHaveBeenCalledTimes(1);
    expect(onRemoteChanges).toHaveBeenCalledTimes(2);
  });
});

describe("applyRemotePatch — server (infinite) mode", () => {
  it("setData on loaded nodes, upserts the row store, flashes immediately, no applyTransaction", () => {
    const { stores, fake } = setup([row("a", { name: "A" }, 1)]);
    const nodes: Record<string, { setData: ReturnType<typeof vi.fn>; id: string }> = {};
    (fake.spies.getRowNode as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      if (id !== "a") return undefined;
      nodes[id] ??= { id, setData: vi.fn() };
      return nodes[id];
    });
    const next = row("a", { name: "A2" }, 2);
    applyRemotePatch(
      fake.api,
      emptyPlan({
        updates: [next, row("zz", { name: "unloaded" }, 5)],
        changedCells: [{ rowId: "a", columnId: "name" }],
      }),
      "server",
      stores,
    );
    expect(nodes.a?.setData).toHaveBeenCalledWith(next);
    expect(stores.rows.getRow("a")?.cells.name).toBe("A2");
    expect(fake.spies.applyTransaction).not.toHaveBeenCalled();
    expect(fake.spies.flashCells).toHaveBeenCalledTimes(1);
  });

  it("removes deleted rows from the store and refreshes the infinite cache", () => {
    const { stores, fake } = setup([row("a", { name: "A" }, 1)]);
    applyRemotePatch(fake.api, emptyPlan({ removes: ["a"] }), "server", stores);
    expect(stores.rows.getRow("a")).toBeUndefined();
    expect(fake.spies.refreshInfiniteCache).toHaveBeenCalledTimes(1);
  });
});

describe("applyDeferredRows", () => {
  const ctx = (stores: ReturnType<typeof setup>["stores"]) => ({
    schema,
    matchesView: () => true,
    schemaVersion: 1,
    pendingCells: (c: { rowId: string; columnId: string }) => stores.cellStatus.get(c.rowId, c.columnId).pending,
  });

  it("applies a deferred row after editing stops, flashes it and clears its remote-changed mark", () => {
    const { stores, fake } = setup([row("a", { name: "A" }, 1)]);
    const deferred = { current: new Map<string, GridRow>() };
    const plan = planRemotePatch({
      entry: entry([row("a", { name: "theirs" }, 2)]),
      rowStore: stores.rows,
      schema,
      editingCell: { rowId: "a", columnId: "name" },
      pendingCells: new Set(),
      matchesView: () => true,
      currentSchemaVersion: 1,
    });
    applyRemotePatch(fake.api, plan, "client", stores, { deferred });
    expect(stores.rows.getRow("a")?.cells.name).toBe("A");

    // Still editing → stays deferred.
    applyDeferredRows(fake.api, "client", stores, { ...ctx(stores), deferred, editingCell: { rowId: "a", columnId: "name" } });
    expect(stores.rows.getRow("a")?.cells.name).toBe("A");
    expect(deferred.current.size).toBe(1);

    // Editing stopped → applied.
    applyDeferredRows(fake.api, "client", stores, { ...ctx(stores), deferred, editingCell: null });
    expect(stores.rows.getRow("a")?.cells.name).toBe("theirs");
    expect(deferred.current.size).toBe(0);
    expect(fake.spies.flashCells).toHaveBeenCalledTimes(1);
    expect(stores.cellStatus.get("a", "name").remoteChanged).toBe(false);
  });

  it("keeps a row deferred while its cell is pending, and drops it once local is newer", () => {
    const { stores, fake } = setup([row("a", { name: "A" }, 1)]);
    const deferred = { current: new Map<string, GridRow>([["a", row("a", { name: "theirs" }, 2)]]) };
    stores.cellStatus.setPending([{ rowId: "a", columnId: "name" }]);
    applyDeferredRows(fake.api, "client", stores, { ...ctx(stores), deferred, editingCell: null });
    expect(deferred.current.size).toBe(1);

    stores.cellStatus.clearPending([{ rowId: "a", columnId: "name" }]);
    stores.rows.upsert([row("a", { name: "mine" }, 3)]);
    applyDeferredRows(fake.api, "client", stores, { ...ctx(stores), deferred, editingCell: null });
    expect(deferred.current.size).toBe(0);
    expect(stores.rows.getRow("a")?.cells.name).toBe("mine");
  });

  it("never resurrects a deferred row that was removed locally", () => {
    const { stores, fake } = setup([]);
    const deferred = { current: new Map<string, GridRow>([["a", row("a", { name: "theirs" }, 2)]]) };
    applyDeferredRows(fake.api, "client", stores, { ...ctx(stores), deferred, editingCell: null });
    expect(stores.rows.getRow("a")).toBeUndefined();
    expect(deferred.current.size).toBe(0);
  });
});
