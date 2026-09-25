/**
 * View capture / apply: converting between the live grid + query store and a
 * persisted `ViewDef`.
 *
 * Sort lives in the query store (AG's own sort is display-only in our
 * design), but we still push `sort`/`sortIndex` into the AG column state on
 * apply so the header sort indicators match the view.
 */
import type { ColumnState, GridApi } from "ag-grid-community";
import type { Access, ColumnDef, FilterNode, GridRow, Pinned, SortSpec, ViewColumnState, ViewDef } from "../internal/core";
import { isFilterGroup } from "../internal/core";
import type { QueryStore } from "../state/queryStore";

const AG_INTERNAL_PREFIX = "ag-Grid-";

function normalizePinned(pinned: ColumnState["pinned"]): Pinned {
  if (pinned === true) return "left";
  if (pinned === "left" || pinned === "right") return pinned;
  return null;
}

/** Width recorded when neither the grid, the base view nor the schema column has one. */
export const DEFAULT_VIEW_COLUMN_WIDTH = 200;

/**
 * Captures the grid's column state + query store as a view. core's
 * `ColumnState.width` is required: the grid's current width is used, else the
 * base view's width, else `ColumnDef.width` (from `opts.columns`), else 200.
 */
export function captureViewState<Row extends GridRow>(
  api: Pick<GridApi<Row>, "getColumnState">,
  stores: { query: QueryStore },
  base: ViewDef,
  opts?: { columns?: readonly ColumnDef[] },
): ViewDef {
  const raw = api.getColumnState();
  const baseWidths = new Map(base.columnState.map((c) => [c.id, c.width]));
  const schemaWidths = new Map((opts?.columns ?? []).map((c) => [c.id, c.width]));
  const widthOf = (colId: string, live: number | null | undefined): number => {
    const candidates = [live, baseWidths.get(colId), schemaWidths.get(colId)];
    const found = candidates.find((w): w is number => typeof w === "number" && Number.isFinite(w));
    return found ?? DEFAULT_VIEW_COLUMN_WIDTH;
  };
  const columnState: ViewColumnState[] = [];
  let order = 0;
  for (const cs of raw) {
    if (cs.colId.startsWith(AG_INTERNAL_PREFIX)) continue;
    const entry: ViewColumnState = {
      id: cs.colId,
      hidden: !!cs.hide,
      width: widthOf(cs.colId, cs.width),
      pinned: normalizePinned(cs.pinned),
      order,
    };
    columnState.push(entry);
    order += 1;
  }

  const query = stores.query.getState();

  return {
    id: base.id,
    name: base.name,
    pageSize: base.pageSize,
    filter: query.filter,
    sort: query.sort,
    groupBy: query.groupBy,
    columnState,
    ...(query.search !== undefined ? { search: query.search } : {}),
  };
}

function pruneFilter(node: FilterNode | null, isKnown: (columnId: string) => boolean): FilterNode | null {
  if (!node) return null;
  if (isFilterGroup(node)) {
    const children = node.children.map((c) => pruneFilter(c, isKnown)).filter((c): c is FilterNode => c !== null);
    if (children.length === 0) return null;
    return { op: node.op, children };
  }
  return isKnown(node.columnId) ? node : null;
}

export function applyViewState<Row extends GridRow>(
  api: Pick<GridApi<Row>, "applyColumnState" | "getColumnState">,
  view: ViewDef,
  stores: { query: QueryStore },
  opts?: { access?: Map<string, Access> },
): void {
  const access = opts?.access;
  const existing = api.getColumnState();
  const knownIds = new Set(existing.map((c) => c.colId));
  const isKnown = (columnId: string): boolean => knownIds.has(columnId) && access?.get(columnId) !== "hidden";

  const orderedColumns = [...view.columnState].filter((vc) => isKnown(vc.id)).sort((a, b) => a.order - b.order);

  const sortByColumnId = new Map<string, { dir: SortSpec["dir"]; index: number }>();
  const filteredSort: SortSpec[] = [];
  for (const s of view.sort) {
    if (!isKnown(s.columnId)) continue;
    sortByColumnId.set(s.columnId, { dir: s.dir, index: filteredSort.length });
    filteredSort.push(s);
  }

  const state: ColumnState[] = orderedColumns.map((vc) => {
    const sortEntry = sortByColumnId.get(vc.id);
    return {
      colId: vc.id,
      hide: vc.hidden,
      width: vc.width,
      pinned: vc.pinned,
      sort: sortEntry ? sortEntry.dir : null,
      sortIndex: sortEntry ? sortEntry.index : null,
    };
  });

  api.applyColumnState({ state, applyOrder: true });

  const filter = pruneFilter(view.filter, isKnown);
  const groupBy = view.groupBy
    .filter((g) => isKnown(g.columnId))
    .map((g) => ({
      ...g,
      ...(g.aggregations ? { aggregations: g.aggregations.filter((a) => isKnown(a.columnId)) } : {}),
    }));

  stores.query.setFilter(filter);
  stores.query.setSort(filteredSort);
  stores.query.setSearch(view.search);
  stores.query.setGroupBy(groupBy);
}
