import { describe, expect, it, vi } from "vitest";
import type { CellEditRequestEvent } from "ag-grid-community";
import { createEditController, type EditControllerOptions } from "../../src/editing/editController";
import { conflictToChange, groupConflictsByRow } from "../../src/editing/conflicts";
import { createEditRequestHandler } from "../../src/editing/editEntry";
import { compileFormulaColumns } from "../../src/compile/formulaColumns";
import { createCellStatusStore } from "../../src/state/cellStatusStore";
import { createRowStore } from "../../src/state/rowStore";
import {
  createDefaultRegistry,
  type CellChange,
  type ChangeBatch,
  type ChangeResult,
  type ConflictResolution,
  type GridRow,
  type SchemaGridEvents,
} from "../../src/internal/core";
import { createInMemoryDataSource, type InMemoryOptions } from "../fixtures/dataSource";
import { col, fixtureRows, fixtureSchema } from "../fixtures/schema";

function setup(
  overrides: Partial<EditControllerOptions<GridRow>> = {},
  events: SchemaGridEvents<GridRow> = {},
  dsOptions: InMemoryOptions = {},
) {
  const ds = createInMemoryDataSource(fixtureSchema, fixtureRows, dsOptions);
  const rowStore = createRowStore<GridRow>();
  rowStore.upsert(structuredClone(fixtureRows));
  const cellStatus = createCellStatusStore();
  let n = 0;
  const controller = createEditController<GridRow>({
    dataSource: ds,
    schema: fixtureSchema,
    rowStore,
    cellStatus,
    events,
    idFactory: () => `b${++n}`,
    ...overrides,
  });
  return { ds, rowStore, cellStatus, controller };
}

const nameChange = (rowId: string, prev: unknown, next: unknown): CellChange => ({ rowId, columnId: "name", prev, next });

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createEditController.buildBatch", () => {
  it("fills baseVersions from the row store per distinct row and uses the id factory", () => {
    const { controller, rowStore } = setup();
    rowStore.patchCells("r2", {}, 7);
    const batch = controller.buildBatch(
      [nameChange("r1", "Asha", "A"), { rowId: "r1", columnId: "score", prev: 10, next: 11 }, nameChange("r2", "Bala", "B")],
      "paste",
    );
    expect(batch).toEqual({
      id: "b1",
      source: "paste",
      baseVersions: { r1: 1, r2: 7 },
      changes: expect.any(Array),
    });
    expect(batch.changes).toHaveLength(3);
  });

  it("generates distinct ids by default", () => {
    const { controller } = setup({ idFactory: undefined });
    const a = controller.buildBatch([], "edit");
    const b = controller.buildBatch([], "edit");
    expect(a.id).not.toBe(b.id);
  });
});

describe("createEditController.submit", () => {
  it("veto leaves the row store untouched and never calls applyChanges", async () => {
    const onCellsChange = vi.fn();
    const { controller, rowStore, ds, cellStatus } = setup({}, { beforeCellsChange: () => false, onCellsChange });
    const before = rowStore.getRow("r1");
    const rev = rowStore.getRevision();
    const outcome = await controller.submit([nameChange("r1", "Asha", "X")], "edit");
    expect(outcome.vetoed).toBe(true);
    expect(outcome.result).toEqual({ applied: [], conflicts: [], errors: [] });
    expect(rowStore.getRow("r1")).toBe(before);
    expect(rowStore.getRevision()).toBe(rev);
    expect(ds.calls.applyChanges).not.toHaveBeenCalled();
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(cellStatus.get("r1", "name").pending).toBe(false);
  });

  it("a transform from beforeCellsChange replaces changes and source", async () => {
    const { controller, rowStore, ds } = setup(
      {},
      {
        beforeCellsChange: async (batch: ChangeBatch) => ({
          ...batch,
          source: "import",
          changes: batch.changes.map((c) => ({ ...c, next: String(c.next).toUpperCase() })),
        }),
      },
    );
    const outcome = await controller.submit([nameChange("r1", "Asha", "xyz")], "edit");
    expect(outcome.vetoed).toBe(false);
    expect(outcome.batch.source).toBe("import");
    expect(ds.calls.applyChanges).toHaveBeenCalledWith(expect.objectContaining({ source: "import" }));
    expect(rowStore.getRow("r1")?.cells.name).toBe("XYZ");
    expect(ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("XYZ");
  });

  it("shows the optimistic value and pending status before applyChanges resolves; clears pending after success", async () => {
    const d = deferred<ChangeResult>();
    const { controller, rowStore, cellStatus } = setup({ dataSource: { applyChanges: () => d.promise } });
    const p = controller.submit([nameChange("r1", "Asha", "Optimistic")], "edit");
    await flush();
    expect(rowStore.getRow("r1")?.cells.name).toBe("Optimistic");
    expect(rowStore.getVersion("r1")).toBe(1);
    expect(cellStatus.get("r1", "name").pending).toBe(true);
    d.resolve({ applied: [nameChange("r1", "Asha", "Optimistic")], conflicts: [], errors: [] });
    const outcome = await p;
    expect(outcome.result.applied).toHaveLength(1);
    expect(cellStatus.get("r1", "name").pending).toBe(false);
    expect(rowStore.getVersion("r1")).toBe(2);
  });

  it("success keeps versions in step with the server so a second edit applies cleanly", async () => {
    const { controller, ds, rowStore } = setup();
    await controller.submit([nameChange("r1", "Asha", "A1")], "edit");
    const second = await controller.submit([nameChange("r1", "A1", "A2")], "edit");
    expect(second.result.conflicts).toEqual([]);
    expect(second.result.applied).toHaveLength(1);
    expect(rowStore.getVersion("r1")).toBe(ds.rows().find((r) => r.id === "r1")?.version);
  });

  it("maps columnId to column key when writing the row store", async () => {
    const schema = { ...fixtureSchema, columns: [...fixtureSchema.columns, col({ id: "c_nick", key: "nick", type: "text" })] };
    const d = deferred<ChangeResult>();
    const { controller, rowStore } = setup({ schema, dataSource: { applyChanges: () => d.promise } });
    void controller.submit([{ rowId: "r1", columnId: "c_nick", prev: null, next: "Ash" }], "edit");
    await flush();
    expect(rowStore.getRow("r1")?.cells.nick).toBe("Ash");
    expect(rowStore.getRow("r1")?.cells.c_nick).toBeUndefined();
    d.resolve({ applied: [], conflicts: [], errors: [] });
  });

  it("a server error reverts the cell and records the message", async () => {
    const onReverted = vi.fn();
    const { controller, rowStore, cellStatus, ds } = setup({ onReverted });
    ds.errorOn("r1", "name", "Name is locked");
    const outcome = await controller.submit([nameChange("r1", "Asha", "X"), { rowId: "r1", columnId: "score", prev: 10, next: 11 }], "edit");
    expect(outcome.result.errors).toEqual([{ rowId: "r1", columnId: "name", message: "Name is locked" }]);
    expect(rowStore.getRow("r1")?.cells.name).toBe("Asha");
    expect(rowStore.getRow("r1")?.cells.score).toBe(11);
    expect(cellStatus.get("r1", "name")).toEqual({ pending: false, error: "Name is locked", remoteChanged: false });
    expect(cellStatus.get("r1", "score").pending).toBe(false);
    expect(onReverted).toHaveBeenCalledWith([nameChange("r1", "Asha", "X")]);
  });

  it("a successful write clears an earlier error on the cell", async () => {
    const { controller, cellStatus, ds } = setup();
    ds.errorOn("r1", "name", "nope");
    await controller.submit([nameChange("r1", "Asha", "X")], "edit");
    expect(cellStatus.get("r1", "name").error).toBe("nope");
    await controller.submit([nameChange("r1", "Asha", "Y")], "edit");
    expect(cellStatus.get("r1", "name").error).toBeUndefined();
  });

  it("a conflict reverts and calls onConflict", async () => {
    const onConflict = vi.fn();
    const onCellsChange = vi.fn();
    const { controller, rowStore, cellStatus, ds } = setup({}, { onConflict, onCellsChange });
    ds.remoteEdit("r1", { name: "Remote" });
    const outcome = await controller.submit([nameChange("r1", "Asha", "Mine")], "edit");
    expect(outcome.result.conflicts).toHaveLength(1);
    expect(rowStore.getRow("r1")?.cells.name).toBe("Asha");
    expect(cellStatus.get("r1", "name").pending).toBe(false);
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict.mock.calls[0]?.[0]).toMatchObject({ rowId: "r1", columnId: "name", serverValue: "Remote", serverVersion: 2 });
    expect(onCellsChange).toHaveBeenCalledWith(outcome.result, outcome.batch);
  });

  it("keepTheirs writes the server value and version", async () => {
    let resolveFn: ((r: ConflictResolution) => Promise<void>) | undefined;
    const { controller, rowStore, cellStatus, ds } = setup(
      {},
      {
        onConflict: (_c, resolve) => {
          resolveFn = resolve;
        },
      },
    );
    ds.remoteEdit("r1", { name: "Remote" });
    await controller.submit([nameChange("r1", "Asha", "Mine")], "edit");
    cellStatus.markRemoteChanged({ rowId: "r1", columnId: "name" });
    await resolveFn?.("keepTheirs");
    expect(rowStore.getRow("r1")?.cells.name).toBe("Remote");
    expect(rowStore.getVersion("r1")).toBe(2);
    expect(cellStatus.get("r1", "name").remoteChanged).toBe(false);
    expect(ds.calls.applyChanges).toHaveBeenCalledTimes(1);
  });

  it("defaults to keepTheirs when there is no onConflict handler", async () => {
    const { controller, rowStore, ds } = setup();
    ds.remoteEdit("r1", { name: "Remote" });
    await controller.submit([nameChange("r1", "Asha", "Mine")], "edit");
    await flush();
    expect(rowStore.getRow("r1")?.cells.name).toBe("Remote");
    expect(rowStore.getVersion("r1")).toBe(2);
  });

  it("overwrite re-submits once with the new base version and the same source", async () => {
    let resolveFn: ((r: ConflictResolution) => Promise<void>) | undefined;
    const { controller, rowStore, ds } = setup(
      {},
      {
        onConflict: (_c, resolve) => {
          resolveFn = resolve;
        },
      },
    );
    ds.remoteEdit("r1", { name: "Remote" });
    await controller.submit([nameChange("r1", "Asha", "Mine"), { rowId: "r2", columnId: "score", prev: 5, next: 6 }], "paste");
    expect(ds.calls.applyChanges).toHaveBeenCalledTimes(1);
    await resolveFn?.("overwrite");
    await resolveFn?.("overwrite"); // second call is a no-op
    expect(ds.calls.applyChanges).toHaveBeenCalledTimes(2);
    const resubmitted = ds.calls.applyChanges.mock.calls[1]?.[0] as ChangeBatch;
    expect(resubmitted.source).toBe("paste");
    expect(resubmitted.baseVersions).toEqual({ r1: 2 });
    expect(resubmitted.changes).toEqual([nameChange("r1", "Remote", "Mine")]);
    expect(rowStore.getRow("r1")?.cells.name).toBe("Mine");
    expect(rowStore.getVersion("r1")).toBe(3);
    expect(ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Mine");
  });

  it("a conflict on row A does not block applied changes on row B in the same batch", async () => {
    const { controller, rowStore, cellStatus, ds } = setup({}, { onConflict: () => {} });
    ds.remoteEdit("r1", { name: "Remote" });
    const outcome = await controller.submit([nameChange("r1", "Asha", "Mine"), nameChange("r2", "Bala", "B2")], "paste");
    expect(outcome.result.applied).toEqual([nameChange("r2", "Bala", "B2")]);
    expect(outcome.result.conflicts.map((c) => c.rowId)).toEqual(["r1"]);
    expect(rowStore.getRow("r2")?.cells.name).toBe("B2");
    expect(rowStore.getVersion("r2")).toBe(2);
    expect(cellStatus.get("r2", "name").pending).toBe(false);
    expect(rowStore.getRow("r1")?.cells.name).toBe("Asha");
    expect(rowStore.getVersion("r1")).toBe(1);
  });

  it("a thrown applyChanges reverts every cell in the batch", async () => {
    const onCellsChange = vi.fn();
    const onReverted = vi.fn();
    const { controller, rowStore, cellStatus, ds } = setup({ onReverted }, { onCellsChange });
    ds.failNextApply(new Error("Network down"));
    const changes = [nameChange("r1", "Asha", "X"), { rowId: "r2", columnId: "score", prev: 5, next: 99 }];
    const outcome = await controller.submit(changes, "fill");
    expect(outcome.vetoed).toBe(false);
    expect(outcome.result.applied).toEqual([]);
    expect(outcome.result.errors).toEqual([
      { rowId: "r1", columnId: "name", message: "Network down" },
      { rowId: "r2", columnId: "score", message: "Network down" },
    ]);
    expect(rowStore.getRow("r1")?.cells.name).toBe("Asha");
    expect(rowStore.getRow("r2")?.cells.score).toBe(5);
    expect(cellStatus.get("r1", "name")).toEqual({ pending: false, error: "Network down", remoteChanged: false });
    expect(cellStatus.get("r2", "score").error).toBe("Network down");
    expect(onReverted).toHaveBeenCalledWith(changes);
    expect(onCellsChange).toHaveBeenCalledWith(outcome.result, outcome.batch);
  });

  it("onApplied reports changed rows, cells and formula dependents that need a refresh", async () => {
    const onApplied = vi.fn();
    const formulas = compileFormulaColumns<GridRow>(fixtureSchema);
    const { controller } = setup({ onApplied, formulas });
    await controller.submit(
      [
        { rowId: "r1", columnId: "score", prev: 10, next: 12 },
        { rowId: "r2", columnId: "score", prev: 5, next: 6 },
        nameChange("r2", "Bala", "B"),
      ],
      "edit",
    );
    expect(onApplied).toHaveBeenCalledTimes(1);
    const info = onApplied.mock.calls[0]?.[0];
    expect(info.changedRowIds).toEqual(["r1", "r2"]);
    expect(info.changedCells).toEqual([
      { rowId: "r1", columnId: "score" },
      { rowId: "r2", columnId: "score" },
      { rowId: "r2", columnId: "name" },
    ]);
    expect(info.formulaDependents).toEqual([
      { rowId: "r1", columnId: "total" },
      { rowId: "r2", columnId: "total" },
    ]);
    expect(info.result.applied).toHaveLength(3);
  });

  it("does not call onApplied when nothing applied", async () => {
    const onApplied = vi.fn();
    const { controller, ds } = setup({ onApplied });
    ds.failNextApply(new Error("x"));
    await controller.submit([nameChange("r1", "Asha", "X")], "edit");
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("reads events through a getter so the latest handlers are used", async () => {
    let current: SchemaGridEvents<GridRow> = { beforeCellsChange: () => false };
    const { controller, ds } = setup({ events: () => current });
    expect((await controller.submit([nameChange("r1", "Asha", "X")], "edit")).vetoed).toBe(true);
    current = {};
    expect((await controller.submit([nameChange("r1", "Asha", "X")], "edit")).vetoed).toBe(false);
    expect(ds.calls.applyChanges).toHaveBeenCalledTimes(1);
  });
});

describe("overlapping submits", () => {
  it("an older submit finishing does not clear pending for a cell a newer in-flight submit re-marked", async () => {
    const d1 = deferred<ChangeResult>();
    const d2 = deferred<ChangeResult>();
    const queue = [d1, d2];
    const { controller, rowStore, cellStatus } = setup({ dataSource: { applyChanges: () => (queue.shift() as Deferred<ChangeResult>).promise } });
    const p1 = controller.submit([nameChange("r1", "Asha", "A")], "edit");
    await flush();
    const p2 = controller.submit([nameChange("r1", "A", "B")], "edit");
    await flush();
    expect(rowStore.getRow("r1")?.cells.name).toBe("B");
    d1.resolve({ applied: [nameChange("r1", "Asha", "A")], conflicts: [], errors: [] });
    await p1;
    expect(cellStatus.get("r1", "name").pending).toBe(true);
    expect(rowStore.getRow("r1")?.cells.name).toBe("B");
    d2.resolve({ applied: [nameChange("r1", "A", "B")], conflicts: [], errors: [] });
    await p2;
    expect(cellStatus.get("r1", "name").pending).toBe(false);
    expect(rowStore.getRow("r1")?.cells.name).toBe("B");
  });

  it("an older failing submit does not overwrite a newer in-flight optimistic value", async () => {
    const d1 = deferred<ChangeResult>();
    const d2 = deferred<ChangeResult>();
    const queue = [d1, d2];
    const { controller, rowStore, cellStatus } = setup({ dataSource: { applyChanges: () => (queue.shift() as Deferred<ChangeResult>).promise } });
    const p1 = controller.submit([nameChange("r1", "Asha", "A")], "edit");
    await flush();
    const p2 = controller.submit([nameChange("r1", "A", "B")], "edit");
    await flush();
    d1.reject(new Error("boom"));
    await p1;
    expect(rowStore.getRow("r1")?.cells.name).toBe("B");
    expect(cellStatus.get("r1", "name").pending).toBe(true);
    d2.resolve({ applied: [nameChange("r1", "A", "B")], conflicts: [], errors: [] });
    await p2;
    expect(cellStatus.get("r1", "name")).toEqual({ pending: false, remoteChanged: false });
  });

  it("the newer submit failing reverts to its own prev (the older optimistic value)", async () => {
    const d1 = deferred<ChangeResult>();
    const d2 = deferred<ChangeResult>();
    const queue = [d1, d2];
    const { controller, rowStore } = setup({ dataSource: { applyChanges: () => (queue.shift() as Deferred<ChangeResult>).promise } });
    const p1 = controller.submit([nameChange("r1", "Asha", "A")], "edit");
    await flush();
    const p2 = controller.submit([nameChange("r1", "A", "B")], "edit");
    await flush();
    d2.resolve({ applied: [], conflicts: [], errors: [{ rowId: "r1", columnId: "name", message: "bad" }] });
    d1.resolve({ applied: [nameChange("r1", "Asha", "A")], conflicts: [], errors: [] });
    await p1;
    // p1 settled but the newer batch still owns the cell: value untouched.
    expect(rowStore.getRow("r1")?.cells.name).toBe("B");
    await p2;
    expect(rowStore.getRow("r1")?.cells.name).toBe("A");
  });
});

describe("review fixes", () => {
  it("C1: two quick submits on the same row serialise sends and rebase on our own write", async () => {
    const onConflict = vi.fn();
    const { controller, rowStore, ds } = setup({}, { onConflict });
    const p1 = controller.submit([nameChange("r1", "Asha", "A")], "edit");
    const p2 = controller.submit([{ rowId: "r1", columnId: "score", prev: 10, next: 11 }], "edit");
    const [o1, o2] = await Promise.all([p1, p2]);
    expect(o1.result.applied).toHaveLength(1);
    expect(o2.result.applied).toHaveLength(1);
    expect(o2.result.conflicts).toEqual([]);
    expect(onConflict).not.toHaveBeenCalled();
    expect(o2.batch.baseVersions).toEqual({ r1: 2 });
    expect(rowStore.getVersion("r1")).toBe(3);
    expect(rowStore.getRow("r1")?.cells).toMatchObject({ name: "A", score: 11 });
    expect(ds.rows().find((r) => r.id === "r1")?.version).toBe(3);
  });

  it("C1: an explicit base supplied by a beforeCellsChange transform is kept", async () => {
    const { controller, ds } = setup({}, { beforeCellsChange: (b) => ({ ...b, baseVersions: { r1: 99 } }) });
    const outcome = await controller.submit([nameChange("r1", "Asha", "A")], "edit");
    expect(outcome.batch.baseVersions).toEqual({ r1: 99 });
    expect(outcome.result.conflicts).toHaveLength(1);
    expect(ds.calls.applyChanges).toHaveBeenCalledTimes(1);
  });

  it("C1: batches on different rows are not serialised", async () => {
    const d1 = deferred<ChangeResult>();
    const d2 = deferred<ChangeResult>();
    const queue = [d1, d2];
    const applyChanges = vi.fn(() => (queue.shift() as Deferred<ChangeResult>).promise);
    const { controller } = setup({ dataSource: { applyChanges } });
    const p1 = controller.submit([nameChange("r1", "Asha", "A")], "edit");
    const p2 = controller.submit([nameChange("r2", "Bala", "B")], "edit");
    await flush();
    expect(applyChanges).toHaveBeenCalledTimes(2);
    d1.resolve({ applied: [], conflicts: [], errors: [] });
    d2.resolve({ applied: [], conflicts: [], errors: [] });
    await Promise.all([p1, p2]);
  });

  it("C2: overwriting several conflicting cells of one row resubmits once", async () => {
    const onRowStale = vi.fn();
    const { controller, rowStore, ds } = setup(
      { onRowStale },
      { onConflict: (_c, resolve) => void resolve("overwrite") },
    );
    ds.remoteEdit("r1", { status: "remote" });
    const outcome = await controller.submit(
      [nameChange("r1", "Asha", "N"), { rowId: "r1", columnId: "score", prev: 10, next: 42 }],
      "paste",
    );
    expect(outcome.result.conflicts).toHaveLength(2);
    await flush();
    expect(ds.calls.applyChanges).toHaveBeenCalledTimes(2);
    const resubmitted = ds.calls.applyChanges.mock.calls[1]?.[0] as ChangeBatch;
    expect(resubmitted.source).toBe("paste");
    expect(resubmitted.changes).toEqual([nameChange("r1", "Asha", "N"), { rowId: "r1", columnId: "score", prev: 10, next: 42 }]);
    expect(resubmitted.baseVersions).toEqual({ r1: 2 });
    const server = ds.rows().find((r) => r.id === "r1");
    expect(server?.cells).toMatchObject({ name: "N", score: 42, status: "remote" });
    expect(rowStore.getRow("r1")?.cells).toMatchObject({ name: "N", score: 42 });
    expect(rowStore.getVersion("r1")).toBe(3);
    expect(onRowStale).toHaveBeenCalledWith(["r1"]);
  });

  it("I1: overwrite never lowers the row version", async () => {
    let resolveFn: ((r: ConflictResolution) => Promise<void>) | undefined;
    const d = deferred<ChangeResult>();
    const calls: ChangeBatch[] = [];
    const { controller, rowStore } = setup({
      dataSource: {
        applyChanges: (b) => {
          calls.push(b);
          if (calls.length === 1) {
            return Promise.resolve({
              applied: [],
              errors: [],
              conflicts: [{ rowId: "r1", columnId: "name", serverValue: "S", serverVersion: 2, updatedAt: "" }],
            });
          }
          return d.promise;
        },
      },
      events: { onConflict: (_c, r) => { resolveFn = r; } },
    });
    await controller.submit([nameChange("r1", "Asha", "Mine")], "edit");
    rowStore.patchCells("r1", {}, 5); // a sync refresh moved the row on
    const done = resolveFn?.("overwrite");
    await flush();
    expect(calls[1]?.baseVersions).toEqual({ r1: 5 });
    d.resolve({ applied: [], conflicts: [], errors: [] });
    await done;
  });

  it("I2: a late keepTheirs/overwrite does not clobber a newer local edit", async () => {
    const resolvers: ((r: ConflictResolution) => Promise<void>)[] = [];
    const { controller, rowStore, ds } = setup({}, { onConflict: (_c, r) => { resolvers.push(r); } });
    ds.remoteEdit("r1", { name: "Remote" });
    await controller.submit([nameChange("r1", "Asha", "Mine")], "edit");
    await controller.submit([nameChange("r1", "Asha", "Mine")], "edit");
    rowStore.patchCells("r1", { name: "Remote" }, 2); // sync refresh
    const newer = await controller.submit([nameChange("r1", "Remote", "Newer")], "edit");
    expect(newer.result.applied).toHaveLength(1);
    expect(rowStore.getVersion("r1")).toBe(3);

    await resolvers[0]?.("keepTheirs");
    expect(rowStore.getRow("r1")?.cells.name).toBe("Newer");
    expect(rowStore.getVersion("r1")).toBe(3);

    await resolvers[1]?.("overwrite");
    await flush();
    expect(ds.calls.applyChanges).toHaveBeenCalledTimes(3);
    expect(rowStore.getRow("r1")?.cells.name).toBe("Newer");
  });

  it("I3: onRowStale is called with the conflicting rows", async () => {
    const onRowStale = vi.fn();
    const { controller, ds } = setup({ onRowStale }, { onConflict: () => {} });
    ds.remoteEdit("r1", { name: "Remote" });
    ds.remoteEdit("r2", { name: "Remote" });
    await controller.submit([nameChange("r1", "Asha", "X"), nameChange("r2", "Bala", "Y"), nameChange("r3", "Chitra", "Z")], "paste");
    expect(onRowStale).toHaveBeenCalledTimes(1);
    expect(onRowStale).toHaveBeenCalledWith(["r1", "r2"]);
  });

  it("I4: prefers result.versions, falls back to base + 1", async () => {
    const { controller, rowStore } = setup({
      dataSource: {
        applyChanges: async (b) => ({
          applied: b.changes,
          conflicts: [],
          errors: [],
          versions: { r1: 10 },
        }),
      },
    });
    await controller.submit([nameChange("r1", "Asha", "A"), nameChange("r2", "Bala", "B")], "edit");
    expect(rowStore.getVersion("r1")).toBe(10);
    expect(rowStore.getVersion("r2")).toBe(2);
  });

  it("I5: a failed write does not revert a cell a sync patch changed mid-flight", async () => {
    const { controller, rowStore, ds, cellStatus } = setup({}, {}, { delayMs: 5 });
    ds.failNextApply(new Error("down"));
    const p = controller.submit([nameChange("r1", "Asha", "X")], "edit");
    await flush();
    rowStore.patchCells("r1", { name: "Synced" }, 4);
    await p;
    expect(rowStore.getRow("r1")?.cells.name).toBe("Synced");
    expect(cellStatus.get("r1", "name")).toEqual({ pending: false, error: "down", remoteChanged: false });
  });

  it("I5: a per-cell server error does not revert a cell a sync patch changed mid-flight", async () => {
    const { controller, rowStore, ds } = setup({}, {}, { delayMs: 5 });
    ds.errorOn("r1", "name", "nope");
    const p = controller.submit([nameChange("r1", "Asha", "X")], "edit");
    await flush();
    rowStore.patchCells("r1", { name: "Synced" });
    await p;
    expect(rowStore.getRow("r1")?.cells.name).toBe("Synced");
  });

  it("the same cell twice in one batch reverts to the earliest prev", async () => {
    const { controller, rowStore, ds } = setup();
    ds.failNextApply(new Error("down"));
    await controller.submit([nameChange("r1", "Asha", "X"), nameChange("r1", "X", "Y")], "edit");
    expect(rowStore.getRow("r1")?.cells.name).toBe("Asha");
  });

  it("ownership is keyed on an internal counter, not batch.id", async () => {
    const d1 = deferred<ChangeResult>();
    const d2 = deferred<ChangeResult>();
    const queue = [d1, d2];
    const { controller, cellStatus } = setup({
      idFactory: () => "same",
      dataSource: { applyChanges: () => (queue.shift() as Deferred<ChangeResult>).promise },
    });
    const p1 = controller.submit([nameChange("r1", "Asha", "A")], "edit");
    const p2 = controller.submit([nameChange("r1", "A", "B")], "edit");
    d1.resolve({ applied: [nameChange("r1", "Asha", "A")], conflicts: [], errors: [] });
    await p1;
    expect(cellStatus.get("r1", "name").pending).toBe(true);
    d2.resolve({ applied: [nameChange("r1", "A", "B")], conflicts: [], errors: [] });
    await p2;
    expect(cellStatus.get("r1", "name").pending).toBe(false);
  });

  it("beforeCellsChange returning undefined means no change", async () => {
    const before = vi.fn(() => undefined) as unknown as NonNullable<SchemaGridEvents<GridRow>["beforeCellsChange"]>;
    const { controller, rowStore } = setup({}, { beforeCellsChange: before });
    const outcome = await controller.submit([nameChange("r1", "Asha", "A")], "edit");
    expect(outcome.vetoed).toBe(false);
    expect(outcome.result.applied).toHaveLength(1);
    expect(rowStore.getRow("r1")?.cells.name).toBe("A");
  });

  it("patches the row store from the server-normalised applied value", async () => {
    const { controller, rowStore } = setup({
      dataSource: {
        applyChanges: async (b) => ({
          applied: b.changes.map((c) => ({ ...c, next: String(c.next).trim() })),
          conflicts: [],
          errors: [],
        }),
      },
    });
    await controller.submit([nameChange("r1", "Asha", "  padded  ")], "edit");
    expect(rowStore.getRow("r1")?.cells.name).toBe("padded");
  });
});

describe("conflicts helpers", () => {
  const conflict = (rowId: string, columnId: string) => ({
    rowId,
    columnId,
    serverValue: "S",
    serverVersion: 4,
    updatedAt: "2026-09-01T00:00:00.000Z",
  });

  it("groupConflictsByRow groups preserving order", () => {
    const grouped = groupConflictsByRow([conflict("r1", "a"), conflict("r2", "a"), conflict("r1", "b")]);
    expect([...grouped.keys()]).toEqual(["r1", "r2"]);
    expect(grouped.get("r1")?.map((c) => c.columnId)).toEqual(["a", "b"]);
  });

  it("conflictToChange rebases our change on the server value", () => {
    expect(conflictToChange(conflict("r1", "a"), { rowId: "r1", columnId: "a", prev: "old", next: "mine" })).toEqual({
      rowId: "r1",
      columnId: "a",
      prev: "S",
      next: "mine",
    });
  });
});

describe("createEditRequestHandler", () => {
  function makeEvent(overrides: Partial<Record<string, unknown>>): CellEditRequestEvent<GridRow> {
    const columnId = (overrides.columnId as string | undefined) ?? "name";
    return {
      data: fixtureRows[0],
      oldValue: "Asha",
      newValue: "New",
      column: { getColId: () => columnId },
      colDef: { colId: columnId },
      node: {},
      ...overrides,
    } as unknown as CellEditRequestEvent<GridRow>;
  }

  it("adapts the event into a single-cell edit submit", () => {
    const submit = vi.fn(async () => ({ result: { applied: [], conflicts: [], errors: [] }, batch: {} as ChangeBatch, vetoed: false }));
    const handler = createEditRequestHandler<GridRow>({ submit }, { schema: fixtureSchema });
    handler(makeEvent({}));
    expect(submit).toHaveBeenCalledWith([{ rowId: "r1", columnId: "name", prev: "Asha", next: "New" }], "edit");
  });

  it("skips no-op edits (deep-equal arrays) and rows without cells", () => {
    const submit = vi.fn();
    const handler = createEditRequestHandler<GridRow>({ submit }, { schema: fixtureSchema });
    handler(makeEvent({ oldValue: "Asha", newValue: "Asha" }));
    handler(makeEvent({ columnId: "tags", oldValue: ["hot", "cold"], newValue: ["hot", "cold"] }));
    handler(makeEvent({ data: { id: "group-1", kind: "group" } }));
    handler(makeEvent({ data: undefined }));
    expect(submit).not.toHaveBeenCalled();
  });

  it("parseValue overrides; typed values pass through; strings for non-text types are parsed via the registry", () => {
    const submit = vi.fn(async () => ({ result: { applied: [], conflicts: [], errors: [] }, batch: {} as ChangeBatch, vetoed: false }));
    const withParse = createEditRequestHandler<GridRow>({ submit }, { schema: fixtureSchema, parseValue: (v) => `<${String(v)}>` });
    withParse(makeEvent({}));
    expect(submit).toHaveBeenLastCalledWith([{ rowId: "r1", columnId: "name", prev: "Asha", next: "<New>" }], "edit");

    const registry = createDefaultRegistry();
    const parseSpy = vi.spyOn(registry.get("number") as NonNullable<ReturnType<typeof registry.get>>, "parse");
    const withRegistry = createEditRequestHandler<GridRow>({ submit }, { schema: fixtureSchema, registry });
    withRegistry(makeEvent({ columnId: "score", oldValue: 10, newValue: 13 }));
    expect(submit).toHaveBeenLastCalledWith([{ rowId: "r1", columnId: "score", prev: 10, next: 13 }], "edit");
    expect(parseSpy).not.toHaveBeenCalled();
    withRegistry(makeEvent({ columnId: "score", oldValue: 10, newValue: "12" }));
    expect(submit).toHaveBeenLastCalledWith([{ rowId: "r1", columnId: "score", prev: 10, next: 12 }], "edit");
    // text-like columns are never re-parsed
    withRegistry(makeEvent({ columnId: "payment", oldValue: "paid", newValue: "failed" }));
    expect(submit).toHaveBeenLastCalledWith([{ rowId: "r1", columnId: "payment", prev: "paid", next: "failed" }], "edit");
  });

  it("an unparseable string sets a cell error instead of submitting", () => {
    const submit = vi.fn();
    const cellStatus = createCellStatusStore();
    const handler = createEditRequestHandler<GridRow>({ submit }, { schema: fixtureSchema, registry: createDefaultRegistry(), cellStatus });
    handler(makeEvent({ columnId: "score", oldValue: 10, newValue: "not a number" }));
    expect(submit).not.toHaveBeenCalled();
    const core = createDefaultRegistry().get("number")!.parse("not a number", {});
    expect(cellStatus.get("r1", "score").error).toBe(core.ok ? "(parsed)" : core.error);
  });

  it("a string for a user column is parsed into a core UserRef", () => {
    const submit = vi.fn();
    const handler = createEditRequestHandler<GridRow>({ submit }, { schema: fixtureSchema, registry: createDefaultRegistry() });
    handler(makeEvent({ columnId: "owner", oldValue: null, newValue: "u-9" }));
    expect(submit).toHaveBeenLastCalledWith([{ rowId: "r1", columnId: "owner", prev: null, next: { id: "u-9" } }], "edit");
  });

  it("ignores non-user sources (undo, redo, data)", () => {
    const submit = vi.fn();
    const handler = createEditRequestHandler<GridRow>({ submit }, { schema: fixtureSchema });
    for (const source of ["undo", "redo", "data", "paste"]) handler(makeEvent({ source }));
    expect(submit).not.toHaveBeenCalled();
    handler(makeEvent({ source: "edit" }));
    handler(makeEvent({ source: undefined }));
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("takes prev from the row store when the row is known", () => {
    const submit = vi.fn();
    const rowStore = createRowStore<GridRow>();
    rowStore.upsert([{ ...structuredClone(fixtureRows[0] as GridRow), cells: { name: "Current" } }]);
    const handler = createEditRequestHandler<GridRow>({ submit }, { schema: fixtureSchema, rowStore });
    handler(makeEvent({ oldValue: "Stale" }));
    expect(submit).toHaveBeenCalledWith([{ rowId: "r1", columnId: "name", prev: "Current", next: "New" }], "edit");
  });
});
