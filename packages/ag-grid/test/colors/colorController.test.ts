import { describe, expect, it, vi } from "vitest";
import {
  createColorController,
  keepPendingColors,
  manualColorOf,
  withManualColors,
} from "../../src/colors/colorController";
import type { CellColorBatch, CellColorResult, ColumnDef, GridRow } from "../../src/internal/core";
import { createRowStore } from "../../src/state/rowStore";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { fixtureRows, fixtureSchema } from "../fixtures/schema";

function setup(opts: { send?: (batch: CellColorBatch) => Promise<CellColorResult>; canColor?: (row: GridRow, column: ColumnDef) => boolean } = {}) {
  const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
  const rowStore = createRowStore<GridRow>();
  rowStore.upsert(ds.rows());
  const send = vi.fn(opts.send ?? ((batch: CellColorBatch) => ds.setCellColors(batch)));
  const onApplied = vi.fn();
  const upsertRows = vi.fn((rows: GridRow[]) => rowStore.upsert(rows));
  const controller = createColorController<GridRow>({
    getSetCellColors: () => send,
    rowStore,
    getSchema: () => fixtureSchema,
    canColor: opts.canColor ?? ((_row, column) => column.type !== "formula"),
    upsertRows,
    onApplied,
  });
  return { ds, rowStore, send, onApplied, upsertRows, controller };
}

const color = (store: ReturnType<typeof createRowStore<GridRow>>, rowId: string, columnId: string) =>
  manualColorOf(store.getRow(rowId), columnId);

describe("createColorController", () => {
  it("paints optimistically, sends one batch and records one undo entry", async () => {
    const { rowStore, send, onApplied, ds, controller } = setup();
    const version = rowStore.getRow("r1")?.version;
    const promise = controller.apply([
      { rowId: "r1", columnId: "name", color: "red" },
      { rowId: "r2", columnId: "name", color: "red" },
    ]);
    // Optimistic, before the source answers.
    expect(color(rowStore, "r1", "name")).toBe("red");
    expect(controller.isPending("r1", "name")).toBe(true);
    const outcome = await promise;
    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome?.result.applied).toHaveLength(2);
    expect(outcome?.skipped).toBe(0);
    expect(controller.isPending("r1", "name")).toBe(false);
    expect(rowStore.getRow("r1")?.version).toBe(version);
    expect(ds.rows().find((r) => r.id === "r2")?.colors).toEqual({ name: "red" });
    expect(onApplied).toHaveBeenCalledWith({
      applied: [
        { rowId: "r1", columnId: "name", prev: null, next: "red" },
        { rowId: "r2", columnId: "name", prev: null, next: "red" },
      ],
      source: "paint",
    });
  });

  it("skips (and counts) cells the client knows it can't paint; nothing sent when none remain", async () => {
    const { send, controller } = setup({ canColor: (row) => row.id !== "r2" });
    const outcome = await controller.apply([
      { rowId: "r2", columnId: "name", color: "red" },
      { rowId: "nope", columnId: "name", color: "red" },
      { rowId: "r1", columnId: "ghost", color: "red" },
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      result: {
        applied: [],
        rejected: [
          { rowId: "r2", columnId: "name", message: "Column is read-only" },
          { rowId: "nope", columnId: "name", message: "Row not found" },
          { rowId: "r1", columnId: "ghost", message: "Column not found" },
        ],
      },
      skipped: 3,
    });
  });

  it("rolls back cells the source rejected", async () => {
    const { rowStore, controller, onApplied } = setup({
      send: async (batch) => ({
        applied: batch.changes.filter((c) => c.rowId !== "r2"),
        rejected: [{ rowId: "r2", columnId: "name", message: "Read-only" }],
      }),
    });
    rowStore.upsert([withManualColors(rowStore.getRow("r2") as GridRow, { name: "blue" })], { force: true });
    const outcome = await controller.apply([
      { rowId: "r1", columnId: "name", color: "red" },
      { rowId: "r2", columnId: "name", color: "red" },
    ]);
    expect(color(rowStore, "r1", "name")).toBe("red");
    expect(color(rowStore, "r2", "name")).toBe("blue");
    expect(outcome?.result.rejected).toEqual([{ rowId: "r2", columnId: "name", message: "Read-only" }]);
    expect(outcome?.skipped).toBe(0);
    expect(onApplied.mock.calls[0]?.[0].applied).toEqual([{ rowId: "r1", columnId: "name", prev: null, next: "red" }]);
  });

  it("rolls everything back and rethrows when the source fails", async () => {
    const { rowStore, controller, onApplied } = setup({ send: async () => Promise.reject(new Error("offline")) });
    await expect(controller.apply([{ rowId: "r1", columnId: "name", color: "red" }])).rejects.toThrow("offline");
    expect(color(rowStore, "r1", "name")).toBeNull();
    expect(controller.isPending("r1", "name")).toBe(false);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("a rollback leaves a cell repainted meanwhile alone", async () => {
    let fail: (e: Error) => void = () => {};
    const { rowStore, controller } = setup({
      send: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              fail = reject;
            }),
        )
        .mockImplementation(async (batch: CellColorBatch) => ({ applied: batch.changes, rejected: [] })),
    });
    const first = controller.apply([{ rowId: "r1", columnId: "name", color: "red" }]);
    const second = controller.apply([{ rowId: "r1", columnId: "name", color: "green" }]);
    await new Promise((r) => setTimeout(r, 0)); // the queued first batch reaches the source
    fail(new Error("offline"));
    await expect(first).rejects.toThrow("offline");
    await second;
    expect(color(rowStore, "r1", "name")).toBe("green");
  });

  it("applies the source's rows when it sends them", async () => {
    const { upsertRows, controller } = setup();
    await controller.apply([{ rowId: "r1", columnId: "name", color: "teal" }]);
    expect(upsertRows).toHaveBeenCalledTimes(1);
    expect(upsertRows.mock.calls[0]?.[0][0]?.colors).toEqual({ name: "teal" });
  });

  it("clearing (null) removes the color; undo/redo sources are reported as such", async () => {
    const { rowStore, controller, onApplied } = setup();
    await controller.apply([{ rowId: "r1", columnId: "name", color: "red" }]);
    await controller.apply([{ rowId: "r1", columnId: "name", color: null }], "undo");
    expect(rowStore.getRow("r1")?.colors).toBeUndefined();
    expect(onApplied.mock.calls[1]?.[0]).toEqual({
      applied: [{ rowId: "r1", columnId: "name", prev: "red", next: null }],
      source: "undo",
    });
  });

  it("resolves null when the source can't write colors", async () => {
    const rowStore = createRowStore<GridRow>();
    const controller = createColorController<GridRow>({
      getSetCellColors: () => undefined,
      rowStore,
      getSchema: () => fixtureSchema,
      canColor: () => true,
    });
    expect(await controller.apply([{ rowId: "r1", columnId: "name", color: "red" }])).toBeNull();
  });
});

describe("keepPendingColors", () => {
  it("keeps the local color of pending cells on an incoming row", () => {
    const local: GridRow = { id: "r1", version: 1, updatedAt: "", cells: {}, colors: { name: "red" } };
    const incoming: GridRow = { id: "r1", version: 1, updatedAt: "", cells: {}, colors: { name: "blue" as const, score: "gray" as const } };
    const isPending = (_: string, columnId: string) => columnId === "name";
    expect(keepPendingColors(incoming, local, ["name", "score"], isPending).colors).toEqual({ name: "red", score: "gray" });
    expect(keepPendingColors(incoming, local, ["name", "score"], () => false)).toBe(incoming);
    expect(keepPendingColors(incoming, undefined, ["name"], isPending)).toBe(incoming);
  });
});
