import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChangeConflict, ConflictResolution, GridRow } from "../../src/internal/core";
import { renderGrid } from "../renderGrid";

function cell(container: HTMLElement, rowId: string, colId: string): HTMLElement {
  const el = container.querySelector(`.ag-row[row-id="${rowId}"] [col-id="${colId}"]`);
  if (!el) throw new Error(`cell ${rowId}/${colId} not rendered`);
  return el as HTMLElement;
}

function rowEl(container: HTMLElement, rowId: string): HTMLElement | null {
  return container.querySelector(`.ag-row[row-id="${rowId}"]`);
}

const POLL = { intervalMs: 15, enabled: true };

async function startEditing(container: HTMLElement, rowId: string, colId: string): Promise<HTMLInputElement> {
  fireEvent.doubleClick(cell(container, rowId, colId), { detail: 2 });
  let input: HTMLInputElement | null = null;
  await waitFor(() => {
    input = cell(container, rowId, colId).querySelector("input");
    expect(input).not.toBeNull();
  });
  return input as unknown as HTMLInputElement;
}

describe("polling wiring (<SchemaGrid poll>)", () => {
  it("applies a remote edit: new value shown, exact cell flashed, onRemoteChanges emitted", async () => {
    const onRemoteChanges = vi.fn();
    const { container, ds, handle, waitForRows } = renderGrid({ props: { poll: POLL, events: { onRemoteChanges } } });
    await waitForRows();
    const api = handle.current?.api();
    if (!api) throw new Error("no api");
    const flash = vi.spyOn(api, "flashCells");

    await ds.remoteEdit("r2", { name: "Remote" });
    await waitFor(() => expect(cell(container, "r2", "name").textContent).toContain("Remote"));
    await waitFor(() => expect(flash).toHaveBeenCalled());
    const args = flash.mock.calls.map((c) => c[0] as { rowNodes: { id?: string }[]; columns: string[] });
    expect(args.some((a) => a.rowNodes.map((n) => n.id).join() === "r2" && a.columns.join() === "name")).toBe(true);
    expect(onRemoteChanges).toHaveBeenCalled();
  });

  it("keeps a remotely updated row that no longer matches the view, styled notInView; refetch clears it", async () => {
    const { container, ds, handle, waitForRows } = renderGrid({
      props: {
        poll: POLL,
        view: {
          id: "v",
          name: "v",
          filter: { columnId: "status", operator: "is", value: "open" },
          sort: [],
          columnState: [],
          groupBy: [],
          pageSize: 100,
        },
      },
    });
    const openCount = ds.rows().filter((r) => r.cells.status === "open").length;
    await waitForRows(openCount);
    await ds.remoteEdit("r1", { status: "closed" });
    await waitFor(() => expect(handle.current?.stores.rows.getRow("r1")?.cells.status).toBe("closed"));
    await waitFor(() => expect(rowEl(container, "r1")?.classList.contains("sg-row-not-in-view")).toBe(true));

    await handle.current?.refetch();
    await waitFor(() => expect(rowEl(container, "r1")).toBeNull());
    expect(handle.current?.stores.rows.isNotInView("r1")).toBe(false);
  });

  it("emits onSchemaChanged once when the feed reports a new schema version", async () => {
    const onSchemaChanged = vi.fn();
    const { ds, waitForRows, settle } = renderGrid({ props: { poll: POLL, events: { onSchemaChanged } } });
    await waitForRows();
    ds.bumpSchemaVersion();
    await waitFor(() => expect(onSchemaChanged).toHaveBeenCalledWith(2));
    await settle(80);
    expect(onSchemaChanged).toHaveBeenCalledTimes(1);
  });

  it("defers a remote change to the cell being edited; applies it when editing stops (cancel)", async () => {
    const { container, ds, waitForRows } = renderGrid({ props: { poll: POLL } });
    await waitForRows();
    const input = await startEditing(container, "r1", "name");
    const polls = ds.calls.getChanges.mock.calls.length;
    await ds.remoteEdit("r1", { name: "Theirs" });
    await waitFor(() => expect(ds.calls.getChanges.mock.calls.length).toBeGreaterThan(polls + 1));
    await waitFor(() => expect(cell(container, "r1", "name").classList.contains("sg-cell-remote-changed")).toBe(true));
    expect(ds.calls.applyChanges).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(cell(container, "r1", "name").textContent).toContain("Theirs"));
    expect(cell(container, "r1", "name").classList.contains("sg-cell-remote-changed")).toBe(false);
  });

  it("a later commit on a remoteChanged cell yields a conflict through onConflict", async () => {
    const conflicts: ChangeConflict[] = [];
    const onConflict = vi.fn((c: ChangeConflict, resolve: (r: ConflictResolution) => Promise<void>) => {
      conflicts.push(c);
      void resolve("keepTheirs");
    });
    const { container, ds, handle, waitForRows } = renderGrid({ props: { poll: POLL, events: { onConflict } } });
    await waitForRows();
    const input = await startEditing(container, "r1", "name");
    const polls = ds.calls.getChanges.mock.calls.length;
    await ds.remoteEdit("r1", { name: "Theirs" });
    await waitFor(() => expect(ds.calls.getChanges.mock.calls.length).toBeGreaterThan(polls + 1));
    await waitFor(() => expect(cell(container, "r1", "name").classList.contains("sg-cell-remote-changed")).toBe(true));

    fireEvent.change(input, { target: { value: "Mine" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(conflicts[0]).toEqual(expect.objectContaining({ rowId: "r1", columnId: "name" }));
    await waitFor(() => expect(cell(container, "r1", "name").textContent).toContain("Theirs"));
    const r1 = handle.current?.stores.rows.getRow("r1") as GridRow;
    expect(r1.version).toBe(ds.rows().find((r) => r.id === "r1")?.version);
  });
});
