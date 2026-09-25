import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createStore, useStoreSelector } from "../../src/state/createStore";

describe("createStore", () => {
  it("listeners fire once per setState", () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState((s) => ({ count: s.count + 1 }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState()).toEqual({ count: 1 });
  });

  it("unsubscribe stops notifications", () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.setState((s) => ({ count: s.count + 1 }));

    expect(listener).not.toHaveBeenCalled();
  });

  it("setState accepts a plain value in addition to an updater", () => {
    const store = createStore({ count: 0 });
    store.setState({ count: 5 });
    expect(store.getState()).toEqual({ count: 5 });
  });
});

describe("useStoreSelector", () => {
  it("returns the selected slice and updates when it changes", () => {
    const store = createStore({ count: 0, other: "a" });
    const { result } = renderHook(() => useStoreSelector(store, (s) => s.count));

    expect(result.current).toBe(0);

    act(() => {
      store.setState((s) => ({ ...s, count: 1 }));
    });

    expect(result.current).toBe(1);
  });

  it("selector subscribers don't re-render when their slice is unchanged", () => {
    const store = createStore({ count: 0, other: "a" });
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useStoreSelector(store, (s) => s.count);
    });

    expect(renders).toBe(1);
    expect(result.current).toBe(0);

    act(() => {
      store.setState((s) => ({ ...s, other: "b" }));
    });

    // The selected slice (count) did not change, so no re-render should occur.
    expect(renders).toBe(1);
  });

  it("supports a custom isEqual comparator", () => {
    const store = createStore({ items: [1, 2, 3] });
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useStoreSelector(
        store,
        (s) => s.items,
        (a, b) => a.length === b.length,
      );
    });

    expect(renders).toBe(1);

    act(() => {
      store.setState((s) => ({ items: [...s.items] }));
    });

    // Same length -> isEqual says equal -> no re-render.
    expect(renders).toBe(1);
    expect(result.current).toEqual([1, 2, 3]);

    act(() => {
      store.setState((s) => ({ items: [...s.items, 4] }));
    });

    expect(renders).toBe(2);
  });
});
