import { describe, expect, it, vi } from "vitest";
import { cellKey, createCellStatusStore, parseCellKey } from "../../src/state/cellStatusStore";
import type { CellRef } from "../../src/state/cellStatusStore";

describe("cellKey / parseCellKey", () => {
  it("round-trips rowId and columnId", () => {
    const key = cellKey("r1", "name");
    expect(parseCellKey(key)).toEqual({ rowId: "r1", columnId: "name" });
  });

  it("keeps distinct rowId/columnId pairs from colliding", () => {
    const a = cellKey("r1", "name");
    const b = cellKey("r", "1:name");
    // Different logical cells must not collide even though naive concatenation might.
    expect(a).not.toBe(b);
  });
});

describe("createCellStatusStore", () => {
  it("returns a stable default object for unknown cells", () => {
    const store = createCellStatusStore();
    const a = store.get("r1", "name");
    const b = store.get("r1", "name");
    expect(a).toEqual({ pending: false, remoteChanged: false });
    expect(a).toBe(b);
  });

  it("pending set and clear round-trip", () => {
    const store = createCellStatusStore();
    const cell: CellRef = { rowId: "r1", columnId: "name" };

    store.setPending([cell]);
    expect(store.get("r1", "name").pending).toBe(true);

    store.clearPending([cell]);
    expect(store.get("r1", "name").pending).toBe(false);
  });

  it("an error message is stored and cleared on the next successful write", () => {
    const store = createCellStatusStore();
    const cell: CellRef = { rowId: "r1", columnId: "name" };

    store.setPending([cell]);
    store.setError(cell, "boom");
    expect(store.get("r1", "name").error).toBe("boom");

    // A subsequent successful write clears pending AND the prior error.
    store.clearPending([cell], { success: true });
    expect(store.get("r1", "name")).toEqual({ pending: false, remoteChanged: false });
  });

  it("clearPending without success:true leaves an existing error intact", () => {
    const store = createCellStatusStore();
    const cell: CellRef = { rowId: "r1", columnId: "name" };

    store.setPending([cell]);
    store.setError(cell, "boom");
    store.clearPending([cell]);

    expect(store.get("r1", "name").pending).toBe(false);
    expect(store.get("r1", "name").error).toBe("boom");
  });

  it("clearError removes only the error", () => {
    const store = createCellStatusStore();
    const cell: CellRef = { rowId: "r1", columnId: "name" };
    store.setError(cell, "boom");
    store.clearError(cell);
    expect(store.get("r1", "name").error).toBeUndefined();
  });

  it("remoteChanged survives clearPending", () => {
    const store = createCellStatusStore();
    const cell: CellRef = { rowId: "r1", columnId: "name" };

    store.setPending([cell]);
    store.markRemoteChanged(cell);
    store.clearPending([cell]);

    expect(store.get("r1", "name").pending).toBe(false);
    expect(store.get("r1", "name").remoteChanged).toBe(true);
  });

  it("clearRemoteChanged clears the flag", () => {
    const store = createCellStatusStore();
    const cell: CellRef = { rowId: "r1", columnId: "name" };
    store.markRemoteChanged(cell);
    store.clearRemoteChanged(cell);
    expect(store.get("r1", "name").remoteChanged).toBe(false);
  });

  it("the listener receives only the changed keys", () => {
    const store = createCellStatusStore();
    const listener = vi.fn();
    store.subscribeChanges(listener);

    store.setPending([
      { rowId: "r1", columnId: "a" },
      { rowId: "r1", columnId: "b" },
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    const keys = listener.mock.calls[0]?.[0] as string[];
    expect(new Set(keys)).toEqual(new Set([cellKey("r1", "a"), cellKey("r1", "b")]));
  });

  it("does not notify when a mutating call changes nothing", () => {
    const store = createCellStatusStore();
    const listener = vi.fn();
    const cell: CellRef = { rowId: "r1", columnId: "name" };

    store.clearPending([cell]); // was never pending -> no change
    expect(listener).not.toHaveBeenCalled();

    store.subscribeChanges(listener);
    store.clearPending([cell]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops notifications", () => {
    const store = createCellStatusStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeChanges(listener);
    unsubscribe();

    store.setPending([{ rowId: "r1", columnId: "name" }]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("clearAll resets state and version increments on mutation", () => {
    const store = createCellStatusStore();
    const v0 = store.version();
    store.setPending([{ rowId: "r1", columnId: "name" }]);
    expect(store.version()).toBeGreaterThan(v0);

    store.clearAll();
    expect(store.get("r1", "name")).toEqual({ pending: false, remoteChanged: false });
  });
});
