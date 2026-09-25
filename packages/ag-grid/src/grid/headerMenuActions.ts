/**
 * Builds `HeaderMenuActions` for one column from AG Grid Community APIs, so
 * every change flows through the grid's own sort/pin/visibility events (and
 * from there into view capture / `onViewChange`).
 */
import type { Column, GridApi } from "ag-grid-community";
import type {
  HeaderMenuActions,
  HeaderMenuHostCallbacks,
  HeaderMenuPinnedState,
  HeaderMenuSortState,
} from "./headerMenu";

export interface HeaderMenuActionDeps {
  api: Pick<GridApi, "applyColumnState" | "autoSizeColumns" | "autoSizeAllColumns" | "showColumnFilter">;
  column: Pick<Column, "getColId" | "getSort" | "getPinned" | "isFilterAllowed" | "isSortable">;
  host?: HeaderMenuHostCallbacks;
  /** Opens the filter anchored at the header (falls back to `api.showColumnFilter`). */
  openFilter?(): void;
  /** Runs after every action (e.g. close the menu). */
  after?(): void;
}

export function createHeaderMenuActions(deps: HeaderMenuActionDeps): HeaderMenuActions {
  const { api, column, host } = deps;
  const colId = column.getColId();
  const run =
    (fn: () => void) =>
    (): void => {
      fn();
      deps.after?.();
    };
  const sort = (direction: "asc" | "desc" | null) =>
    run(() => api.applyColumnState({ state: [{ colId, sort: direction }], defaultState: { sort: null } }));
  const pin = (pinned: "left" | "right" | null) => run(() => api.applyColumnState({ state: [{ colId, pinned }] }));
  const rawSort = column.getSort();
  const sortState: HeaderMenuSortState = rawSort === "asc" || rawSort === "desc" ? rawSort : null;
  const rawPinned = column.getPinned();
  const pinnedState: HeaderMenuPinnedState = rawPinned === "left" || rawPinned === "right" ? rawPinned : null;
  const canFilter = column.isFilterAllowed();
  const canSort = column.isSortable();

  const actions: HeaderMenuActions = {
    sortAsc: sort("asc"),
    sortDesc: sort("desc"),
    clearSort: sort(null),
    pinLeft: pin("left"),
    pinRight: pin("right"),
    unpin: pin(null),
    autosize: run(() => api.autoSizeColumns([colId])),
    autosizeAll: run(() => api.autoSizeAllColumns()),
    hide: run(() => api.applyColumnState({ state: [{ colId, hide: true }] })),
    openFilter: () => {
      deps.after?.();
      if (!canFilter) return;
      if (deps.openFilter) deps.openFilter();
      else api.showColumnFilter(colId);
    },
    sortState,
    pinnedState,
    canSort,
    canFilter,
    canGroup: typeof host?.onGroupByColumn === "function",
  };
  if (host?.onGroupByColumn) {
    const cb = host.onGroupByColumn;
    actions.groupBy = run(() => cb(colId));
  }
  if (host?.onEditColumn) {
    const cb = host.onEditColumn;
    actions.editColumn = run(() => cb(colId));
  }
  if (host?.onInsertColumn) {
    const cb = host.onInsertColumn;
    actions.insertColumn = (side) => {
      cb(colId, side);
      deps.after?.();
    };
  }
  return actions;
}
