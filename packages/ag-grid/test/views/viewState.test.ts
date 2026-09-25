import { describe, expect, it } from "vitest";
import type { Access, ViewDef } from "../../src/internal/core";
import { createExpansionStore } from "../../src/state/expansionStore";
import { createQueryStore } from "../../src/state/queryStore";
import { applyViewState, captureViewState } from "../../src/views/viewState";
import { createFakeGridApi } from "../fixtures/fakeGridApi";
import { col } from "../fixtures/schema";

function baseView(overrides: Partial<ViewDef> = {}): ViewDef {
  return {
    id: "v1",
    name: "Default",
    filter: null,
    sort: [],
    columnState: [],
    groupBy: [],
    pageSize: 50,
    ...overrides,
  };
}

describe("captureViewState", () => {
  it("captures column state in grid order, normalising pinned and skipping AG internal columns", () => {
    const { api } = createFakeGridApi({
      columns: [
        { colId: "ag-Grid-AutoColumn", hide: false, width: 40, pinned: null },
        { colId: "name", hide: false, width: 200, pinned: "left" },
        { colId: "score", hide: true, width: 120, pinned: null },
      ],
    });
    const query = createQueryStore({ filter: null, sort: [{ columnId: "name", dir: "asc" }], groupBy: [] });
    const view = captureViewState(api, { query }, baseView({ id: "v2", name: "My view", pageSize: 25 }));

    expect(view.id).toBe("v2");
    expect(view.name).toBe("My view");
    expect(view.pageSize).toBe(25);
    expect(view.sort).toEqual([{ columnId: "name", dir: "asc" }]);
    expect(view.columnState).toEqual([
      { id: "name", hidden: false, width: 200, pinned: "left", order: 0 },
      { id: "score", hidden: true, width: 120, pinned: null, order: 1 },
    ]);
    expect(view).not.toHaveProperty("search");
  });

  it("normalises pinned:true to left and omits search when undefined", () => {
    const { api } = createFakeGridApi({
      columns: [{ colId: "name", hide: false, width: 150, pinned: "left" }],
    });
    const query = createQueryStore();
    const view = captureViewState(api, { query }, baseView());
    expect(view.columnState[0]?.pinned).toBe("left");
    expect("search" in view).toBe(false);
  });

  it("includes search when the query store has one", () => {
    const { api } = createFakeGridApi({ columns: [{ colId: "name" }] });
    const query = createQueryStore({ search: "hello" });
    const view = captureViewState(api, { query }, baseView());
    expect(view.search).toBe("hello");
  });

  it("always records a width: grid width, else base view, else schema column width, else 200", () => {
    // A column state without widths (the fake grid api always reports one).
    const api = {
      getColumnState: () => [{ colId: "a" }, { colId: "b" }, { colId: "c" }, { colId: "d", width: 90 }],
    } as unknown as Parameters<typeof captureViewState>[0];
    const query = createQueryStore();
    const base = baseView({ columnState: [{ id: "b", hidden: false, width: 111, pinned: null, order: 0 }] });
    const view = captureViewState(api, { query }, base, {
      columns: [col({ id: "c", type: "text", width: 222 }), col({ id: "d", type: "text", width: 333 })],
    });
    expect(view.columnState.map((c) => [c.id, c.width])).toEqual([
      ["a", 200],
      ["b", 111],
      ["c", 222],
      ["d", 90],
    ]);
  });
});

describe("applyViewState", () => {
  it("round trips: capture -> apply -> capture is idempotent", () => {
    const { api } = createFakeGridApi({
      columns: [
        { colId: "name", hide: false, width: 200, pinned: null },
        { colId: "score", hide: false, width: 120, pinned: null },
      ],
    });
    const query = createQueryStore();
    const captured = captureViewState(api, { query }, baseView());

    // Mutate grid + store state so apply has something to restore.
    const query2 = createQueryStore({ filter: null, sort: [], groupBy: [] });
    applyViewState(api, captured, { query: query2 });
    const recaptured = captureViewState(api, { query: query2 }, baseView());

    expect(recaptured.columnState).toEqual(captured.columnState);
  });

  it("applies column order, hide, width, pinned and sort indicators via applyColumnState", () => {
    const { api, spies } = createFakeGridApi({
      columns: [
        { colId: "name", hide: false, width: 100, pinned: null },
        { colId: "score", hide: false, width: 100, pinned: null },
      ],
    });
    const query = createQueryStore();
    const view = baseView({
      sort: [{ columnId: "score", dir: "desc" }],
      columnState: [
        { id: "score", hidden: false, width: 150, pinned: "right", order: 0 },
        { id: "name", hidden: true, width: 80, pinned: null, order: 1 },
      ],
    });

    applyViewState(api, view, { query });

    expect(spies.applyColumnState).toHaveBeenCalledWith({
      applyOrder: true,
      state: [
        { colId: "score", hide: false, width: 150, pinned: "right", sort: "desc", sortIndex: 0 },
        { colId: "name", hide: true, width: 80, pinned: null, sort: null, sortIndex: null },
      ],
    });
    expect(query.getState().sort).toEqual([{ columnId: "score", dir: "desc" }]);
  });

  it("drops unknown or access-hidden columns from columnState/sort/groupBy/filter without throwing", () => {
    const { api, spies } = createFakeGridApi({
      columns: [
        { colId: "name", hide: false, width: 100, pinned: null },
        { colId: "score", hide: false, width: 100, pinned: null },
      ],
    });
    const query = createQueryStore();
    const access = new Map<string, Access>([
      ["name", "edit"],
      ["score", "hidden"],
    ]);
    const view = baseView({
      sort: [
        { columnId: "score", dir: "desc" },
        { columnId: "name", dir: "asc" },
        { columnId: "ghost", dir: "asc" },
      ],
      groupBy: [
        { columnId: "score" },
        { columnId: "name", aggregations: [{ columnId: "score", agg: "count" }, { columnId: "name", agg: "count" }] },
      ],
      filter: {
        op: "and",
        children: [
          { columnId: "score", operator: "eq", value: 1 },
          { columnId: "name", operator: "eq", value: "x" },
          { columnId: "ghost", operator: "eq", value: 2 },
        ],
      },
      columnState: [
        { id: "score", hidden: false, width: 150, pinned: null, order: 0 },
        { id: "name", hidden: false, width: 100, pinned: null, order: 1 },
        { id: "ghost", hidden: false, width: 100, pinned: null, order: 2 },
      ],
    });

    expect(() => applyViewState(api, view, { query }, { access })).not.toThrow();

    expect(spies.applyColumnState).toHaveBeenCalledWith({
      applyOrder: true,
      state: [{ colId: "name", hide: false, width: 100, pinned: null, sort: "asc", sortIndex: 0 }],
    });

    const state = query.getState();
    expect(state.sort).toEqual([{ columnId: "name", dir: "asc" }]);
    expect(state.groupBy).toEqual([{ columnId: "name", aggregations: [{ columnId: "name", agg: "count" }] }]);
    expect(state.filter).toEqual({ op: "and", children: [{ columnId: "name", operator: "eq", value: "x" }] });
  });

  it("collapses the filter to null when every condition references an unknown/hidden column", () => {
    const { api } = createFakeGridApi({ columns: [{ colId: "name" }] });
    const query = createQueryStore();
    const view = baseView({
      filter: {
        op: "and",
        children: [
          { columnId: "ghost", operator: "eq", value: 1 },
          { op: "or", children: [{ columnId: "ghost2", operator: "eq", value: 2 }] },
        ],
      },
    });

    applyViewState(api, view, { query });
    expect(query.getState().filter).toBeNull();
  });

  it("sends groupBy through to the store", () => {
    const { api } = createFakeGridApi({ columns: [{ colId: "name" }] });
    const query = createQueryStore();
    const view = baseView({ groupBy: [{ columnId: "name" }] });
    applyViewState(api, view, { query });
    expect(query.getState().groupBy).toEqual([{ columnId: "name" }]);
  });
});

describe("collapsedGroups", () => {
  it("captures collapsed group ids only while grouped and only when non-empty", () => {
    const { api } = createFakeGridApi({ columns: [{ colId: "payment" }] });
    const expansion = createExpansionStore();
    const ungrouped = createQueryStore();
    expansion.setExpanded("g:b", false);
    expect("collapsedGroups" in captureViewState(api, { query: ungrouped, expansion }, baseView())).toBe(false);

    const grouped = createQueryStore({ groupBy: [{ columnId: "payment" }] });
    const fresh = createExpansionStore();
    expect("collapsedGroups" in captureViewState(api, { query: grouped, expansion: fresh }, baseView())).toBe(false);
    fresh.setExpanded("g:b", false);
    fresh.setExpanded("g:a", false);
    fresh.setExpanded("g:c", true);
    expect(captureViewState(api, { query: grouped, expansion: fresh }, baseView()).collapsedGroups).toEqual(["g:a", "g:b"]);
  });

  it("applies collapsed ids over a fully expanded default", () => {
    const { api } = createFakeGridApi({ columns: [{ colId: "payment" }] });
    const query = createQueryStore();
    const expansion = createExpansionStore();
    expansion.setExpanded("stale", false);
    applyViewState(api, baseView({ groupBy: [{ columnId: "payment" }], collapsedGroups: ["g:x"] }), { query, expansion });
    expect(expansion.isExpanded("g:x")).toBe(false);
    expect(expansion.isExpanded("stale")).toBe(true);
    applyViewState(api, baseView({ groupBy: [{ columnId: "payment" }] }), { query, expansion });
    expect(expansion.isExpanded("g:x")).toBe(true);
  });
});
