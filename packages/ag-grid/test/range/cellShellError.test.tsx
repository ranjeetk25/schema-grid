/**
 * v0.3.1: a save error is mirrored onto the cell element as a native `title`
 * (+ `data-sg-error`) by `CellShell`, and removed once the cell saves.
 */
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderGrid, type RenderGridResult } from "../renderGrid";

function cellEl(g: RenderGridResult, rowId: string, colId: string): HTMLElement {
  const el = g.container.querySelector<HTMLElement>(`.ag-row[row-id="${rowId}"] .ag-cell[col-id="${colId}"]`);
  if (!el) throw new Error(`no cell ${rowId}/${colId}`);
  return el;
}

async function editText(g: RenderGridResult, rowId: string, colId: string, value: string): Promise<void> {
  fireEvent.doubleClick(cellEl(g, rowId, colId), { detail: 2 });
  let input: HTMLInputElement | null = null;
  await waitFor(() => {
    input = cellEl(g, rowId, colId).querySelector("input");
    expect(input).not.toBeNull();
  });
  const el = input as unknown as HTMLInputElement;
  fireEvent.change(el, { target: { value } });
  fireEvent.keyDown(el, { key: "Enter", code: "Enter" });
}

describe("CellShell save-error tooltip (v0.3.1)", () => {
  it("puts the server's message in the cell's title while the error stands, and removes it after a successful save", async () => {
    const g = renderGrid();
    await g.waitForRows();
    const MESSAGE = "The student has not uploaded: Aadhaar card";
    g.ds.errorOn("r1", "name", MESSAGE);
    await editText(g, "r1", "name", "Zed");
    await waitFor(() => expect(cellEl(g, "r1", "name").getAttribute("title")).toBe(MESSAGE));
    const errored = cellEl(g, "r1", "name");
    expect(errored.hasAttribute("data-sg-error")).toBe(true);
    expect(errored.className).toContain("sg-cell-error");
    // Other cells are untouched.
    expect(cellEl(g, "r2", "name").hasAttribute("title")).toBe(false);
    expect(g.handle.current?.stores.cellStatus.get("r1", "name").error).toBe(MESSAGE);

    await editText(g, "r1", "name", "Zed again");
    await waitFor(() => expect(g.handle.current?.stores.cellStatus.get("r1", "name").error).toBeUndefined());
    await waitFor(() => {
      const el = cellEl(g, "r1", "name");
      expect(el.hasAttribute("title")).toBe(false);
      expect(el.hasAttribute("data-sg-error")).toBe(false);
    });
  });

  it("errors set directly on the status store show up too (no edit needed)", async () => {
    const g = renderGrid();
    await g.waitForRows();
    g.handle.current?.stores.cellStatus.setError({ rowId: "r2", columnId: "score" }, "Must be positive");
    await waitFor(() => expect(cellEl(g, "r2", "score").getAttribute("title")).toBe("Must be positive"));
    g.handle.current?.stores.cellStatus.clearError({ rowId: "r2", columnId: "score" });
    await waitFor(() => expect(cellEl(g, "r2", "score").hasAttribute("title")).toBe(false));
  });
});
