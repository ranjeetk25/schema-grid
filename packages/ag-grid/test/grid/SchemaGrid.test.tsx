import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAnnouncer, savedMessage, stripAnnouncementMarker } from "../../src/a11y/announcer";
import { LiveAnnouncer } from "../../src/a11y/LiveAnnouncer";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { AGENT, fixtureRows, fixtureSchema } from "../fixtures/schema";
import { renderGrid } from "../renderGrid";

function headerIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".ag-header-cell[col-id]")].map((el) => el.getAttribute("col-id") ?? "");
}

function cell(container: HTMLElement, rowId: string, colId: string): HTMLElement {
  const el = container.querySelector(`.ag-row[row-id="${rowId}"] [col-id="${colId}"]`);
  if (!el) throw new Error(`cell ${rowId}/${colId} not rendered`);
  return el as HTMLElement;
}

/** AG Grid only starts editing on a dblclick whose `detail` is 2 (a real browser sets it; fireEvent doesn't). */
function politeText(container: HTMLElement): string {
  const region = container.querySelector('[role="status"][aria-live="polite"]');
  return stripAnnouncementMarker(region?.textContent ?? "");
}

describe("createAnnouncer", () => {
  it("routes messages by politeness and notifies subscribers", () => {
    const a = createAnnouncer();
    const listener = vi.fn();
    const off = a.subscribe(listener);
    a.announce("Saved");
    a.announce("Conflict", "assertive");
    expect(stripAnnouncementMarker(a.getState().polite)).toBe("Saved");
    expect(stripAnnouncementMarker(a.getState().assertive)).toBe("Conflict");
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    a.announce("x");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("re-announces an identical message (text changes, marker stripped equals)", () => {
    const a = createAnnouncer();
    a.announce("Saved");
    const first = a.getState().polite;
    a.announce("Saved");
    const second = a.getState().polite;
    expect(second).not.toBe(first);
    expect(stripAnnouncementMarker(second)).toBe("Saved");
  });

  it("formats the saved message by cell count", () => {
    expect(savedMessage(1)).toBe("Saved");
    expect(savedMessage(3)).toBe("Saved 3 cells");
  });

  it("getState is a stable snapshot between announcements", () => {
    const a = createAnnouncer();
    expect(a.getState()).toBe(a.getState());
  });
});

describe("<LiveAnnouncer>", () => {
  it("renders polite and assertive regions that follow the announcer", () => {
    const a = createAnnouncer();
    const { container } = render(<LiveAnnouncer announcer={a} />);
    const polite = container.querySelector('[role="status"]');
    const assertive = container.querySelector('[role="alert"]');
    expect(polite?.getAttribute("aria-live")).toBe("polite");
    expect(polite?.getAttribute("aria-atomic")).toBe("true");
    expect(assertive?.getAttribute("aria-live")).toBe("assertive");
    act(() => a.announce("Hello"));
    expect(stripAnnouncementMarker(polite?.textContent ?? "")).toBe("Hello");
    act(() => a.announce("Oops", "assertive"));
    expect(stripAnnouncementMarker(assertive?.textContent ?? "")).toBe("Oops");
  });
});

describe("<SchemaGrid>", () => {
  it("renders an sg-root with headers for readable columns only", async () => {
    const { container, waitForRows } = renderGrid({ user: AGENT });
    await waitForRows();
    expect(container.querySelector(".sg-root")).not.toBeNull();
    const ids = headerIds(container);
    expect(ids).toContain("status");
    expect(ids).toContain("name");
    expect(ids).not.toContain("salary");
  });

  it("a read-only cell does not enter edit mode on double click", async () => {
    const { container, waitForRows, handle, settle } = renderGrid({ user: AGENT });
    await waitForRows();
    const target = cell(container, "r1", "status");
    fireEvent.doubleClick(target, { detail: 2 });
    await settle();
    expect(handle.current?.api()?.getEditingCells()).toEqual([]);
    expect(container.querySelector(".ag-cell-inline-editing")).toBeNull();
  });

  it("a text cell edit (dblclick → type → Enter) commits through dataSource.applyChanges and announces Saved", async () => {
    const { container, waitForRows, ds, handle } = renderGrid();
    await waitForRows();
    fireEvent.doubleClick(cell(container, "r1", "name"), { detail: 2 });
    let input: HTMLInputElement | null = null;
    await waitFor(() => {
      input = cell(container, "r1", "name").querySelector("input");
      expect(input).not.toBeNull();
    });
    const el = input as unknown as HTMLInputElement;
    fireEvent.change(el, { target: { value: "Zed" } });
    fireEvent.keyDown(el, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(ds.calls.applyChanges).toHaveBeenCalledTimes(1));
    const batch = ds.calls.applyChanges.mock.calls[0]?.[0] as { changes: { rowId: string; columnId: string; next: unknown }[] };
    expect(batch.changes).toEqual([expect.objectContaining({ rowId: "r1", columnId: "name", prev: "Asha", next: "Zed" })]);
    await waitFor(() => expect(cell(container, "r1", "name").textContent).toContain("Zed"));
    await waitFor(() => expect(politeText(container)).toBe("Saved"));
    expect(handle.current?.canUndo()).toBe(true);
  });

  it("exposes announce on the handle, routed to the live regions", async () => {
    const { container, waitForRows, handle } = renderGrid();
    await waitForRows();
    act(() => handle.current?.announce("Custom"));
    expect(politeText(container)).toBe("Custom");
    act(() => handle.current?.announce("Urgent", "assertive"));
    const assertive = container.querySelector('.sg-root [role="alert"][aria-live="assertive"]');
    expect(stripAnnouncementMarker(assertive?.textContent ?? "")).toBe("Urgent");
  });

  it("shows a load-error banner when loading fails", async () => {
    const failing = renderGrid({
      props: {
        dataSource: { ...createInMemoryDataSource(fixtureSchema, fixtureRows), fetch: () => Promise.reject(new Error("boom")) },
      },
    });
    await waitFor(() => expect(failing.container.querySelector(".sg-load-error")).not.toBeNull());
    const banner = failing.container.querySelector(".sg-load-error");
    expect(banner?.getAttribute("role")).toBe("alert");
    expect(banner?.textContent).toContain("boom");
  });

  it("exposes the imperative handle", async () => {
    const { waitForRows, handle } = renderGrid();
    await waitForRows();
    const h = handle.current;
    expect(h?.api()).not.toBeNull();
    expect(h?.canUndo()).toBe(false);
    expect(h?.canRedo()).toBe(false);
    expect(h?.captureView()).toMatchObject({ id: "default" });
    expect(h?.stores.rows.all()).toHaveLength(4);
    await act(() => h?.refetch() ?? Promise.resolve());
  });
});
