/**
 * v0.3.1: refreshed rows after a save (`ChangeResult.rows` / `getRows`),
 * and conflict overwrites re-submitted with `resubmitOf` + the original `meta`.
 */
import { describe, expect, it, vi } from "vitest";
import { createEditController, type EditControllerOptions } from "../../src/editing/editController";
import { createCellStatusStore } from "../../src/state/cellStatusStore";
import { createRowStore } from "../../src/state/rowStore";
import type { CellChange, ChangeBatch, ChangeResult, ConflictResolution, GridRow, SchemaGridEvents } from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { fixtureRows, fixtureSchema } from "../fixtures/schema";

function setup(overrides: Partial<EditControllerOptions<GridRow>> = {}, events: SchemaGridEvents<GridRow> = {}) {
  const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
  const rowStore = createRowStore<GridRow>();
  rowStore.upsert(structuredClone(fixtureRows));
  const cellStatus = createCellStatusStore();
  const upsertRows = vi.fn((rows: GridRow[]) => rowStore.upsert(rows));
  let n = 0;
  const controller = createEditController<GridRow>({
    dataSource: ds,
    schema: fixtureSchema,
    rowStore,
    cellStatus,
    events,
    upsertRows,
    idFactory: () => `b${++n}`,
    ...overrides,
  });
  return { ds, rowStore, cellStatus, controller, upsertRows };
}

const nameChange = (rowId: string, prev: unknown, next: unknown): CellChange => ({ rowId, columnId: "name", prev, next });
const flush = () => new Promise((r) => setTimeout(r, 0));
const AT = "2026-09-24T21:00:00.000Z";

/** Applies every change, reports version 5 and — unless `rows` is false — a refreshed row with a derived `total`. */
function sourceWithoutRows(getRows?: (ids: string[]) => Promise<GridRow[]>) {
  const applyChanges = vi.fn(
    async (batch: ChangeBatch): Promise<ChangeResult> => ({
      applied: batch.changes,
      conflicts: [],
      errors: [],
      versions: Object.fromEntries(batch.changes.map((c) => [c.rowId, 5])),
    }),
  );
  return getRows ? { applyChanges, getRows } : { applyChanges };
}

describe("refreshed rows after a save (v0.3.1)", () => {
  it("(i) `result.rows` present: the rows are upserted before onApplied, derived cells and versions come from the server", async () => {
    const onApplied = vi.fn();
    const refreshed: GridRow = { id: "r1", version: 9, updatedAt: AT, cells: { name: "Zed", score: 10, total: 999 } };
    const applyChanges = vi.fn(
      async (batch: ChangeBatch): Promise<ChangeResult> => ({
        applied: batch.changes,
        conflicts: [],
        errors: [],
        versions: { r1: 9 },
        rows: [refreshed],
      }),
    );
    const getRows = vi.fn(async () => [refreshed]);
    const { controller, rowStore, upsertRows } = setup({ dataSource: { applyChanges, getRows }, refetchAfterSave: true, onApplied });
    await controller.submit([nameChange("r1", "Asha", "Zed")], "edit");
    expect(upsertRows).toHaveBeenCalledTimes(1);
    expect(upsertRows).toHaveBeenCalledWith([refreshed]);
    // `rows` wins: no getRows round trip even with refetchAfterSave.
    expect(getRows).not.toHaveBeenCalled();
    expect(rowStore.getRow("r1")?.cells.total).toBe(999);
    expect(rowStore.getVersion("r1")).toBe(9);
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied.mock.calls[0]?.[0]).toMatchObject({ changedRowIds: ["r1"], refreshedRowIds: ["r1"] });
    // upsert happened BEFORE onApplied.
    expect(upsertRows.mock.invocationCallOrder[0]).toBeLessThan(onApplied.mock.invocationCallOrder[0] as number);
  });

  it("(ii) rows absent + refetchAfterSave: getRows is called once with the changed row ids and the store is updated", async () => {
    const getRows = vi.fn(
      async (ids: string[]): Promise<GridRow[]> => ids.map((id) => ({ id, version: 5, updatedAt: AT, cells: { name: `server-${id}`, total: 42 } })),
    );
    const onApplied = vi.fn();
    const { controller, rowStore, upsertRows } = setup({ dataSource: sourceWithoutRows(getRows), refetchAfterSave: true, onApplied });
    await controller.submit([nameChange("r1", "Asha", "A"), nameChange("r2", "Bala", "B"), nameChange("r1", "A", "AA")], "paste");
    expect(getRows).toHaveBeenCalledTimes(1);
    expect(getRows).toHaveBeenCalledWith(["r1", "r2"]);
    expect(upsertRows).toHaveBeenCalledTimes(1);
    expect(rowStore.getRow("r1")?.cells.total).toBe(42);
    expect(rowStore.getRow("r2")?.cells.name).toBe("server-r2");
    expect(onApplied.mock.calls[0]?.[0]).toMatchObject({ refreshedRowIds: ["r1", "r2"] });
  });

  it("(iii) rows absent, refetchAfterSave off (default): getRows is never called", async () => {
    const getRows = vi.fn(async () => []);
    const onApplied = vi.fn();
    const { controller, upsertRows } = setup({ dataSource: sourceWithoutRows(getRows), onApplied });
    await controller.submit([nameChange("r1", "Asha", "A")], "edit");
    expect(getRows).not.toHaveBeenCalled();
    expect(upsertRows).not.toHaveBeenCalled();
    expect(onApplied.mock.calls[0]?.[0]).toMatchObject({ refreshedRowIds: [] });
  });

  it("a source without getRows and no rows: nothing to refresh, the save still succeeds", async () => {
    const { controller, upsertRows } = setup({ dataSource: sourceWithoutRows(), refetchAfterSave: true });
    const outcome = await controller.submit([nameChange("r1", "Asha", "A")], "edit");
    expect(outcome.result.applied).toHaveLength(1);
    expect(upsertRows).not.toHaveBeenCalled();
  });

  it("a failing getRows is swallowed: the save already succeeded", async () => {
    const getRows = vi.fn(async () => {
      throw new Error("offline");
    });
    const onCellsChange = vi.fn();
    const { controller, rowStore, cellStatus } = setup({ dataSource: sourceWithoutRows(getRows), refetchAfterSave: true }, { onCellsChange });
    const outcome = await controller.submit([nameChange("r1", "Asha", "A")], "edit");
    expect(outcome.result.applied).toHaveLength(1);
    expect(outcome.result.errors).toEqual([]);
    expect(rowStore.getRow("r1")?.cells.name).toBe("A");
    expect(cellStatus.get("r1", "name")).toEqual({ pending: false, remoteChanged: false });
    expect(onCellsChange).toHaveBeenCalledTimes(1);
  });

  it("nothing applied → no refresh", async () => {
    const getRows = vi.fn(async () => []);
    const applyChanges = vi.fn(
      async (batch: ChangeBatch): Promise<ChangeResult> => ({
        applied: [],
        conflicts: [],
        errors: batch.changes.map((c) => ({ rowId: c.rowId, columnId: c.columnId, message: "no" })),
      }),
    );
    const { controller, upsertRows } = setup({ dataSource: { applyChanges, getRows }, refetchAfterSave: true });
    await controller.submit([nameChange("r1", "Asha", "A")], "edit");
    expect(getRows).not.toHaveBeenCalled();
    expect(upsertRows).not.toHaveBeenCalled();
  });
});

describe("submit options + conflict overwrite re-submits (v0.3.1)", () => {
  it("submit(changes, source, { resubmitOf, meta }) puts both on the batch", async () => {
    const { controller, ds } = setup();
    const outcome = await controller.submit([nameChange("r1", "Asha", "A")], "edit", { resubmitOf: "orig", meta: { why: "retry" } });
    expect(outcome.batch.resubmitOf).toBe("orig");
    expect(outcome.batch.meta).toEqual({ why: "retry" });
    expect(ds.calls.applyChanges).toHaveBeenCalledWith(expect.objectContaining({ resubmitOf: "orig", meta: { why: "retry" } }));
    expect(controller.buildBatch([], "edit").resubmitOf).toBeUndefined();
  });

  it("an overwrite re-submits with resubmitOf = the original batch id and the original batch meta", async () => {
    const resolvers: ((r: ConflictResolution) => Promise<void>)[] = [];
    const sent: ChangeBatch[] = [];
    let first = true;
    const applyChanges = vi.fn(async (batch: ChangeBatch): Promise<ChangeResult> => {
      sent.push(batch);
      if (first) {
        first = false;
        return {
          applied: [],
          errors: [],
          conflicts: batch.changes.map((c) => ({
            rowId: c.rowId,
            columnId: c.columnId,
            serverValue: "Theirs",
            serverVersion: 3,
            updatedAt: "2026-09-24T21:00:00.000Z",
          })),
        };
      }
      return { applied: batch.changes, conflicts: [], errors: [], versions: { [batch.changes[0]?.rowId ?? ""]: 4 } };
    });
    const beforeCellsChange = vi.fn((b: ChangeBatch): ChangeBatch => ({ ...b, meta: { decisionMessage: "approved" } }));
    const { controller } = setup(
      { dataSource: { applyChanges } },
      { beforeCellsChange, onConflict: (_c, resolve) => resolvers.push(resolve) },
    );
    await controller.submit([{ rowId: "r1", columnId: "name", prev: "Asha", next: "Mine", meta: { cell: 1 } }], "edit");
    expect(resolvers).toHaveLength(1);
    // The host hook returns no meta the second time: what travels is the ORIGINAL batch's meta.
    beforeCellsChange.mockImplementation((b: ChangeBatch) => b);
    await resolvers[0]?.("overwrite");
    await flush();
    expect(sent).toHaveLength(2);
    const [original, resubmit] = sent as [ChangeBatch, ChangeBatch];
    expect(original.resubmitOf).toBeUndefined();
    expect(resubmit.resubmitOf).toBe(original.id);
    expect(resubmit.id).not.toBe(original.id);
    expect(resubmit.meta).toEqual({ decisionMessage: "approved" });
    expect(resubmit.changes[0]).toMatchObject({ rowId: "r1", columnId: "name", prev: "Theirs", next: "Mine", meta: { cell: 1 } });
    // The re-submit went through the full pipeline (beforeCellsChange saw it, with resubmitOf set).
    expect(beforeCellsChange).toHaveBeenCalledTimes(2);
    expect((beforeCellsChange.mock.calls[1]?.[0] as ChangeBatch).resubmitOf).toBe(original.id);
  });

  it("overwrites from DIFFERENT original batches on the same row are not merged into one re-submit", async () => {
    const resolvers: ((r: ConflictResolution) => Promise<void>)[] = [];
    const sent: ChangeBatch[] = [];
    let conflicts = 2;
    const applyChanges = vi.fn(async (batch: ChangeBatch): Promise<ChangeResult> => {
      sent.push(batch);
      if (conflicts > 0) {
        conflicts -= 1;
        return {
          applied: [],
          errors: [],
          conflicts: batch.changes.map((c) => ({
            rowId: c.rowId,
            columnId: c.columnId,
            serverValue: "Theirs",
            serverVersion: 3,
            updatedAt: "2026-09-24T21:00:00.000Z",
          })),
        };
      }
      return { applied: batch.changes, conflicts: [], errors: [] };
    });
    const { controller } = setup({ dataSource: { applyChanges } }, { onConflict: (_c, resolve) => resolvers.push(resolve) });
    await controller.submit([nameChange("r1", "Asha", "One")], "edit");
    await controller.submit([{ rowId: "r1", columnId: "score", prev: 10, next: 11 }], "edit");
    expect(resolvers).toHaveLength(2);
    const [a, b] = sent as [ChangeBatch, ChangeBatch];
    await Promise.all([resolvers[0]?.("overwrite"), resolvers[1]?.("overwrite")]);
    await flush();
    const resubmits = sent.slice(2);
    expect(resubmits).toHaveLength(2);
    expect(resubmits.map((r) => r.resubmitOf).sort()).toEqual([a.id, b.id].sort());
    expect(resubmits.every((r) => r.changes.length === 1)).toBe(true);
  });

  it("overwrites for the same original batch, row and source are still coalesced into one re-submit", async () => {
    const resolvers: ((r: ConflictResolution) => Promise<void>)[] = [];
    const sent: ChangeBatch[] = [];
    let first = true;
    const applyChanges = vi.fn(async (batch: ChangeBatch): Promise<ChangeResult> => {
      sent.push(batch);
      if (first) {
        first = false;
        return {
          applied: [],
          errors: [],
          conflicts: batch.changes.map((c) => ({
            rowId: c.rowId,
            columnId: c.columnId,
            serverValue: "Theirs",
            serverVersion: 3,
            updatedAt: "2026-09-24T21:00:00.000Z",
          })),
        };
      }
      return { applied: batch.changes, conflicts: [], errors: [] };
    });
    const { controller } = setup({ dataSource: { applyChanges } }, { onConflict: (_c, resolve) => resolvers.push(resolve) });
    await controller.submit([nameChange("r1", "Asha", "One"), { rowId: "r1", columnId: "score", prev: 10, next: 11 }], "paste");
    expect(resolvers).toHaveLength(2);
    await Promise.all(resolvers.map((r) => r("overwrite")));
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.changes).toHaveLength(2);
    expect(sent[1]?.resubmitOf).toBe(sent[0]?.id);
  });
});
