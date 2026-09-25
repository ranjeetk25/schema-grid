import { describe, expect, it, vi } from "vitest";
import { createRowStore } from "../../src/state/rowStore";
import type { GridRow } from "../../src/internal/core";

function makeRow(id: string, cells: Record<string, unknown>, version = 1): GridRow {
  return { id, version, updatedAt: "2026-09-01T00:00:00.000Z", cells };
}

describe("createRowStore", () => {
  it("upsert replaces rows by id and bumps revision", () => {
    const store = createRowStore<GridRow>();
    const rev0 = store.getRevision();

    store.upsert([makeRow("r1", { name: "A" }), makeRow("r2", { name: "B" })]);
    expect(store.getRow("r1")?.cells).toEqual({ name: "A" });
    expect(store.getRevision()).toBeGreaterThan(rev0);

    const revAfterFirst = store.getRevision();
    store.upsert([makeRow("r1", { name: "A2" }, 2)]);
    expect(store.getRow("r1")?.cells).toEqual({ name: "A2" });
    expect(store.getRow("r1")?.version).toBe(2);
    expect(store.getRevision()).toBeGreaterThan(revAfterFirst);

    // r2 untouched
    expect(store.getRow("r2")?.cells).toEqual({ name: "B" });
  });

  it("keeps insertion order in all()", () => {
    const store = createRowStore<GridRow>();
    store.upsert([makeRow("b", {}), makeRow("a", {}), makeRow("c", {})]);
    expect(store.all().map((r) => r.id)).toEqual(["b", "a", "c"]);

    // Re-upserting an existing id keeps its original position.
    store.upsert([makeRow("a", { touched: true })]);
    expect(store.all().map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("patchCells merges and never mutates the previous row object (identity changes)", () => {
    const store = createRowStore<GridRow>();
    store.upsert([makeRow("r1", { name: "A", score: 1 })]);
    const before = store.getRow("r1");

    const patched = store.patchCells("r1", { score: 2 });

    expect(patched?.cells).toEqual({ name: "A", score: 2 });
    expect(store.getRow("r1")).not.toBe(before);
    expect(store.getRow("r1")?.cells).not.toBe(before?.cells);
    // original object untouched
    expect(before?.cells).toEqual({ name: "A", score: 1 });
  });

  it("patchCells accepts an explicit version", () => {
    const store = createRowStore<GridRow>();
    store.upsert([makeRow("r1", { name: "A" }, 1)]);
    store.patchCells("r1", { name: "B" }, 5);
    expect(store.getRow("r1")?.version).toBe(5);
  });

  it("patchCells on an unknown row is a no-op returning undefined", () => {
    const store = createRowStore<GridRow>();
    expect(store.patchCells("missing", { a: 1 })).toBeUndefined();
  });

  it("remove deletes", () => {
    const store = createRowStore<GridRow>();
    store.upsert([makeRow("r1", {}), makeRow("r2", {})]);
    store.remove(["r1"]);
    expect(store.getRow("r1")).toBeUndefined();
    expect(store.getRow("r2")).toBeDefined();
    expect(store.all().map((r) => r.id)).toEqual(["r2"]);
  });

  it("getVersion returns undefined for unknown ids", () => {
    const store = createRowStore<GridRow>();
    expect(store.getVersion("nope")).toBeUndefined();
    store.upsert([makeRow("r1", {}, 3)]);
    expect(store.getVersion("r1")).toBe(3);
  });

  it("subscribe notifies on upsert, patchCells and remove", () => {
    const store = createRowStore<GridRow>();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.upsert([makeRow("r1", {})]);
    store.patchCells("r1", { a: 1 });
    store.remove(["r1"]);

    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    store.upsert([makeRow("r2", {})]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  describe("notInView flag", () => {
    it("setNotInView / isNotInView / clearNotInView", () => {
      const store = createRowStore<GridRow>();
      store.upsert([makeRow("r1", {}), makeRow("r2", {})]);

      expect(store.isNotInView("r1")).toBe(false);

      store.setNotInView(["r1", "r2"], true);
      expect(store.isNotInView("r1")).toBe(true);
      expect(store.isNotInView("r2")).toBe(true);

      store.setNotInView(["r1"], false);
      expect(store.isNotInView("r1")).toBe(false);
      expect(store.isNotInView("r2")).toBe(true);

      store.clearNotInView();
      expect(store.isNotInView("r2")).toBe(false);
    });

    it("notifies subscribers when notInView flags change", () => {
      const store = createRowStore<GridRow>();
      const listener = vi.fn();
      store.subscribe(listener);

      store.setNotInView(["r1"], true);
      expect(listener).toHaveBeenCalledTimes(1);

      store.clearNotInView();
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });
  it("upsert skips incoming rows older than the stored version unless forced", () => {
    const store = createRowStore<GridRow>();
    store.upsert([makeRow("r1", { name: "new" }, 3)]);
    const rev = store.getRevision();
    store.upsert([makeRow("r1", { name: "stale" }, 2)]);
    expect(store.getRow("r1")?.cells).toEqual({ name: "new" });
    expect(store.getRevision()).toBe(rev);

    store.upsert([makeRow("r1", { name: "same-version" }, 3)]);
    expect(store.getRow("r1")?.cells).toEqual({ name: "same-version" });

    store.upsert([makeRow("r1", { name: "forced" }, 1)], { force: true });
    expect(store.getRow("r1")?.cells).toEqual({ name: "forced" });
    expect(store.getVersion("r1")).toBe(1);
  });
});
