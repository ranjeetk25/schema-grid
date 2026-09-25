import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { stripAnnouncementMarker } from "../../src/a11y/announcer";
import type { ClipboardReport } from "../../src/clipboard/types";
import { pasteSummaryMessage } from "../../src/clipboard/useClipboard";
import { isEditableTarget } from "../../src/grid/keyboard";
import type { ChangeBatch, GridRow } from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { ADMIN, AGENT, fixtureRows, fixtureSchema } from "../fixtures/schema";
import { renderGrid, type RenderGridResult } from "../renderGrid";

type Clip = { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> };
const clip = (): Clip => navigator.clipboard as unknown as Clip;

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

function assertiveText(g: RenderGridResult): string {
  return stripAnnouncementMarker(g.container.querySelector(".sg-live-assertive")?.textContent ?? "");
}

const ctrl = (key: string) => ({ key, ctrlKey: true, metaKey: true });

async function setup(opts: Parameters<typeof renderGrid>[0] = {}) {
  const onClipboardReport = vi.fn<(r: ClipboardReport) => void>();
  const g = renderGrid({ ...opts, props: { onClipboardReport, ...opts.props } });
  await g.waitForRows();
  return { g, onClipboardReport };
}

function batches(g: RenderGridResult): ChangeBatch[] {
  return g.ds.calls.applyChanges.mock.calls.map((c) => c[0] as ChangeBatch);
}

describe("pasteSummaryMessage", () => {
  it("uses the T30 standard wording", () => {
    expect(pasteSummaryMessage({ pastedCells: 3, skippedReadOnly: 1, conflicts: 0, errors: [] })).toBe(
      "Paste: 3 pasted, 1 skipped, 0 errors",
    );
  });
});

describe("useClipboard (integration)", () => {
  it("Ctrl/Cmd+C writes the TSV of the range", async () => {
    const { g } = await setup();
    select(g, [0, "name"], [1, "score"]);
    // "handled-no-prevent": the native copy event may still fire; none does in jsdom → writeText fallback.
    const notPrevented = fireEvent.keyDown(cellEl(g, "r1", "name"), ctrl("c"));
    expect(notPrevented).toBe(true);
    await waitFor(() => expect(clip().writeText).toHaveBeenCalledTimes(1));
    expect(clip().writeText).toHaveBeenCalledWith("Asha\t\t10\nBala\t\t5");
  });

  it("copy with no range copies the focused cell", async () => {
    const { g } = await setup();
    act(() => g.handle.current?.api()?.setFocusedCell(1, "name"));
    act(() => g.handle.current?.stores.range.clear());
    fireEvent.keyDown(root(g), ctrl("c"));
    await waitFor(() => expect(clip().writeText).toHaveBeenCalledWith("Bala"));
  });

  it("Ctrl/Cmd+V reads the clipboard and submits exactly one 'paste' batch", async () => {
    const { g, onClipboardReport } = await setup();
    clip().readText.mockResolvedValue("X\tn1\nY\tn2");
    select(g, [0, "name"]);
    fireEvent.keyDown(cellEl(g, "r1", "name"), ctrl("v"));
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    expect(clip().readText).toHaveBeenCalledTimes(1);
    expect(batches(g)).toHaveLength(1);
    const batch = batches(g)[0];
    expect(batch?.source).toBe("paste");
    expect(batch?.changes.map((c) => [c.rowId, c.columnId, c.next])).toEqual([
      ["r1", "name", "X"],
      ["r1", "notes", "n1"],
      ["r2", "name", "Y"],
      ["r2", "notes", "n2"],
    ]);
    expect(onClipboardReport).toHaveBeenCalledWith({ pastedCells: 4, skippedReadOnly: 0, conflicts: 0, errors: [] });
    await waitFor(() => expect(g.ds.rows().find((r) => r.id === "r2")?.cells.name).toBe("Y"));
    await waitFor(() => expect(politeText(g)).toBe("Paste: 4 pasted, 0 skipped, 0 errors"));
  });

  it("reports skipped read-only cells", async () => {
    const { g, onClipboardReport } = await setup({ user: AGENT });
    clip().readText.mockResolvedValue("1\tX");
    // AGENT: total (formula) then status (read-only for agents) are the last two displayed columns.
    select(g, [0, "total"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    expect(onClipboardReport).toHaveBeenCalledWith({ pastedCells: 0, skippedReadOnly: 2, conflicts: 0, errors: [] });
    expect(batches(g)).toHaveLength(0);
    await waitFor(() => expect(politeText(g)).toBe("Paste: 0 pasted, 2 skipped, 0 errors"));
  });

  it("reports parse errors and marks them on the cell status store", async () => {
    const { g, onClipboardReport } = await setup();
    clip().readText.mockResolvedValue("abc\t5");
    select(g, [0, "score"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    const report = onClipboardReport.mock.calls[0]?.[0];
    expect(report?.pastedCells).toBe(1);
    expect(report?.skippedReadOnly).toBe(0);
    expect(report?.errors).toHaveLength(1);
    expect(report?.errors[0]).toMatchObject({ rowId: "r1", columnId: "score" });
    expect(g.handle.current?.stores.cellStatus.get("r1", "score").error).toBeTruthy();
    expect(batches(g)).toHaveLength(1);
    expect(batches(g)[0]?.changes).toEqual([{ rowId: "r1", columnId: "fee", prev: 1000, next: 5 }]);
  });

  it("with readText rejected, the paste event path still works (once)", async () => {
    const { g, onClipboardReport } = await setup();
    clip().readText.mockRejectedValue(new Error("denied"));
    select(g, [2, "name"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(clip().readText).toHaveBeenCalledTimes(1));
    await g.settle();
    expect(onClipboardReport).not.toHaveBeenCalled();
    const getData = vi.fn(() => "Zed");
    const notPrevented = fireEvent.paste(root(g), { clipboardData: { getData, types: ["text/plain"] } });
    expect(notPrevented).toBe(false);
    expect(getData).toHaveBeenCalledWith("text/plain");
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    await g.settle();
    expect(batches(g)).toHaveLength(1);
    expect(batches(g)[0]?.changes).toEqual([{ rowId: "r3", columnId: "name", prev: "Chitra", next: "Zed" }]);
  });

  it("a native paste right after the keydown wins over readText (no double paste)", async () => {
    const { g, onClipboardReport } = await setup();
    clip().readText.mockResolvedValue("FromRead");
    select(g, [0, "name"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    fireEvent.paste(root(g), { clipboardData: { getData: () => "FromEvent", types: ["text/plain"] } });
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    await g.settle();
    expect(batches(g)).toHaveLength(1);
    expect(batches(g)[0]?.changes[0]?.next).toBe("FromEvent");
    expect(clip().readText).not.toHaveBeenCalled();
  });

  it("without navigator.clipboard, the native copy event fills clipboardData", async () => {
    const { g } = await setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, writable: true, value: undefined });
    select(g, [0, "name"]);
    const notPrevented = fireEvent.keyDown(root(g), ctrl("c"));
    expect(notPrevented).toBe(true);
    const setData = vi.fn();
    const copyNotPrevented = fireEvent.copy(root(g), { clipboardData: { setData } });
    expect(copyNotPrevented).toBe(false);
    expect(setData).toHaveBeenCalledWith("text/plain", "Asha");
  });

  it("does nothing while a cell editor is open", async () => {
    const { g, onClipboardReport } = await setup();
    clip().readText.mockResolvedValue("Nope");
    select(g, [0, "name"]);
    fireEvent.doubleClick(cellEl(g, "r1", "name"), { detail: 2 });
    await waitFor(() => expect(g.handle.current?.api()?.getEditingCells().length).toBe(1));
    const input = cellEl(g, "r1", "name").querySelector("input") ?? cellEl(g, "r1", "name");
    fireEvent.keyDown(input, ctrl("c"));
    fireEvent.keyDown(input, ctrl("v"));
    const setData = vi.fn();
    fireEvent.copy(input, { clipboardData: { setData, getData: () => "Nope", types: ["text/plain"] } });
    fireEvent.paste(input, { clipboardData: { setData, getData: () => "Nope", types: ["text/plain"] } });
    await g.settle();
    expect(clip().writeText).not.toHaveBeenCalled();
    expect(clip().readText).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
    expect(onClipboardReport).not.toHaveBeenCalled();
    expect(batches(g)).toHaveLength(0);
  });

  it("creates a pending creatable-select option and submits its id", async () => {
    const onOptionCreate = vi.fn();
    const { g, onClipboardReport } = await setup({ props: { events: { onOptionCreate } } });
    clip().readText.mockResolvedValue("Referral\nReferral");
    select(g, [0, "source"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    expect(g.ds.calls.createOption).toHaveBeenCalledTimes(1);
    expect(g.ds.calls.createOption).toHaveBeenCalledWith("source", "Referral");
    const option = onOptionCreate.mock.calls[0]?.[1] as { id: string; label: string };
    expect(onOptionCreate).toHaveBeenCalledWith("source", expect.objectContaining({ label: "Referral" }));
    expect(option.id).not.toBe("Referral");
    expect(batches(g)).toHaveLength(1);
    expect(batches(g)[0]?.changes.map((c) => c.next)).toEqual([option.id, option.id]);
    expect(onClipboardReport).toHaveBeenCalledWith({ pastedCells: 2, skippedReadOnly: 0, conflicts: 0, errors: [] });
  });

  it("reports pending options as errors when the data source can't create options", async () => {
    const base = createInMemoryDataSource<GridRow>(fixtureSchema, fixtureRows);
    const ds = { ...base, createOption: undefined } as unknown as typeof base;
    const { g, onClipboardReport } = await setup({ ds, user: ADMIN });
    clip().readText.mockResolvedValue("Brand new");
    select(g, [0, "source"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    const report = onClipboardReport.mock.calls[0]?.[0];
    expect(report?.errors).toEqual([expect.objectContaining({ rowId: "r1", columnId: "source" })]);
    expect(report?.pastedCells).toBe(0);
    expect(g.handle.current?.stores.cellStatus.get("r1", "source").error).toBeTruthy();
    expect(batches(g)).toHaveLength(0);
  });

  it("a native copy event after the keydown wins; the writeText fallback is cancelled", async () => {
    const { g } = await setup();
    select(g, [0, "name"]);
    fireEvent.keyDown(root(g), ctrl("c"));
    const setData = vi.fn();
    expect(fireEvent.copy(root(g), { clipboardData: { setData } })).toBe(false);
    await g.settle();
    expect(setData).toHaveBeenCalledWith("text/plain", "Asha");
    expect(clip().writeText).not.toHaveBeenCalled();
  });

  it("takes a clipboard event delivered to <body> while the focused cell is inside the grid (capture listener)", async () => {
    const { g, onClipboardReport } = await setup();
    select(g, [1, "name"]);
    act(() => cellEl(g, "r2", "name").focus());
    expect(root(g).contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as Element, ctrl("v"));
    const rootListener = vi.fn();
    root(g).addEventListener("paste", rootListener);
    expect(fireEvent.paste(document.body, { clipboardData: { getData: () => "Body", types: ["text/plain"] } })).toBe(false);
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    expect(rootListener).not.toHaveBeenCalled();
    expect(clip().readText).not.toHaveBeenCalled();
    expect(batches(g)[0]?.changes).toEqual([{ rowId: "r2", columnId: "name", prev: "Bala", next: "Body" }]);
    // One-shot: a later body paste (no keystroke) is not taken.
    expect(fireEvent.paste(document.body, { clipboardData: { getData: () => "Again", types: ["text/plain"] } })).toBe(true);
  });

  it("prevents beforecopy / beforepaste on the root (enables the commands on non-editable content)", async () => {
    const { g } = await setup();
    for (const type of ["beforecopy", "beforepaste"]) {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      cellEl(g, "r1", "name").dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
  });

  it("announces 'Copy failed' when writeText rejects", async () => {
    const { g } = await setup();
    clip().writeText.mockRejectedValue(new Error("denied"));
    select(g, [0, "name"]);
    fireEvent.keyDown(root(g), ctrl("c"));
    await waitFor(() => expect(assertiveText(g)).toBe("Copy failed"));
  });

  it("ignores auto-repeat keydowns", async () => {
    const { g } = await setup();
    select(g, [0, "name"]);
    fireEvent.keyDown(root(g), { ...ctrl("c"), repeat: true });
    await g.settle();
    expect(clip().writeText).not.toHaveBeenCalled();
  });

  it("copy with no data rows in range writes nothing", async () => {
    const { g } = await setup();
    select(g, [50, "name"]);
    fireEvent.keyDown(root(g), ctrl("c"));
    const setData = vi.fn();
    fireEvent.copy(root(g), { clipboardData: { setData } });
    await g.settle();
    expect(setData).not.toHaveBeenCalled();
    expect(clip().writeText).not.toHaveBeenCalled();
  });

  it("a copy event with a text selection outside the cells is left to the browser", async () => {
    const { g } = await setup();
    select(g, [0, "name"]);
    const header = g.container.querySelector(".ag-header-cell-text");
    if (!header?.firstChild) throw new Error("no header text");
    const sel = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(header);
    sel?.removeAllRanges();
    sel?.addRange(range);
    const setData = vi.fn();
    expect(fireEvent.copy(root(g), { clipboardData: { setData } })).toBe(true);
    expect(setData).not.toHaveBeenCalled();
    sel?.removeAllRanges();
  });

  it.each([
    ["empty", ""],
    ["a lone newline", "\n"],
    ["CRLF only", "\r\n"],
  ])("pasting %s changes nothing and announces 'Nothing to paste'", async (_label, text) => {
    const { g, onClipboardReport } = await setup();
    clip().readText.mockResolvedValue(text);
    select(g, [0, "name"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(politeText(g)).toBe("Nothing to paste"));
    expect(onClipboardReport).not.toHaveBeenCalled();
    expect(batches(g)).toHaveLength(0);
  });

  it("an image-only paste event is left alone", async () => {
    const { g, onClipboardReport } = await setup();
    select(g, [0, "name"]);
    const getData = vi.fn(() => "");
    expect(fireEvent.paste(root(g), { clipboardData: { getData, types: ["Files"] } })).toBe(true);
    await g.settle();
    expect(getData).not.toHaveBeenCalled();
    expect(onClipboardReport).not.toHaveBeenCalled();
    expect(batches(g)).toHaveLength(0);
  });

  it("reports and announces conflicts", async () => {
    const { g, onClipboardReport } = await setup();
    await act(async () => {
      await g.ds.remoteEdit("r1", { name: "Theirs" });
    });
    clip().readText.mockResolvedValue("Mine");
    select(g, [0, "name"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    expect(onClipboardReport).toHaveBeenCalledWith({ pastedCells: 0, skippedReadOnly: 0, conflicts: 1, errors: [] });
    await waitFor(() => expect(politeText(g)).toBe("Paste: 0 pasted, 0 skipped, 0 errors, 1 conflicts"));
  });

  it("an unexpected failure logs and announces 'Paste failed'", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("boom");
    const { g, onClipboardReport } = await setup({
      props: {
        events: {
          beforeCellsChange: () => {
            throw boom;
          },
        },
      },
    });
    clip().readText.mockResolvedValue("X");
    select(g, [0, "name"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(assertiveText(g)).toBe("Paste failed"));
    expect(error).toHaveBeenCalledWith(boom);
    expect(onClipboardReport).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("creates distinct pending options concurrently; a throwing onOptionCreate doesn't abort the paste", async () => {
    const base = createInMemoryDataSource<GridRow>(fixtureSchema, fixtureRows);
    const resolvers: (() => void)[] = [];
    const createOption = vi.fn(
      (columnId: string, label: string) =>
        new Promise<{ id: string; label: string }>((resolve) => {
          resolvers.push(() => resolve({ id: `id-${label}`, label }));
          void columnId;
        }),
    );
    const ds = { ...base, createOption } as unknown as typeof base;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onOptionCreate = vi.fn(() => {
      throw new Error("consumer bug");
    });
    const { g, onClipboardReport } = await setup({ ds, props: { events: { onOptionCreate } } });
    clip().readText.mockResolvedValue("Alpha\nBeta\nAlpha");
    select(g, [0, "source"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(createOption).toHaveBeenCalledTimes(2));
    expect(resolvers).toHaveLength(2); // both in flight before either settled
    act(() => {
      for (const r of resolvers) r();
    });
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    expect(onOptionCreate).toHaveBeenCalledTimes(2);
    expect(batches(g)[0]?.changes.map((c) => c.next)).toEqual(["id-Alpha", "id-Beta", "id-Alpha"]);
    error.mockRestore();
  });

  it("stops after unmount while options are still being created", async () => {
    const base = createInMemoryDataSource<GridRow>(fixtureSchema, fixtureRows);
    let release: () => void = () => {};
    const createOption = vi.fn(
      (_columnId: string, label: string) =>
        new Promise<{ id: string; label: string }>((resolve) => {
          release = () => resolve({ id: `id-${label}`, label });
        }),
    );
    const ds = { ...base, createOption } as unknown as typeof base;
    const { g, onClipboardReport } = await setup({ ds });
    clip().readText.mockResolvedValue("Gamma");
    select(g, [0, "source"]);
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(createOption).toHaveBeenCalledTimes(1));
    g.unmount();
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(onClipboardReport).not.toHaveBeenCalled();
    expect(ds.calls.applyChanges).not.toHaveBeenCalled();
  });

  it.todo("real OS clipboard round-trip with Sheets-formatted text (Playwright: see playwright-scenarios.md)");
});

describe("isEditableTarget", () => {
  it("is true for text-like inputs, false for checkboxes and buttons", () => {
    const make = (html: string) => {
      const div = document.createElement("div");
      div.innerHTML = html;
      return div.firstElementChild as Element;
    };
    expect(isEditableTarget(make("<input type='text' />"))).toBe(true);
    expect(isEditableTarget(make("<input />"))).toBe(true);
    expect(isEditableTarget(make("<textarea></textarea>"))).toBe(true);
    expect(isEditableTarget(make("<input type='checkbox' />"))).toBe(false);
    expect(isEditableTarget(make("<input type='button' />"))).toBe(false);
  });
});
