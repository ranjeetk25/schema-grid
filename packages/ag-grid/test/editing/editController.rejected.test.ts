/**
 * v0.3: silent rejection (`ChangeResult.rejected`, hook-dropped changes) and
 * input-only `meta` travelling with batches / changes.
 */
import { describe, expect, it, vi } from "vitest";
import { createEditController, type EditControllerOptions } from "../../src/editing/editController";
import { createCellStatusStore } from "../../src/state/cellStatusStore";
import { createRowStore } from "../../src/state/rowStore";
import type { CellChange, ChangeBatch, ChangeResult, GridRow, SchemaGridEvents } from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { fixtureRows, fixtureSchema } from "../fixtures/schema";

function setup(overrides: Partial<EditControllerOptions<GridRow>> = {}, events: SchemaGridEvents<GridRow> = {}) {
  const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
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

const nameChange = (rowId: string, prev: unknown, next: unknown, meta?: Record<string, unknown>): CellChange => ({
  rowId,
  columnId: "name",
  prev,
  next,
  ...(meta ? { meta } : {}),
});

/** A data source that applies nothing and reports every change as `rejected`. */
function rejectingSource(): { applyChanges: ReturnType<typeof vi.fn> } {
  return {
    applyChanges: vi.fn(async (batch: ChangeBatch): Promise<ChangeResult> => ({
      applied: [],
      conflicts: [],
      errors: [],
      rejected: batch.changes,
    })),
  };
}

describe("silent rejection: data source `rejected`", () => {
  it("reverts the optimistic value, clears pending, sets NO error and reports the cells", async () => {
    const onCellsChange = vi.fn();
    const ds = rejectingSource();
    const { controller, rowStore, cellStatus } = setup({ dataSource: ds as never }, { onCellsChange });
    const outcome = await controller.submit([nameChange("r1", "Asha", "Zed")], "edit");
    expect(rowStore.getRow("r1")?.cells.name).toBe("Asha");
    expect(cellStatus.get("r1", "name")).toEqual({ pending: false, remoteChanged: false });
    expect(outcome.vetoed).toBe(false);
    expect(outcome.rejected).toEqual([expect.objectContaining({ rowId: "r1", columnId: "name", next: "Zed" })]);
    expect(outcome.result.rejected).toEqual(outcome.rejected);
    expect(outcome.result.errors).toEqual([]);
    expect(outcome.result.applied).toEqual([]);
    expect(onCellsChange).toHaveBeenCalledTimes(1);
    expect(onCellsChange.mock.calls[0]?.[0].rejected).toHaveLength(1);
  });

  it("does not revert a newer local edit that landed while the rejected batch was in flight", async () => {
    let release!: (r: ChangeResult) => void;
    const first = new Promise<ChangeResult>((r) => {
      release = r;
    });
    const applyChanges = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementation(async (b: ChangeBatch) => ({ applied: b.changes, conflicts: [], errors: [] }));
    const { controller, rowStore } = setup({ dataSource: { applyChanges } as never });
    const p1 = controller.submit([nameChange("r1", "Asha", "One")], "edit");
    const p2 = controller.submit([nameChange("r1", "One", "Two")], "edit");
    release({ applied: [], conflicts: [], errors: [], rejected: [nameChange("r1", "Asha", "One")] });
    await Promise.all([p1, p2]);
    expect(rowStore.getRow("r1")?.cells.name).toBe("Two");
  });

  it("does not call onApplied for rejected cells and keeps the version", async () => {
    const onApplied = vi.fn();
    const { controller, rowStore } = setup({ dataSource: rejectingSource() as never, onApplied });
    await controller.submit([nameChange("r1", "Asha", "Zed")], "edit");
    expect(onApplied).not.toHaveBeenCalled();
    expect(rowStore.getVersion("r1")).toBe(1);
  });
});

describe("silent rejection: beforeCellsChange drops changes", () => {
  it("dropped cells are never applied nor sent and are reported as rejected", async () => {
    const beforeCellsChange = vi.fn(async (batch: ChangeBatch) => ({
      ...batch,
      changes: batch.changes.filter((c) => c.rowId !== "r2"),
    }));
    const { controller, rowStore, ds } = setup({}, { beforeCellsChange });
    const outcome = await controller.submit([nameChange("r1", "Asha", "A"), nameChange("r2", "Bala", "B")], "paste");
    expect(rowStore.getRow("r1")?.cells.name).toBe("A");
    expect(rowStore.getRow("r2")?.cells.name).toBe("Bala");
    const sent = ds.calls.applyChanges.mock.calls[0]?.[0] as ChangeBatch;
    expect(sent.changes.map((c) => c.rowId)).toEqual(["r1"]);
    expect(outcome.rejected).toEqual([nameChange("r2", "Bala", "B")]);
    expect(outcome.result.rejected).toEqual([nameChange("r2", "Bala", "B")]);
    expect(outcome.result.applied).toHaveLength(1);
    expect(outcome.result.errors).toEqual([]);
  });

  it("a hook that drops EVERY change sends nothing and still emits onCellsChange with the rejections", async () => {
    const onCellsChange = vi.fn();
    const { controller, ds } = setup({}, { beforeCellsChange: async (b) => ({ ...b, changes: [] }), onCellsChange });
    const outcome = await controller.submit([nameChange("r1", "Asha", "A")], "edit");
    expect(ds.calls.applyChanges).not.toHaveBeenCalled();
    expect(outcome.vetoed).toBe(false);
    expect(outcome.rejected).toEqual([nameChange("r1", "Asha", "A")]);
    expect(onCellsChange).toHaveBeenCalledWith(expect.objectContaining({ rejected: [nameChange("r1", "Asha", "A")] }), expect.anything());
  });

  it("a transform that only changes `next` is not a rejection", async () => {
    const { controller, rowStore } = setup(
      {},
      { beforeCellsChange: async (b) => ({ ...b, changes: b.changes.map((c) => ({ ...c, next: String(c.next).toUpperCase() })) }) },
    );
    const outcome = await controller.submit([nameChange("r1", "Asha", "zed")], "edit");
    expect(outcome.rejected).toEqual([]);
    expect(rowStore.getRow("r1")?.cells.name).toBe("ZED");
  });

  it("a veto reports no rejections (it is a veto)", async () => {
    const { controller } = setup({}, { beforeCellsChange: async (): Promise<false> => false });
    const outcome = await controller.submit([nameChange("r1", "Asha", "A")], "edit");
    expect(outcome.vetoed).toBe(true);
    expect(outcome.rejected).toEqual([]);
  });
});

describe("input-only meta", () => {
  it("batch meta and change meta from beforeCellsChange reach the data source untouched", async () => {
    const readOnly = new Set<string>();
    const canEditCell = vi.fn((_row: GridRow, columnId: string) => !readOnly.has(columnId));
    const beforeCellsChange = async (b: ChangeBatch): Promise<ChangeBatch> => ({
      ...b,
      meta: { reuploadDeadline: "2026-10-01" },
      changes: b.changes.map((c) => ({ ...c, meta: { decisionMessage: "x" } })),
    });
    const { controller, ds, rowStore } = setup({ canEditCell }, { beforeCellsChange });
    const outcome = await controller.submit([nameChange("r1", "Asha", "A")], "edit");
    const sent = ds.calls.applyChanges.mock.calls[0]?.[0] as ChangeBatch;
    expect(sent.meta).toEqual({ reuploadDeadline: "2026-10-01" });
    expect(sent.changes[0]).toEqual({ rowId: "r1", columnId: "name", prev: "Asha", next: "A", meta: { decisionMessage: "x" } });
    expect(outcome.readOnly).toEqual([]);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.batch.meta).toEqual({ reuploadDeadline: "2026-10-01" });
    expect(rowStore.getRow("r1")?.cells.name).toBe("A");
    // canEditCell sees only the cell coordinates.
    expect(canEditCell).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), "name");
  });

  it("meta attached by the caller survives the send-time rebase", async () => {
    const { controller, ds } = setup();
    await controller.submit([nameChange("r1", "Asha", "A", { note: 1 })], "edit");
    const sent = ds.calls.applyChanges.mock.calls[0]?.[0] as ChangeBatch;
    expect(sent.changes[0]?.meta).toEqual({ note: 1 });
  });

  it("a meta-only change (next equals prev) is dropped: not sent, not rejected, no error", async () => {
    const onCellsChange = vi.fn();
    const { controller, ds, cellStatus } = setup({}, { onCellsChange });
    const outcome = await controller.submit([nameChange("r1", "Asha", "Asha", { decisionMessage: "x" })], "edit");
    expect(ds.calls.applyChanges).not.toHaveBeenCalled();
    expect(outcome.rejected).toEqual([]);
    expect(outcome.result.errors).toEqual([]);
    expect(outcome.result.applied).toEqual([]);
    expect(cellStatus.get("r1", "name").pending).toBe(false);
  });

  it("an overwrite re-submit after a conflict keeps the change's meta", async () => {
    const { controller, ds } = setup(
      {},
      {
        onConflict: (_conflict, resolve) => {
          void resolve("overwrite");
        },
      },
    );
    await ds.remoteEdit("r1", { name: "Remote" });
    await controller.submit([nameChange("r1", "Asha", "Mine", { decisionMessage: "keep" })], "edit");
    await new Promise((r) => setTimeout(r, 0));
    const calls = ds.calls.applyChanges.mock.calls.map((c) => c[0] as ChangeBatch);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.changes[0]).toMatchObject({ prev: "Remote", next: "Mine", meta: { decisionMessage: "keep" } });
  });
});
