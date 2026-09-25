import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, type vi } from "vitest";
import {
  conflictMessage,
  conflictsMessage,
  EDIT_CANCELLED,
  editRejectedMessage,
  editsRejectedMessage,
  fillMessage,
  pasteSummaryMessage,
  savedMessage,
  stripAnnouncementMarker,
} from "../../src/a11y/announcer";
import { pasteSummaryMessage as pasteSummaryFromClipboard } from "../../src/clipboard/useClipboard";
import { fillMessage as fillMessageFromFill } from "../../src/fill/useFillHandle";
import type { GridSchema } from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { AGENT, col, row } from "../fixtures/schema";
import { renderGrid, type RenderGridResult } from "../renderGrid";

type Clip = { readText: ReturnType<typeof vi.fn> };
const clip = (): Clip => navigator.clipboard as unknown as Clip;

function cellEl(g: RenderGridResult, rowId: string, colId: string): HTMLElement {
  const el = g.container.querySelector(`.ag-row[row-id="${rowId}"] [col-id="${colId}"]`);
  if (!el) throw new Error(`no cell ${rowId}/${colId}`);
  return el as HTMLElement;
}

function politeText(g: RenderGridResult): string {
  return stripAnnouncementMarker(g.container.querySelector(".sg-live-polite")?.textContent ?? "");
}

function assertiveText(g: RenderGridResult): string {
  return stripAnnouncementMarker(g.container.querySelector(".sg-live-assertive")?.textContent ?? "");
}

/** Starts editing (dblclick with detail 2) and returns the inline text input. */
async function startTextEdit(g: RenderGridResult, rowId: string, colId: string): Promise<HTMLInputElement> {
  fireEvent.doubleClick(cellEl(g, rowId, colId), { detail: 2 });
  let input: HTMLInputElement | null = null;
  await waitFor(() => {
    input = cellEl(g, rowId, colId).querySelector("input");
    expect(input).not.toBeNull();
  });
  return input as unknown as HTMLInputElement;
}

async function editAndCommit(g: RenderGridResult, rowId: string, colId: string, value: string): Promise<void> {
  const input = await startTextEdit(g, rowId, colId);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
}

describe("announcement builders", () => {
  it("use the standard wording", () => {
    expect(savedMessage(1)).toBe("Saved");
    expect(savedMessage(4)).toBe("Saved 4 cells");
    expect(conflictMessage("Name", "r1")).toBe("Conflict on Name, row r1");
    expect(conflictsMessage(3)).toBe("Conflicts on 3 cells");
    expect(editRejectedMessage("Score", "Must be positive")).toBe("Edit rejected on Score: Must be positive");
    expect(editsRejectedMessage(2)).toBe("2 edits rejected");
    expect(EDIT_CANCELLED).toBe("Edit cancelled");
    expect(pasteSummaryMessage({ pastedCells: 2, skippedReadOnly: 1, conflicts: 0, errors: [] })).toBe(
      "Paste: 2 pasted, 1 skipped, 0 errors",
    );
    expect(fillMessage(3, 1)).toBe("Fill: 3 cells filled, 1 read-only cell skipped");
  });

  it("the clipboard and fill modules re-export the same builders", () => {
    expect(pasteSummaryFromClipboard).toBe(pasteSummaryMessage);
    expect(fillMessageFromFill).toBe(fillMessage);
  });
});

describe("live-region announcements (integration)", () => {
  it("a committed edit announces Saved (polite)", async () => {
    const g = renderGrid();
    await g.waitForRows();
    await editAndCommit(g, "r1", "name", "Zed");
    await waitFor(() => expect(politeText(g)).toBe("Saved"));
  });

  it("a conflicting edit announces 'Conflict on {column}, row {id}' (assertive)", async () => {
    const g = renderGrid();
    await g.waitForRows();
    await act(async () => {
      await g.ds.remoteEdit("r1", { name: "Remote" });
    });
    await editAndCommit(g, "r1", "name", "Local");
    await waitFor(() => expect(assertiveText(g)).toBe("Conflict on Name, row r1"));
    expect(politeText(g)).not.toBe("Saved");
  });

  it("a server error announces the edit-rejected message (assertive)", async () => {
    const g = renderGrid();
    await g.waitForRows();
    g.ds.errorOn("r1", "name", "Too long");
    await editAndCommit(g, "r1", "name", "Zed");
    await waitFor(() => expect(assertiveText(g)).toBe("Edit rejected on Name: Too long"));
  });

  it("a beforeCellsChange veto announces Edit cancelled (assertive)", async () => {
    const g = renderGrid({ props: { events: { beforeCellsChange: () => false } } });
    await g.waitForRows();
    await editAndCommit(g, "r1", "name", "Zed");
    await waitFor(() => expect(assertiveText(g)).toBe("Edit cancelled"));
    expect(g.ds.calls.applyChanges).not.toHaveBeenCalled();
  });

  it("a paste announces the paste summary (polite) and nothing assertive", async () => {
    const g = renderGrid();
    await g.waitForRows();
    clip().readText.mockResolvedValue("X\tn1");
    act(() => {
      g.handle.current?.stores.range.setAnchor({ rowIndex: 0, colId: "name" });
      g.handle.current?.stores.range.setFocus({ rowIndex: 0, colId: "name" });
    });
    fireEvent.keyDown(cellEl(g, "r1", "name"), { key: "v", ctrlKey: true, metaKey: true });
    await waitFor(() => expect(politeText(g)).toBe("Paste: 2 pasted, 0 skipped, 0 errors"));
    expect(assertiveText(g)).toBe("");
  });
});

describe("editing keys (integration)", () => {
  it("Enter commits a text edit and moves focus down one row", async () => {
    const g = renderGrid();
    await g.waitForRows();
    act(() => g.handle.current?.api()?.setFocusedCell(0, "name"));
    await editAndCommit(g, "r1", "name", "Zed");
    await waitFor(() => expect(g.ds.calls.applyChanges).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(g.handle.current?.api()?.getFocusedCell()?.rowIndex).toBe(1));
    expect(g.handle.current?.api()?.getFocusedCell()?.column.getColId()).toBe("name");
    expect(g.handle.current?.api()?.getEditingCells()).toEqual([]);
  });

  it("Enter on a focused (not editing) editable cell starts editing it", async () => {
    // README keyboard table: "Enter / F2 / typing — start editing the focused editable cell".
    const g = renderGrid();
    await g.waitForRows();
    act(() => g.handle.current?.api()?.setFocusedCell(0, "name"));
    fireEvent.keyDown(cellEl(g, "r1", "name"), { key: "Enter", code: "Enter" });
    await waitFor(() =>
      expect(g.handle.current?.api()?.getEditingCells().map((c) => [c.rowIndex, c.column.getColId()])).toEqual([[0, "name"]]),
    );
    expect(g.handle.current?.api()?.getFocusedCell()?.rowIndex).toBe(0);
  });

  it("Esc cancels the edit and restores the value without writing", async () => {
    const g = renderGrid();
    await g.waitForRows();
    const input = await startTextEdit(g, "r1", "name");
    fireEvent.change(input, { target: { value: "Zed" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(g.handle.current?.api()?.getEditingCells()).toEqual([]));
    await g.settle();
    expect(g.ds.calls.applyChanges).not.toHaveBeenCalled();
    expect(cellEl(g, "r1", "name").textContent).toContain("Asha");
  });

  it("Tab commits and moves to the next EDITABLE cell (skips formula and read-only columns)", async () => {
    const schema: GridSchema = {
      id: "tab",
      schemaVersion: 1,
      columns: [
        col({ id: "name", type: "text", label: "Name" }, 0),
        col({ id: "total", type: "formula", label: "Total", formula: "1 + 1", config: { resultType: "number" } }, 1),
        col({ id: "status", type: "text", label: "Status", permissions: { read: "all", edit: { roles: ["admin"] } } }, 2),
        col({ id: "email", type: "email", label: "Email" }, 3),
      ],
    };
    const rows = [row("r1", { name: "Asha", status: "open", email: "a@x.io" }), row("r2", { name: "Bala" })];
    const ds = createInMemoryDataSource(schema, rows);
    const g = renderGrid({ user: AGENT, rows, ds, props: { schema } });
    await g.waitForRows(2);
    const input = await startTextEdit(g, "r1", "name");
    fireEvent.change(input, { target: { value: "Zed" } });
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });
    await waitFor(() => expect(g.ds.calls.applyChanges).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(g.handle.current?.api()?.getFocusedCell()?.column.getColId()).toBe("email"));
    expect(g.handle.current?.api()?.getFocusedCell()?.rowIndex).toBe(0);
  });

  it.todo("screen-reader output sanity for Saved / Conflict / Paste announcements (Playwright: see playwright-scenarios.md)");
  it.todo("Tab across a popup editor (longText / multiSelect) keeps focus in the grid (Playwright: see playwright-scenarios.md)");
});
