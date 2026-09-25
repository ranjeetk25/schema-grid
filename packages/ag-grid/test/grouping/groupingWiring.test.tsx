import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  DataSource,
  FilterCondition,
  FilterNode,
  GridQuery,
  GridRow,
  GroupResult,
  QueryResult,
  ViewDef,
} from "../../src/internal/core";
import { createDefaultRegistry, isFilterGroup } from "../../src/internal/core";
import { createServerGroupsController } from "../../src/server/serverGroups";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { fixtureRows, fixtureSchema, row } from "../fixtures/schema";
import { renderGrid } from "../renderGrid";

function view(groupBy: ViewDef["groupBy"]): ViewDef {
  return { id: "v-group", name: "Grouped", filter: null, sort: [], columnState: [], groupBy, pageSize: 100 };
}

function groupRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".ag-full-width-row .sg-group-row")];
}

function groupRow(container: HTMLElement, label: string): HTMLElement {
  const found = groupRows(container).find((el) => el.querySelector(".sg-group-label")?.textContent?.includes(label));
  if (!found) throw new Error(`group ${label} not rendered`);
  return found;
}

function toggleOf(el: HTMLElement): HTMLButtonElement {
  const button = el.querySelector<HTMLButtonElement>("button.sg-group-toggle");
  if (!button) throw new Error("toggle not rendered");
  return button;
}

function dataRowIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".ag-row[row-id]")]
    .filter((el) => !el.classList.contains("ag-full-width-row"))
    .map((el) => el.getAttribute("row-id") ?? "");
}

function conditionsOf(node: FilterNode | null | undefined): FilterCondition[] {
  if (!node) return [];
  if (isFilterGroup(node)) return node.children.flatMap(conditionsOf);
  return [node];
}

function lastFetchQuery(fetch: ReturnType<typeof vi.fn>): GridQuery {
  const call = fetch.mock.calls.at(-1);
  if (!call) throw new Error("no fetch");
  return call[0] as GridQuery;
}

describe("client-mode grouping wiring", () => {
  const grouped = view([{ columnId: "payment", aggregations: [{ columnId: "fee", agg: "sum" }] }]);

  it("renders group rows full-width with labels and counts", async () => {
    const { container, settle } = renderGrid({ props: { view: grouped } });
    await waitFor(() => expect(groupRows(container)).toHaveLength(4));
    await settle();
    const paid = groupRow(container, "Paid");
    expect(paid.closest(".ag-full-width-row")).not.toBeNull();
    expect(paid.querySelector(".sg-group-count")?.textContent).toContain("1");
    expect(groupRow(container, "(empty)").querySelector(".sg-group-count")?.textContent).toContain("1");
    expect(toggleOf(paid).getAttribute("aria-expanded")).toBe("true");
    expect(toggleOf(paid).getAttribute("aria-label")).toMatch(/Collapse.*Paid/);
    expect(dataRowIds(container).sort()).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("indents nested levels", async () => {
    const { container } = renderGrid({ props: { view: view([{ columnId: "payment" }, { columnId: "active" }]) } });
    await waitFor(() => expect(groupRows(container).length).toBeGreaterThan(4));
    const levels = groupRows(container).map((el) => el.getAttribute("data-level"));
    expect(levels).toContain("0");
    expect(levels).toContain("1");
    const nested = groupRows(container).find((el) => el.getAttribute("data-level") === "1");
    const top = groupRows(container).find((el) => el.getAttribute("data-level") === "0");
    expect(Number.parseInt(nested?.style.paddingLeft ?? "0", 10)).toBeGreaterThan(
      Number.parseInt(top?.style.paddingLeft ?? "0", 10),
    );
  });

  it("collapsing a group hides its children; Enter on the toggle and on the focused row re-toggles", async () => {
    const { container, settle } = renderGrid({ props: { view: grouped } });
    await waitFor(() => expect(dataRowIds(container)).toContain("r1"));

    act(() => {
      fireEvent.click(toggleOf(groupRow(container, "Paid")));
    });
    await waitFor(() => expect(dataRowIds(container)).not.toContain("r1"));
    expect(dataRowIds(container)).toContain("r2");
    expect(toggleOf(groupRow(container, "Paid")).getAttribute("aria-expanded")).toBe("false");

    act(() => {
      fireEvent.keyDown(toggleOf(groupRow(container, "Paid")), { key: "Enter" });
    });
    await waitFor(() => expect(dataRowIds(container)).toContain("r1"));

    // Keyboard on the full-width row element itself (AG Grid focuses the row).
    const rowEl = groupRow(container, "Paid").closest(".ag-full-width-row") as HTMLElement;
    act(() => {
      fireEvent.keyDown(rowEl, { key: " " });
    });
    await waitFor(() => expect(dataRowIds(container)).not.toContain("r1"));
    await settle();
  });

  it("displays aggregates formatted with the aggregated column's field type", async () => {
    const { container } = renderGrid({ props: { view: grouped } });
    await waitFor(() => expect(groupRows(container)).toHaveLength(4));
    const text = groupRow(container, "Paid").querySelector(".sg-group-aggs")?.textContent ?? "";
    expect(text).toContain("Sum Fee:");
    expect(text).toContain("1,000.00");
    const pending = groupRow(container, "Pending").querySelector(".sg-group-aggs")?.textContent ?? "";
    expect(pending).toContain("500.00");
  });
});

describe("server-mode grouping wiring", () => {
  it("switches to the client-side model and renders server groups collapsed with counts", async () => {
    const { container, ds } = renderGrid({
      props: { mode: "server", view: view([{ columnId: "payment", aggregations: [{ columnId: "fee", agg: "sum" }] }]) },
    });
    await waitFor(() => expect(groupRows(container)).toHaveLength(4));
    expect(container.querySelector(".ag-full-width-row")).not.toBeNull();
    const paid = groupRow(container, "Paid");
    expect(toggleOf(paid).getAttribute("aria-expanded")).toBe("false");
    expect(paid.querySelector(".sg-group-count")?.textContent).toContain("1");
    expect(paid.querySelector(".sg-group-aggs")?.textContent).toContain("1,000.00");
    expect(dataRowIds(container)).toEqual([]);
    const q = lastFetchQuery(ds.calls.fetch);
    expect(q.groupBy?.map((g) => g.columnId)).toEqual(["payment"]);
  });

  it("expanding a group fetches its rows with the pinned condition", async () => {
    const { container, ds } = renderGrid({ props: { mode: "server", view: view([{ columnId: "payment" }]) } });
    await waitFor(() => expect(groupRows(container)).toHaveLength(4));
    ds.calls.fetch.mockClear();
    act(() => {
      fireEvent.click(toggleOf(groupRow(container, "Paid")));
    });
    await waitFor(() => expect(dataRowIds(container)).toEqual(["r1"]));
    const q = lastFetchQuery(ds.calls.fetch);
    expect(q.groupBy).toBeUndefined();
    expect(conditionsOf(q.filter)).toEqual([{ columnId: "payment", operator: "is", value: "paid" }]);
    expect(q.page).toEqual({ offset: 0, limit: 100 });
  });

  it("nested groups: level-2 expansion pins both ancestors", async () => {
    const { container, ds } = renderGrid({
      props: { mode: "server", view: view([{ columnId: "payment" }, { columnId: "active" }]) },
    });
    await waitFor(() => expect(groupRows(container)).toHaveLength(4));
    act(() => {
      fireEvent.click(toggleOf(groupRow(container, "Paid")));
    });
    await waitFor(() => expect(groupRows(container)).toHaveLength(5));
    const sub = groupRows(container).find((el) => el.getAttribute("data-level") === "1");
    if (!sub) throw new Error("no sub group");
    ds.calls.fetch.mockClear();
    act(() => {
      fireEvent.click(toggleOf(sub));
    });
    await waitFor(() => expect(dataRowIds(container)).toEqual(["r1"]));
    const q = lastFetchQuery(ds.calls.fetch);
    expect(q.groupBy).toBeUndefined();
    expect(conditionsOf(q.filter)).toEqual([
      { columnId: "payment", operator: "is", value: "paid" },
      { columnId: "active", operator: "isTrue" },
    ]);
  });

  it("load-more appends the next page", async () => {
    const rows: GridRow[] = [1, 2, 3, 4, 5].map((i) => row(`p${i}`, { name: `N${i}`, payment: "paid" }));
    const { container, ds } = renderGrid({
      rows,
      props: { mode: "server", pageSize: 2, view: view([{ columnId: "payment" }]) },
    });
    await waitFor(() => expect(groupRows(container)).toHaveLength(1));
    act(() => {
      fireEvent.click(toggleOf(groupRow(container, "Paid")));
    });
    await waitFor(() => expect(dataRowIds(container)).toEqual(["p1", "p2"]));
    const loadMore = () => container.querySelector<HTMLButtonElement>(".sg-load-more button");
    expect(loadMore()?.textContent).toContain("2 of 5");
    act(() => {
      fireEvent.click(loadMore() as HTMLButtonElement);
    });
    await waitFor(() => expect(dataRowIds(container)).toEqual(["p1", "p2", "p3", "p4"]));
    expect(lastFetchQuery(ds.calls.fetch).page).toEqual({ offset: 2, limit: 2 });
    act(() => {
      fireEvent.click(loadMore() as HTMLButtonElement);
    });
    await waitFor(() => expect(dataRowIds(container)).toEqual(["p1", "p2", "p3", "p4", "p5"]));
    await waitFor(() => expect(loadMore()).toBeNull());
  });

  it("removing groupBy switches back to the infinite model", async () => {
    const { container, handle, settle } = renderGrid({
      props: { mode: "server", view: view([{ columnId: "payment" }]) },
    });
    await waitFor(() => expect(groupRows(container)).toHaveLength(4));
    act(() => {
      handle.current?.stores.query.setGroupBy([]);
    });
    await waitFor(() => expect(dataRowIds(container).sort()).toEqual(fixtureRows.map((r) => r.id).sort()));
    expect(groupRows(container)).toHaveLength(0);
    await settle();
  });
});

describe("createServerGroupsController", () => {
  const registry = createDefaultRegistry();

  /** Strips core's nested `children` so the controller must query sub-groups itself. */
  function withoutChildren(ds: DataSource<GridRow>): { fetch: ReturnType<typeof vi.fn> } {
    const strip = (g: GroupResult): GroupResult => {
      const { children: _c, ...rest } = g;
      return rest;
    };
    return {
      fetch: vi.fn(async (q: GridQuery): Promise<QueryResult<GridRow>> => {
        const r = await ds.fetch(q);
        return r.groups ? { ...r, groups: r.groups.map(strip) } : r;
      }),
    };
  }

  /**
   * `@masai/schema-grid-server` pages the GROUPS of a grouping query by
   * `page` (rows: [], nextCursor while more groups exist), where core's
   * in-memory source returns every group and pages `rows`. Found by the
   * apps/storybook Playwright server-mode grouping scenario (§12): asking for
   * a one-row page showed only the first group against the real server.
   */
  function serverStyleGroupPaging(ds: DataSource<GridRow>): { fetch: ReturnType<typeof vi.fn> } {
    return {
      fetch: vi.fn(async (q: GridQuery): Promise<QueryResult<GridRow>> => {
        if (!q.groupBy?.length) return ds.fetch(q);
        const all = (await ds.fetch({ ...q, page: { offset: 0, limit: 1000 } })).groups ?? [];
        const offset = "cursor" in q.page && q.page.cursor ? Number(q.page.cursor) : (q.page.offset ?? 0);
        const groups = all.slice(offset, offset + q.page.limit);
        const next = offset + q.page.limit;
        return { rows: [], groups, ...(next < all.length ? { nextCursor: String(next) } : {}) };
      }),
    };
  }

  it("loads every group from a source that pages groups (server semantics)", async () => {
    const ds = serverStyleGroupPaging(createInMemoryDataSource(fixtureSchema, fixtureRows));
    const ctl = createServerGroupsController<GridRow>({
      dataSource: ds,
      getQuery: () => ({ filter: null, sort: [], groupBy: [{ columnId: "payment" }] }),
      pageSize: 2,
      schema: fixtureSchema,
      registry,
    });
    await ctl.load();
    const labels = ctl.getDisplayRows().map((r) => (r as { label?: string }).label);
    expect(labels).toHaveLength(4);
    expect(new Set(labels).size).toBe(4);
    expect(labels).toEqual(expect.arrayContaining(["Paid", "Pending", "(empty)"]));
  });

  it("queries sub-groups with the groupBy slice when core children are absent", async () => {
    const ds = withoutChildren(createInMemoryDataSource(fixtureSchema, fixtureRows));
    const ctl = createServerGroupsController<GridRow>({
      dataSource: ds,
      getQuery: () => ({ filter: null, sort: [], groupBy: [{ columnId: "payment" }, { columnId: "active" }] }),
      pageSize: 50,
      schema: fixtureSchema,
      registry,
    });
    await ctl.load();
    const top = ctl.getDisplayRows();
    expect(top).toHaveLength(4);
    const paid = top.find((r) => (r as { label?: string }).label === "Paid") as { id: string };
    await ctl.toggle(paid.id);
    const q = lastFetchQuery(ds.fetch);
    expect(q.groupBy?.map((g) => g.columnId)).toEqual(["active"]);
    expect(conditionsOf(q.filter)).toEqual([{ columnId: "payment", operator: "is", value: "paid" }]);
    expect(ctl.getDisplayRows()).toHaveLength(5);
  });

  it("ANDs the view filter with the pinned group condition", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const viewFilter: FilterNode = { columnId: "score", operator: "gt", value: 1 };
    const ctl = createServerGroupsController<GridRow>({
      dataSource: ds,
      getQuery: () => ({ filter: viewFilter, sort: [], groupBy: [{ columnId: "active" }] }),
      pageSize: 50,
      schema: fixtureSchema,
      registry,
    });
    await ctl.load();
    const groups = ctl.getDisplayRows() as { id: string; label: string }[];
    const first = groups[0];
    if (!first) throw new Error("no groups");
    await ctl.toggle(first.id);
    const q = lastFetchQuery(ds.calls.fetch);
    expect(conditionsOf(q.filter)[0]).toEqual(viewFilter);
    expect(conditionsOf(q.filter)).toHaveLength(2);
  });
});
