import { describe, expect, it, vi } from "vitest";
import { createQueryStore } from "../../src/state/queryStore";

describe("queryStore", () => {
  it("defaults to an empty query", () => {
    expect(createQueryStore().getState()).toEqual({ filter: null, sort: [], groupBy: [] });
  });

  it("accepts an initial state", () => {
    const s = createQueryStore({ search: "x", sort: [{ columnId: "a", dir: "asc" }] });
    expect(s.getState()).toEqual({ filter: null, sort: [{ columnId: "a", dir: "asc" }], groupBy: [], search: "x" });
  });

  it("setters update one slice and notify once", () => {
    const s = createQueryStore();
    const listener = vi.fn();
    s.subscribe(listener);
    s.setFilter({ columnId: "a", operator: "isEmpty" });
    s.setSort([{ columnId: "a", dir: "desc" }]);
    s.setGroupBy([{ columnId: "b" }]);
    s.setSearch("hi");
    expect(listener).toHaveBeenCalledTimes(4);
    expect(s.getState()).toEqual({
      filter: { columnId: "a", operator: "isEmpty" },
      sort: [{ columnId: "a", dir: "desc" }],
      groupBy: [{ columnId: "b" }],
      search: "hi",
    });
    s.setSearch("   ");
    expect(s.getState().search).toBeUndefined();
  });
});
