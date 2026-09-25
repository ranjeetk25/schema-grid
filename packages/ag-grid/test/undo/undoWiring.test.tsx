import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { stripAnnouncementMarker } from "../../src/a11y/announcer";
import type { ChangeBatch, ChangeConflict, ConflictResolution } from "../../src/internal/core";
import { renderGrid, type RenderGridResult } from "../renderGrid";

function root(g: RenderGridResult): HTMLElement {
  const el = g.container.querySelector(".sg-root");
  if (!el) throw new Error("no .sg-root");
  return el as HTMLElement;
}

function cellEl(g: RenderGridResult, rowId: string, colId: string): HTMLElement {
  const el = g.container.querySelector(`.ag-row[row-id="${rowId}"] [col-id="${colId}"]`);
  if (!el) throw new Error(`no cell ${rowId}/${colId}`);
  return el as HTMLElement;
}

function select(g: RenderGridResult, anchor: [number, string], focus: [number, string] = anchor): void {
  const stores = g.handle.current?.stores;
  if (!stores) throw new Error("no stores");
  act(() => {
    stores.range.setAnchor({ rowIndex: anchor[0], colId: anchor[1] });
    stores.range.setFocus({ rowIndex: focus[0], colId: focus[1] });
  });
}

function politeText(g: RenderGridResult): string {
  return stripAnnouncementMarker(g.container.querySelector(".sg-live-polite")?.textContent ?? "");
}

function batches(g: RenderGridResult): ChangeBatch[] {
  return g.ds.calls.applyChanges.mock.calls.map((c) => c[0] as ChangeBatch);
}

const mod = (key: string, extra: Partial<KeyboardEventInit> = {}) => ({ key, ctrlKey: true, metaKey: true, ...extra });

async function editCell(g: RenderGridResult, rowId: string, colId: string, value: string): Promise<void> {
  fireEvent.doubleClick(cellEl(g, rowId, colId), { detail: 2 });
  let input: HTMLInputElement | null = null;
  await waitFor(() => {
    input = cellEl(g, rowId, colId).querySelector("input");
    expect(input).not.toBeNull();
  });
  fireEvent.change(input as unknown as HTMLInputElement, { target: { value } });
  fireEvent.keyDown(input as unknown as HTMLInputElement, { key: "Enter" });
  await waitFor(() => expect(g.handle.current?.api()?.getEditingCells()).toEqual([]));
}

describe("undo/redo keybindings", () => {
  it("edit, undo and redo change the value back and forth through applyChanges", async () => {
    const g = renderGrid();
    await g.waitForRows();

    await editCell(g, "r1", "name", "Zed");
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Zed"));
    expect(batches(g)).toHaveLength(1);
    expect(batches(g)[0]?.source).toBe("edit");

    fireEvent.keyDown(root(g), mod("z"));
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Asha"));
    expect(batches(g)).toHaveLength(2);
    expect(batches(g)[1]?.source).toBe("undo");
    await waitFor(() => expect(politeText(g)).toBe("Undone"));

    fireEvent.keyDown(root(g), mod("z", { shiftKey: true }));
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Zed"));
    expect(batches(g)).toHaveLength(3);
    expect(batches(g)[2]?.source).toBe("redo");
    await waitFor(() => expect(politeText(g)).toBe("Redone"));
  });

  it("Ctrl+Y also redoes", async () => {
    const g = renderGrid();
    await g.waitForRows();

    await editCell(g, "r1", "name", "Zed");
    fireEvent.keyDown(root(g), mod("z"));
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Asha"));

    fireEvent.keyDown(root(g), mod("y"));
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Zed"));
    await waitFor(() => expect(politeText(g)).toBe("Redone"));
  });

  it("announces 'Nothing to undo' when the stack is empty", async () => {
    const g = renderGrid();
    await g.waitForRows();

    fireEvent.keyDown(root(g), mod("z"));
    await waitFor(() => expect(politeText(g)).toBe("Nothing to undo"));
    expect(batches(g)).toHaveLength(0);
  });

  it("undo of a paste batch reverts all of its cells in one batch", async () => {
    const g = renderGrid();
    await g.waitForRows();

    const originalNotes = g.ds.rows().find((r) => r.id === "r1")?.cells.notes ?? null;
    select(g, [0, "name"]);

    // A real Ctrl+V, to exercise the same path other tests use (name + notes
    // are the two leading displayed columns, so this pastes 2 cells).
    (navigator.clipboard as unknown as { readText: ReturnType<typeof vi.fn> }).readText.mockResolvedValue(
      "Zed\tHello",
    );
    fireEvent.keyDown(cellEl(g, "r1", "name"), mod("v"));
    await waitFor(() => expect(batches(g)).toHaveLength(1));
    expect(batches(g)[0]?.source).toBe("paste");
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Zed"));
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.notes).toBe("Hello"));

    fireEvent.keyDown(root(g), mod("z"));
    await waitFor(() => expect(batches(g)).toHaveLength(2));
    const undoBatch = batches(g)[1];
    expect(undoBatch?.source).toBe("undo");
    expect(undoBatch?.changes).toHaveLength(2);
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Asha"));
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.notes ?? null).toBe(originalNotes));
  });

  it("Cmd+Z inside an editor doesn't trigger grid undo", async () => {
    const g = renderGrid();
    await g.waitForRows();

    await editCell(g, "r1", "name", "Zed");
    expect(batches(g)).toHaveLength(1);

    fireEvent.doubleClick(cellEl(g, "r2", "name"), { detail: 2 });
    let input: HTMLInputElement | null = null;
    await waitFor(() => {
      input = cellEl(g, "r2", "name").querySelector("input");
      expect(input).not.toBeNull();
    });
    fireEvent.keyDown(input as unknown as HTMLInputElement, mod("z"));
    // Undo must not have been triggered: still only the one 'edit' batch, no
    // 'undo' batch sent, and the editor is still open.
    expect(batches(g)).toHaveLength(1);
    expect(g.handle.current?.api()?.getEditingCells()).not.toEqual([]);
  });

  it("a conflict during undo goes through onConflict", async () => {
    const onConflict = vi.fn(
      (_conflict: ChangeConflict, resolve: (resolution: ConflictResolution) => Promise<void>) => {
        void resolve("keepTheirs");
      },
    );
    const g = renderGrid({ props: { events: { onConflict } } });
    await g.waitForRows();

    await editCell(g, "r1", "name", "Zed");
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Zed"));

    // Another user edits the same cell remotely before undo runs.
    await g.ds.remoteEdit("r1", { name: "Remote" });

    fireEvent.keyDown(root(g), mod("z"));
    await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
  });

  it("undo() and redo() are also exposed imperatively on the handle", async () => {
    const g = renderGrid();
    await g.waitForRows();

    await editCell(g, "r1", "name", "Zed");
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Zed"));

    expect(g.handle.current?.canUndo()).toBe(true);
    await act(async () => {
      await g.handle.current?.undo();
    });
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Asha"));

    expect(g.handle.current?.canRedo()).toBe(true);
    await act(async () => {
      await g.handle.current?.redo();
    });
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r1")?.cells.name).toBe("Zed"));
  });
});
