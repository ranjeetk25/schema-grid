/** C3: client-side write enforcement in the edit controller (v0.2). */
import { describe, expect, it, vi } from "vitest";
import { createEditController, READ_ONLY_MESSAGE } from "../../src/editing/editController";
import { createCellStatusStore } from "../../src/state/cellStatusStore";
import { createRowStore } from "../../src/state/rowStore";
import type { CellChange, ChangeBatch, GridRow, SchemaGridEvents } from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { fixtureRows, fixtureSchema } from "../fixtures/schema";

function setup(opts: { readOnly?: Set<string>; events?: SchemaGridEvents<GridRow>; noCheck?: boolean } = {}) {
  const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
  const rowStore = createRowStore<GridRow>();
  rowStore.upsert(structuredClone(fixtureRows));
  const cellStatus = createCellStatusStore();
  const readOnly = opts.readOnly ?? new Set<string>();
  const canEditCell = vi.fn((_row: GridRow, columnId: string) => !readOnly.has(columnId));
  let n = 0;
  const controller = createEditController<GridRow>({
    dataSource: ds,
    schema: fixtureSchema,
    rowStore,
    cellStatus,
    events: opts.events ?? {},
    idFactory: () => `b${++n}`,
    ...(opts.noCheck ? {} : { canEditCell }),
  });
  return { ds, rowStore, cellStatus, controller, readOnly, canEditCell };
}

const change = (rowId: string, columnId: string, prev: unknown, next: unknown): CellChange => ({ rowId, columnId, prev, next });

describe("editController: canEditCell enforcement (C3)", () => {
  it("rejects read-only cells before the optimistic apply; they never reach the data source", async () => {
    const onCellsChange = vi.fn();
    const { controller, rowStore, ds, cellStatus, canEditCell } = setup({
      readOnly: new Set(["status"]),
      events: { onCellsChange },
    });
    const outcome = await controller.submit([change("r1", "name", "Asha", "A"), change("r1", "status", "open", "hacked")], "edit");
    expect(canEditCell).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), "status");
    const sent = ds.calls.applyChanges.mock.calls[0]?.[0] as ChangeBatch;
    expect(sent.changes).toEqual([change("r1", "name", "Asha", "A")]);
    expect(rowStore.getRow("r1")?.cells.status).toBe("open");
    expect(ds.rows().find((r) => r.id === "r1")?.cells.status).toBe("open");
    expect(outcome.result.applied.map((c) => c.columnId)).toEqual(["name"]);
    expect(outcome.result.errors).toEqual([{ rowId: "r1", columnId: "status", message: READ_ONLY_MESSAGE }]);
    expect(outcome.readOnly).toEqual([{ rowId: "r1", columnId: "status" }]);
    expect(READ_ONLY_MESSAGE).toBe("Read-only");
    // Reported, not marked as a cell error.
    expect(cellStatus.get("r1", "status").error).toBeFalsy();
    expect(cellStatus.get("r1", "status").pending).toBe(false);
    expect(onCellsChange).toHaveBeenCalledWith(outcome.result, outcome.batch);
  });

  it("all changes rejected: no applyChanges, row store untouched, still reported", async () => {
    const onCellsChange = vi.fn();
    const beforeCellsChange = vi.fn();
    const { controller, rowStore, ds } = setup({ readOnly: new Set(["status"]), events: { onCellsChange, beforeCellsChange } });
    const rev = rowStore.getRevision();
    const outcome = await controller.submit([change("r1", "status", "open", "x")], "paste");
    expect(ds.calls.applyChanges).not.toHaveBeenCalled();
    expect(beforeCellsChange).not.toHaveBeenCalled();
    expect(rowStore.getRevision()).toBe(rev);
    expect(outcome.vetoed).toBe(false);
    expect(outcome.batch.changes).toEqual([]);
    expect(outcome.result).toEqual({ applied: [], conflicts: [], errors: [{ rowId: "r1", columnId: "status", message: "Read-only" }] });
    expect(onCellsChange).toHaveBeenCalledTimes(1);
  });

  it("rejects changes for rows missing from the row store", async () => {
    const { controller, ds } = setup();
    const outcome = await controller.submit([change("nope", "name", null, "X")], "edit");
    expect(ds.calls.applyChanges).not.toHaveBeenCalled();
    expect(outcome.result.errors).toEqual([{ rowId: "nope", columnId: "name", message: "Read-only" }]);
  });

  it("re-filters a batch returned by beforeCellsChange", async () => {
    const { controller, ds, rowStore } = setup({
      readOnly: new Set(["status"]),
      events: {
        beforeCellsChange: (batch) => ({ ...batch, changes: [...batch.changes, change("r2", "status", null, "sneaky")] }),
      },
    });
    const outcome = await controller.submit([change("r1", "name", "Asha", "A")], "edit");
    const sent = ds.calls.applyChanges.mock.calls[0]?.[0] as ChangeBatch;
    expect(sent.changes.map((c) => c.columnId)).toEqual(["name"]);
    expect(rowStore.getRow("r2")?.cells.status).not.toBe("sneaky");
    expect(outcome.result.errors).toEqual([{ rowId: "r2", columnId: "status", message: "Read-only" }]);
  });

  it("a veto still wins, and read-only rejections are reported with it", async () => {
    const { controller, ds } = setup({ readOnly: new Set(["status"]), events: { beforeCellsChange: () => false } });
    const outcome = await controller.submit([change("r1", "name", "Asha", "A"), change("r1", "status", "open", "x")], "edit");
    expect(outcome.vetoed).toBe(true);
    expect(ds.calls.applyChanges).not.toHaveBeenCalled();
    expect(outcome.result.errors).toEqual([{ rowId: "r1", columnId: "status", message: "Read-only" }]);
  });

  it("server errors are merged after the read-only ones", async () => {
    const { controller, ds, cellStatus } = setup({ readOnly: new Set(["status"]) });
    ds.errorOn("r1", "name", "Name is locked");
    const outcome = await controller.submit([change("r1", "status", "open", "x"), change("r1", "name", "Asha", "A")], "edit");
    expect(outcome.result.errors).toEqual([
      { rowId: "r1", columnId: "status", message: "Read-only" },
      { rowId: "r1", columnId: "name", message: "Name is locked" },
    ]);
    expect(cellStatus.get("r1", "status").error).toBeFalsy();
    expect(cellStatus.get("r1", "name").error).toBe("Name is locked");
  });

  it("a thrown applyChanges still reports the read-only cells separately", async () => {
    const { controller, ds } = setup({ readOnly: new Set(["status"]) });
    ds.failNextApply(new Error("down"));
    const outcome = await controller.submit([change("r1", "status", "open", "x"), change("r1", "name", "Asha", "A")], "edit");
    expect(outcome.result.errors).toEqual([
      { rowId: "r1", columnId: "status", message: "Read-only" },
      { rowId: "r1", columnId: "name", message: "down" },
    ]);
  });

  it("without canEditCell, today's behaviour is kept (no check at all)", async () => {
    const { controller, ds } = setup({ noCheck: true });
    const outcome = await controller.submit([change("r1", "status", "open", "x")], "edit");
    expect(ds.calls.applyChanges).toHaveBeenCalledTimes(1);
    expect(outcome.result.errors).toEqual([]);
    expect(outcome.readOnly).toEqual([]);
  });

  it("undo re-checks at execution time: a column made read-only since the edit is skipped, not sent", async () => {
    const { controller, ds, rowStore, readOnly } = setup();
    const edit = await controller.submit([change("r1", "name", "Asha", "A"), change("r1", "score", 10, 11)], "edit");
    expect(edit.result.applied).toHaveLength(2);
    readOnly.add("score");
    // What the undo stack submits: the inverse of the step.
    const undo = await controller.submit([change("r1", "name", "A", "Asha"), change("r1", "score", 11, 10)], "undo");
    const sent = ds.calls.applyChanges.mock.calls[1]?.[0] as ChangeBatch;
    expect(sent.source).toBe("undo");
    expect(sent.changes.map((c) => c.columnId)).toEqual(["name"]);
    expect(rowStore.getRow("r1")?.cells.score).toBe(11);
    expect(ds.rows().find((r) => r.id === "r1")?.cells.score).toBe(11);
    expect(undo.readOnly).toEqual([{ rowId: "r1", columnId: "score" }]);
  });

  it("redo re-checks at execution time too", async () => {
    const { controller, ds, readOnly } = setup();
    await controller.submit([change("r1", "score", 10, 11)], "edit");
    await controller.submit([change("r1", "score", 11, 10)], "undo");
    readOnly.add("score");
    const redo = await controller.submit([change("r1", "score", 10, 11)], "redo");
    expect(ds.calls.applyChanges).toHaveBeenCalledTimes(2);
    expect(redo.result.errors).toEqual([{ rowId: "r1", columnId: "score", message: "Read-only" }]);
  });
});
