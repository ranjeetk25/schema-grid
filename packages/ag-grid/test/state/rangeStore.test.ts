import { describe, expect, it, vi } from "vitest";
import { createRangeStore } from "../../src/state/rangeStore";

describe("createRangeStore", () => {
  it("setAnchor resets focus", () => {
    const store = createRangeStore();
    store.setAnchor({ rowIndex: 1, colId: "a" });
    expect(store.get()).toEqual({
      anchor: { rowIndex: 1, colId: "a" },
      focus: { rowIndex: 1, colId: "a" },
    });

    store.setFocus({ rowIndex: 3, colId: "b" });
    expect(store.get()).toEqual({
      anchor: { rowIndex: 1, colId: "a" },
      focus: { rowIndex: 3, colId: "b" },
    });

    // setAnchor again resets focus back to the new anchor
    store.setAnchor({ rowIndex: 5, colId: "c" });
    expect(store.get()).toEqual({
      anchor: { rowIndex: 5, colId: "c" },
      focus: { rowIndex: 5, colId: "c" },
    });
  });

  it("setFocus with no anchor sets the anchor", () => {
    const store = createRangeStore();
    store.setFocus({ rowIndex: 2, colId: "b" });
    expect(store.get()).toEqual({
      anchor: { rowIndex: 2, colId: "b" },
      focus: { rowIndex: 2, colId: "b" },
    });
  });

  it("clear empties the range", () => {
    const store = createRangeStore();
    store.setAnchor({ rowIndex: 1, colId: "a" });
    store.clear();
    expect(store.get()).toBeNull();
  });

  it("tracks dragging and fillPreview", () => {
    const store = createRangeStore();
    expect(store.getState().dragging).toBe(false);
    expect(store.getState().fillPreview).toBeNull();

    store.setDragging(true);
    expect(store.getState().dragging).toBe(true);

    const preview = { rowStart: 0, rowEnd: 1, colIds: ["a"] };
    store.setFillPreview(preview);
    expect(store.getState().fillPreview).toEqual(preview);

    store.setFillPreview(null);
    expect(store.getState().fillPreview).toBeNull();
  });

  it("notifies subscribers on mutation", () => {
    const store = createRangeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setAnchor({ rowIndex: 0, colId: "a" });
    store.setFocus({ rowIndex: 1, colId: "a" });
    store.setDragging(true);
    store.clear();

    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    store.setDragging(false);
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
