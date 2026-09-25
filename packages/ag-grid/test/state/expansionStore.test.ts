import { describe, expect, it, vi } from "vitest";
import { createExpansionStore } from "../../src/state/expansionStore";

describe("createExpansionStore", () => {
  it("defaults to expanded", () => {
    const store = createExpansionStore();
    expect(store.isExpanded("g1")).toBe(true);
  });

  it("defaults to collapsed when configured", () => {
    const store = createExpansionStore({ defaultExpanded: false });
    expect(store.isExpanded("g1")).toBe(false);
  });

  it("toggle flips the current state", () => {
    const store = createExpansionStore();
    store.toggle("g1");
    expect(store.isExpanded("g1")).toBe(false);
    store.toggle("g1");
    expect(store.isExpanded("g1")).toBe(true);
  });

  it("setExpanded sets an explicit override", () => {
    const store = createExpansionStore({ defaultExpanded: true });
    store.setExpanded("g1", false);
    expect(store.isExpanded("g1")).toBe(false);
    expect(store.isExpanded("g2")).toBe(true);
  });

  it("expandAll resets overrides and sets the default", () => {
    const store = createExpansionStore({ defaultExpanded: true });
    store.setExpanded("g1", false);
    store.setExpanded("g2", false);
    store.expandAll(false);
    expect(store.isExpanded("g1")).toBe(false);
    expect(store.isExpanded("g2")).toBe(false);
    // overrides were reset, not just flipped: a fresh id follows the new default too
    expect(store.isExpanded("g3")).toBe(false);
    store.expandAll(true);
    expect(store.isExpanded("g1")).toBe(true);
    expect(store.isExpanded("g2")).toBe(true);
  });

  it("subscribe notifies listeners on change", () => {
    const store = createExpansionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.toggle("g1");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.toggle("g1");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
